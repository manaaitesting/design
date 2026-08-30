import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { DocStore } from '../document/store';
import { ROOT_ID } from '../document/types';

/**
 * Version history.
 *
 * The sync server writes a rolling snapshot of every room to disk — see
 * `server/ws.mjs`. This reads that shelf and puts it behind the editor, because
 * a history you can only reach from a terminal is not a history most people
 * have.
 *
 * Restoring does *not* copy the file back. A CRDT remembers deletions: an open
 * tab still holds the ⌘A + Delete that emptied the document, so the moment it
 * reconnects to a file-swapped server it deletes everything again. Instead the
 * snapshot's layers are re-inserted into the *live* document as new layers —
 * the same path ⌘V takes — which nothing has ever deleted. That merges cleanly
 * with whoever is connected, and needs neither a restart nor a reload.
 */

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '.data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const SYNC_URL = process.env.SYNC_URL ?? 'ws://localhost:1234';
const RESTORE_AGENT = 'history-restore';

export interface Version {
  /** the timestamp in the filename — the id a restore is asked for by */
  stamp: string;
  at: number;
  nodes: number;
  /** a few layer names, so one version can be told from another */
  names: string[];
  /** kept because the document was wiped just after it; never rotated away */
  pinned: boolean;
  /** what someone called this moment, and who — absent on the timer's own saves */
  title?: string;
  description?: string;
  authorName?: string;
}

/** What a person adds to a snapshot the timer would otherwise leave anonymous. */
export interface VersionNote {
  title: string;
  description?: string;
  authorId: string;
  authorName: string;
}

/**
 * Names live beside the snapshots rather than in them.
 *
 * A snapshot is a Yjs update — the document, and nothing about the moment it
 * was taken. The filename has carried the whole metadata model until now, and a
 * title with a description in it is more than a filename should hold.
 */
function notesFile(fileId: string): string {
  return path.join(SNAPSHOT_DIR, `${encodeURIComponent(fileId)}.versions.json`);
}

function readNotes(fileId: string): Record<string, VersionNote | undefined> {
  try {
    return JSON.parse(fs.readFileSync(notesFile(fileId), 'utf8')) as Record<string, VersionNote>;
  } catch {
    return {};
  }
}

function readDoc(file: string): DocStore {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(fs.readFileSync(file)));
  return new DocStore(ydoc);
}

function filesFor(fileId: string): { file: string; stamp: string; pinned: boolean }[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  const prefix = `${encodeURIComponent(fileId)}__`;
  return fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bin'))
    .sort()
    .map((name) => ({
      file: path.join(SNAPSHOT_DIR, name),
      stamp: name.slice(prefix.length, -4).replace('__keep', ''),
      pinned: name.endsWith('__keep.bin'),
    }));
}

/** Newest first — the order a history panel reads in. */
export function listVersions(fileId: string): Version[] {
  const notes = readNotes(fileId);
  return filesFor(fileId)
    .map(({ file, stamp, pinned }) => {
      let doc: ReturnType<DocStore['getSnapshot']> = {};
      try {
        doc = readDoc(file).getSnapshot();
      } catch {
        // a half-written snapshot is not worth failing the whole list over
        return null;
      }
      const names = Object.values(doc)
        .filter((node) => node.type !== 'page')
        .map((node) => node.name);
      const note = notes[stamp];
      return {
        stamp,
        at: Date.parse(isoFrom(stamp)) || 0,
        nodes: Object.keys(doc).length,
        names: names.slice(0, 6),
        pinned,
        ...(note && {
          title: note.title,
          description: note.description,
          authorName: note.authorName,
        }),
      } satisfies Version;
    })
    .filter((entry): entry is Version => !!entry)
    .reverse();
}

/** The filename stamp is an ISO time with its punctuation swapped out. */
function isoFrom(stamp: string): string {
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** more than the lists show, so the panel can say so honestly */
  more: number;
}

/**
 * What changed between a version and the file as it stands.
 *
 * The comparison is by layer, not by pixel: which layers appeared, which went,
 * and which were edited. That is the question someone opening a history panel
 * is actually asking, and it is answerable from the two documents without
 * rendering either of them.
 */
export function compareVersion(fileId: string, stamp: string): VersionDiff | null {
  const match = filesFor(fileId).find((entry) => entry.stamp === stamp);
  if (!match) return null;
  const live = path.join(DATA_DIR, `${encodeURIComponent(fileId)}.bin`);
  if (!fs.existsSync(live)) return null;

  const before = readDoc(match.file).getSnapshot();
  const after = readDoc(live).getSnapshot();

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, node] of Object.entries(after)) {
    const was = before[id];
    if (!was) {
      if (node.type !== 'page') added.push(node.name);
    } else if (!sameNode(was, node)) {
      changed.push(node.name);
    }
  }
  for (const [id, node] of Object.entries(before)) {
    if (!after[id] && node.type !== 'page') removed.push(node.name);
  }

  const cap = 8;
  const more =
    Math.max(0, added.length - cap) +
    Math.max(0, removed.length - cap) +
    Math.max(0, changed.length - cap);
  return {
    added: added.slice(0, cap),
    removed: removed.slice(0, cap),
    changed: changed.slice(0, cap),
    more,
  };
}

