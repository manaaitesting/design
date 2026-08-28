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
      return {
        stamp,
        at: Date.parse(isoFrom(stamp)) || 0,
        nodes: Object.keys(doc).length,
        names: names.slice(0, 6),
        pinned,
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

/**
 * Re-inserts a version's layers into the live document.
 *
 * Returns how many top-level layers came back, so the caller can say something
 * true rather than "done".
 */
export async function restoreVersion(fileId: string, stamp: string): Promise<number> {
  const match = filesFor(fileId).find((entry) => entry.stamp === stamp);
  if (!match) throw new Error('That version is no longer on disk.');

  const from = readDoc(match.file);
  const snapshot = from.getSnapshot();
  const top = snapshot[ROOT_ID]?.children ?? [];
  if (!top.length) throw new Error('That version has nothing on its first page.');
  const payload = from.serialize([...top]);

  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  const provider = new WebsocketProvider(SYNC_URL, fileId, ydoc, {
    params: { token: syncToken(fileId) },
    // y-websocket expects a browser WebSocket; `ws` is the Node equivalent
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out reaching the sync server.')),
        8000,
      );
      provider.once('sync', (isSynced: boolean) => {
        if (!isSynced) return;
        clearTimeout(timer);
        resolve();
      });
    });

    store.ensureRoot();
    const restored = store.paste(payload, ROOT_ID);
    // the provider batches; give it a moment to flush before disconnecting
    await new Promise((resolve) => setTimeout(resolve, 750));
    return restored.length;
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
}
