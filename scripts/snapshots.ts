/**
 * List or restore sync-server snapshots.
 *
 *   pnpm snapshots <room>              list what is available
 *   pnpm snapshots <room> <stamp>      restore that snapshot
 *
 * Restoring does *not* copy the file back. A CRDT remembers deletions: an open
 * tab still holds the ⌘A + Delete that emptied the document, so the moment it
 * reconnects to a file-swapped server it deletes everything again. Instead the
 * snapshot's content is re-inserted into the *live* document as new layers —
 * the same path ⌘V takes — which nothing has ever deleted. That merges cleanly
 * with whoever is connected, needs no restart, and needs no reload.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { DocStore } from '../src/document/store';
import { ROOT_ID } from '../src/document/types';
import { closeAll, openFile } from '../server/mcp-doc';

const envFile = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const DATA_DIR = path.resolve(process.cwd(), '.data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const [room, stamp] = process.argv.slice(2);

if (!room) {
  console.error('usage: pnpm snapshots <room> [stamp]');
  process.exit(1);
}

function read(file: string): DocStore {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(fs.readFileSync(file)));
  return new DocStore(ydoc);
}

const prefix = `${encodeURIComponent(room)}__`;
const available = fs.existsSync(SNAPSHOT_DIR)
  ? fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith(prefix)).sort()
  : [];

if (!stamp) {
  if (!available.length) {
    console.log(`No snapshots for "${room}" yet — they start once the sync server has run for a minute.`);
    process.exit(0);
  }
  console.log(`Snapshots for "${room}":\n`);
  for (const file of available) {
    const doc = read(path.join(SNAPSHOT_DIR, file)).getSnapshot();
    const names = Object.values(doc)
      .filter((n) => n.type !== 'page')
      .map((n) => n.name);
    const when = file.slice(prefix.length, -4).replace('__keep', '');
    const pinned = file.endsWith('__keep.bin') ? '  ← kept (document was wiped after this)' : '';
    console.log(
      `  ${when}  ${String(Object.keys(doc).length).padStart(3)} nodes  ` +
        `${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}${pinned}`,
    );
  }
  console.log(`\nRestore with: pnpm snapshots ${room} <stamp>`);
  process.exit(0);
}

const match = available.find((f) => f.includes(stamp));
if (!match) {
  console.error(`No snapshot matching "${stamp}".`);
  process.exit(1);
}

const from = read(path.join(SNAPSHOT_DIR, match));
const snapshot = from.getSnapshot();
const top = snapshot[ROOT_ID]?.children ?? [];
if (!top.length) {
  console.error(`${match} has nothing on its first page.`);
  process.exit(1);
}

const payload = from.serialize([...top]);
const { store, provider } = await openFile(room);
const before = Object.keys(store.getSnapshot()).length;
const restored = store.paste(payload, ROOT_ID);

// the provider batches; give it a moment to flush before disconnecting
await new Promise((r) => setTimeout(r, 750));
const after = Object.keys(store.getSnapshot()).length;
provider.destroy();
closeAll();

console.log(
  `Restored ${restored.length} top-level layer(s) from ${match} into the live document ` +
    `(${before} → ${after} nodes). Open tabs update immediately.`,
);
process.exit(0);
