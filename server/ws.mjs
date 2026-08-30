/**
 * Yjs sync server.
 *
 * Self-hosted on purpose: multiplayer here needs no account, no API key and no
 * third-party service. It speaks the standard y-websocket wire protocol, so the
 * client is a plain `WebsocketProvider`-shaped implementation and could be
 * pointed at a hosted service later without touching the editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const PORT = Number(process.env.SYNC_PORT ?? 1234);
const AUTH_SECRET = process.env.AUTH_SECRET;
// Overridable so the snapshot behaviour can be tested against a scratch directory.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '.data');
const SAVE_DEBOUNCE_MS = 1500;
const SNAPSHOT_EVERY_MS = 60_000;
const SNAPSHOT_KEEP = 20;
// A save that removes this fraction of the document is treated as a wipe, and
// the state *before* it is kept forever rather than rotating out.
const WIPE_FRACTION = 0.5;
const WIPE_MIN_NODES = 3;
// Pinned snapshots outlive rotation, but not without limit — a document edited
// by repeated delete-and-rebuild would otherwise fill the disk.
const SNAPSHOT_KEEP_PINNED = 50;
const PING_INTERVAL_MS = 25_000;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

/** The one root type a view-only socket is allowed to write into. */
const COMMENTS = 'comments';

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!AUTH_SECRET) {
  console.error('[sync] AUTH_SECRET is not set — copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

/**
 * Verifies the handshake token minted by the Next.js app.
 *
 * This process has no cookies and no database, so an HMAC over
 * `userId.fileId.expires` is what stands between a known room id and read-write
 * access to someone else's document.
 */
function verifySyncToken(token, room) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [userId, fileId, role, expires, signature] = parts;
  const expected = createHmac('sha256', AUTH_SECRET)
    .update(`${userId}.${fileId}.${role}.${expires}`)
    .digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  if (fileId !== room) return null;
  // the role is inside the signature, so a client cannot promote itself
  return { userId, role: role === 'owner' || role === 'editor' ? role : 'viewer' };
}

/** The name of the root type a struct ultimately hangs off, or null if it is gone. */
function rootOf(struct) {
  let type = struct?.parent;
  while (type && type._item) type = type._item.parent;
  return type && typeof type === 'object' ? Y.findRootTypeKey(type) : null;
}

/**
 * Whether an update from a viewer only writes comments.
 *
 * Comments share the document with the layers — one Y.Doc per room — so read-only
 * access cannot simply be "drop every write". A viewer may comment in Figma and
 * may here too, which means the wire has to tell one kind of write from the other.
 *
 * An update is a list of structs plus a set of deletions. A struct names its
 * parent directly only when it is the first thing at that position; otherwise it
 * names a neighbour, and a deletion names nothing but a clock range. Both are
 * resolved against the document we already hold, and anything that cannot be
 * resolved to the comments map is refused — the failure is a rejected comment,
 * never an accepted edit.
 */
function commentsOnly(update, doc) {
  let decoded;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return false;
  }

  /** clock ranges this very update creates, which its later structs may lean on */
  const fresh = new Map();
  const freshEnd = (client, clock) => {
    for (const [from, to] of fresh.get(client) ?? []) if (clock >= from && clock < to) return to;
    return 0;
  };
  const resolve = (id) => {
    const structs = doc.store.clients.get(id.client);
    if (!structs || structs.length === 0) return null;
    try {
      return rootOf(structs[Y.findIndexSS(structs, id.clock)]);
    } catch {
      return null;
    }
  };

  for (const struct of decoded.structs) {
    const anchor = struct.parent ?? struct.origin ?? struct.rightOrigin;
    if (!anchor) return false;
    if (typeof anchor === 'string') {
      if (anchor !== COMMENTS) return false;
    } else if (!freshEnd(anchor.client, anchor.clock) && resolve(anchor) !== COMMENTS) {
      return false;
    }
    const ranges = fresh.get(struct.id.client) ?? [];
    ranges.push([struct.id.clock, struct.id.clock + struct.length]);
    fresh.set(struct.id.client, ranges);
  }

  for (const [client, ranges] of decoded.ds.clients) {
    const structs = doc.store.clients.get(client);
    for (const range of ranges) {
      const end = range.clock + range.len;
      for (let clock = range.clock; clock < end; ) {
        const skip = freshEnd(client, clock);
        if (skip) {
          clock = skip;
          continue;
        }
        if (!structs || structs.length === 0) return false;
        let struct;
        try {
          struct = structs[Y.findIndexSS(structs, clock)];
        } catch {
          return false;
        }
        if (!struct || rootOf(struct) !== COMMENTS) return false;
        clock = struct.id.clock + struct.length;
      }
    }
  }

  return true;
}

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    /** @type {Map<import('ws').WebSocket, Set<number>>} */
    this.conns = new Map();
    this.saveTimer = null;
    /** set once the room has been let go, so a late close cannot revive it */
    this.released = false;

    this.file = path.join(DATA_DIR, `${encodeURIComponent(name)}.bin`);
    this.snapshotDir = path.join(DATA_DIR, 'snapshots');
    this.lastSnapshot = 0;
    /** Bytes of the last snapshot, so a wipe can be caught with its predecessor still in hand. */
    this.lastUpdate = null;
    this.lastCount = 0;
    if (fs.existsSync(this.file)) {
      try {
        const saved = fs.readFileSync(this.file);
        Y.applyUpdate(this.doc, new Uint8Array(saved));
        // Baseline for wipe detection, so a document destroyed in the first
        // minute after a restart is still caught.
        this.lastUpdate = saved;
        this.lastCount = this.doc.getMap('nodes').size;
        console.log(`[sync] restored "${name}" (${this.lastCount} nodes)`);
      } catch (err) {
        console.error(`[sync] could not restore "${name}":`, err.message);
      }
    }

    this.doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const conn of this.conns.keys()) {
        if (conn !== origin) send(conn, message);
      }
      this.scheduleSave();
    });

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const tracked = this.conns.get(origin);
      if (tracked) {
        for (const id of added) tracked.add(id);
        for (const id of removed) tracked.delete(id);
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      const message = encoding.toUint8Array(encoder);
      for (const conn of this.conns.keys()) send(conn, message);
    });
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const update = Buffer.from(Y.encodeStateAsUpdate(this.doc));
        fs.writeFileSync(this.file, update);
        this.snapshot(update);
      } catch (err) {
        console.error(`[sync] save failed for "${this.name}":`, err.message);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Rolling history.
   *
   * A CRDT merges concurrent edits but does not protect you from an intentional
   * one: a stray ⌘A + Delete is a perfectly valid update, and once it syncs the
   * previous state is gone from every peer. Undo is per-client and dies with the
   * tab, so the only real safety net is on disk.
   */
  snapshot(update) {
    const count = this.doc.getMap('nodes').size;

    // A rolling timer alone is not a safety net. Twenty snapshots a minute
    // apart is twenty minutes of history, and after a wipe the *good* states
    // rotate out while the empty ones accumulate — by the time anyone notices,
    // there is nothing left to go back to. So a destructive save pins its
    // predecessor permanently, whether or not the timer was due.
    const wiped =
      this.lastUpdate &&
      this.lastCount >= WIPE_MIN_NODES &&
      count <= this.lastCount * WIPE_FRACTION;
    if (wiped) {
      this.write(this.lastUpdate, 'keep');
      console.warn(
        `[sync] "${this.name}" dropped ${this.lastCount} → ${count} nodes; ` +
          `kept the previous state. Restore with: pnpm snapshots ${this.name}`,
      );
    }

    const now = Date.now();
    if (!wiped && now - this.lastSnapshot < SNAPSHOT_EVERY_MS) return;
    this.lastSnapshot = now;
    this.lastUpdate = update;
    this.lastCount = count;
    this.write(update, 'auto');
  }

  /**
   * Writes one snapshot and rotates the automatic ones. `keep` snapshots are
   * never rotated: they only exist because something destroyed a document, and
   * that is exactly when history must outlive the twenty-minute window.
   */
  write(update, kind) {
    try {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
      const prefix = `${encodeURIComponent(this.name)}__`;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const suffix = kind === 'keep' ? '__keep' : '';
      fs.writeFileSync(path.join(this.snapshotDir, `${prefix}${stamp}${suffix}.bin`), update);

      const pinned = kind === 'keep';
      const mine = fs
        .readdirSync(this.snapshotDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('__keep.bin') === pinned)
        .sort();
      const limit = pinned ? SNAPSHOT_KEEP_PINNED : SNAPSHOT_KEEP;
      for (const stale of mine.slice(0, Math.max(0, mine.length - limit))) {
        fs.rmSync(path.join(this.snapshotDir, stale), { force: true });
      }
    } catch (err) {
      console.error(`[sync] snapshot failed for "${this.name}":`, err.message);
    }
  }

  removeConn(conn) {
    const ids = this.conns.get(conn);
    this.conns.delete(conn);
    if (ids) awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], null);
    // A dead socket is reported twice — once by the ping timer, once by the
    // close event — and by the second one this room may already have been
    // replaced. Writing its document again would clobber the live one.
    if (this.conns.size > 0 || this.released) return;
    this.released = true;

    // flush immediately, then let the room go
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.writeFileSync(this.file, Buffer.from(Y.encodeStateAsUpdate(this.doc)));
    } catch { /* best effort */ }
    rooms.delete(this.name);

    // Dropping the last reference is not enough to free a room. Awareness runs
    // an interval to expire stale peers, and that timer keeps the awareness —
    // and through it the whole document — reachable for the life of the
    // process. A server that opens and closes rooms all day would grow by a
    // document every time. Destroying the doc destroys its awareness with it.
    this.doc.destroy();
    console.log(`[sync] room "${this.name}" idle, released`);
  }
}