/** Cheap structural comparison — enough to say "this layer was edited". */
function sameNode(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function syncToken(fileId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set.');
  const expires = Date.now() + 60_000;
  const payload = `${RESTORE_AGENT}.${fileId}.editor.${expires}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

/** Joins the room as an editor and waits for the document to arrive. */
async function joinRoom(fileId: string): Promise<{ ydoc: Y.Doc; provider: WebsocketProvider }> {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(SYNC_URL, fileId, ydoc, {
    params: { token: syncToken(fileId) },
    // y-websocket expects a browser WebSocket; `ws` is the Node equivalent
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reaching the sync server.')), 8000);
      provider.once('sync', (isSynced: boolean) => {
        if (!isSynced) return;
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (error) {
    provider.destroy();
    ydoc.destroy();
    throw error;
  }
  return { ydoc, provider };
}

/**
 * Saves a version on purpose, with a name and an author on it.
 *
 * The shelf until now was the sync server's timer: twenty anonymous minutes,
 * after which the state worth keeping has rotated out. That is not a history
 * anyone can navigate — "the one I sent the client" has to be findable months
 * later, and with two people editing you cannot even tell whose state a
 * timestamp is.
 *
 * This joins the room the way a restore does and writes what it is handed to
 * the same shelf, under the pinned name so the rotation leaves it alone. The
 * sync server needs no new message for it: the document it would snapshot is
 * exactly the document it just sent us.
 */
export async function saveVersion(fileId: string, note: VersionNote): Promise<Version> {
  const { ydoc, provider } = await joinRoom(fileId);
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${encodeURIComponent(fileId)}__${stamp}__keep.bin`;
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, name),
      Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    );

    const notes = readNotes(fileId);
    notes[stamp] = note;
    fs.writeFileSync(notesFile(fileId), JSON.stringify(notes, null, 2));

    const saved = listVersions(fileId).find((version) => version.stamp === stamp);
    if (!saved) throw new Error('Could not read the version back.');
    return saved;
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
}

export interface Restored {
  layers: number;
  /** the pages they went into, named — so the panel can say where they landed */
  pages: string[];
}

/**
 * Re-inserts a version's layers into the live document, page by page.
 *
 * Restoring a version means the file looks like that version, and a file is its
 * pages: reading only the root page's children threw away every page but the
 * first and piled it onto whichever page happened to be indexed first. So each
 * of the snapshot's pages goes back into the live page of the same id, and a
 * page that has since been deleted comes back rather than emptying into a
 * neighbour.
 *
 * Returns what actually happened, so the caller can say something true rather
 * than "done".
 */
export async function restoreVersion(fileId: string, stamp: string): Promise<Restored> {
  const match = filesFor(fileId).find((entry) => entry.stamp === stamp);
  if (!match) throw new Error('That version is no longer on disk.');

  const from = readDoc(match.file);
  const snapshot = from.getSnapshot();
  // documents written before pages were indexed still have their root page
  const indexed = from.listPages();
  const pages = (indexed.length ? indexed : [ROOT_ID]).filter(
    (id) => (snapshot[id]?.children ?? []).length > 0,
  );
  if (!pages.length) throw new Error('That version has nothing on it.');

  const { ydoc, provider } = await joinRoom(fileId);
  const store = new DocStore(ydoc);

  try {
    store.ensureRoot();
    // a page the live document holds but has not indexed is a page nobody can
    // reach, so it counts as gone
    const live = new Set(store.listPages());
    const restored: Restored = { layers: 0, pages: [] };

    for (const id of pages) {
      const target = live.has(id) ? id : store.addPage(snapshot[id]?.name);
      const children = snapshot[id].children.map((child) => snapshot[child]).filter(Boolean);
      // `serialize` moves what it packs to the origin so a paste lands under the
      // pointer; a restore is not a paste, and the layout has to come back where
      // it was, so the offset puts it straight back.
      const offset = {
        x: Math.min(...children.map((node) => node.x)),
        y: Math.min(...children.map((node) => node.y)),
      };
      const layers = store.paste(from.serialize([...snapshot[id].children]), target, offset);
      restored.layers += layers.length;
      restored.pages.push(store.getSnapshot()[target]?.name ?? 'a page');
    }

    // the provider batches; give it a moment to flush before disconnecting
    await new Promise((resolve) => setTimeout(resolve, 750));
    return restored;
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
}