function send(conn, message) {
  if (conn.readyState !== conn.OPEN && conn.readyState !== conn.CONNECTING) {
    return conn.close();
  }
  try {
    conn.send(message, (err) => err && conn.close());
  } catch {
    conn.close();
  }
}

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    room = new Room(name);
    rooms.set(name, room);
    console.log(`[sync] room "${name}" opened`);
  }
  return room;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (conn, request) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const name = decodeURIComponent(url.pathname.slice(1)) || 'default';

  const auth = verifySyncToken(url.searchParams.get('token'), name);
  if (!auth) {
    console.warn(`[sync] rejected unauthenticated connection to "${name}"`);
    return conn.close(4401, 'unauthorized');
  }
  const mayEdit = auth.role !== 'viewer';

  const room = getRoom(name);
  room.conns.set(conn, new Set());
  conn.binaryType = 'arraybuffer';

  conn.on('message', (data) => {
    try {
      const message = new Uint8Array(data);
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);

      if (type === MESSAGE_SYNC) {
        // A viewer's socket may ask what the document is (step 1) but never
        // tell it what to become (step 2 and update both apply changes) —
        // unless what it is telling us is a comment, which a viewer is
        // entitled to leave. The client hides its editing UI as well; this is
        // the half that holds when the client is not the one we shipped.
        if (!mayEdit) {
          const peek = decoding.createDecoder(message);
          decoding.readVarUint(peek);
          if (decoding.readVarUint(peek) !== syncProtocol.messageYjsSyncStep1) {
            if (!commentsOnly(decoding.readVarUint8Array(peek), room.doc)) {
              console.warn(`[sync] dropped a write from a viewer on "${name}"`);
              return;
            }
          }
        }
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
        if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
      } else if (type === MESSAGE_QUERY_AWARENESS) {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            room.awareness,
            [...room.awareness.getStates().keys()],
          ),
        );
        send(conn, encoding.toUint8Array(encoder));
      }
    } catch (err) {
      console.error('[sync] bad message:', err.message);
    }
  });

  let alive = true;
  conn.on('pong', () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) {
      clearInterval(ping);
      room.removeConn(conn);
      return conn.terminate();
    }
    alive = false;
    try { conn.ping(); } catch { conn.terminate(); }
  }, PING_INTERVAL_MS);

  conn.on('close', () => {
    clearInterval(ping);
    room.removeConn(conn);
  });

  // step 1: send our state vector so the client can reply with what we're missing
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(conn, encoding.toUint8Array(encoder));
  }

  // and hand over everyone already in the room
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    send(conn, encoding.toUint8Array(encoder));
  }
});

console.log(`[sync] listening on ws://localhost:${PORT}  ·  data in ${DATA_DIR}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const room of rooms.values()) {
      try {
        fs.writeFileSync(room.file, Buffer.from(Y.encodeStateAsUpdate(room.doc)));
      } catch { /* best effort */ }
    }
    process.exit(0);
  });
}
