import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { DocStore } from '../src/document/store';
import { ROOT_ID } from '../src/document/types';

/**
 * The document has been destroyed twice by an ordinary ⌘A + Delete. Undo is
 * per-tab and dies with it, so the only real safety net is the sync server's
 * history — and a rolling window is not enough, because after a wipe the good
 * states rotate out while the empty ones accumulate. These tests pin the two
 * behaviours that make recovery actually possible.
 */

const SECRET = 'snapshot-test-secret';
const PORT = 11_234;
const ROOM = 'wipe-probe';

let server: ChildProcess;
let dataDir: string;

function token(fileId: string, role: 'editor' | 'viewer' = 'editor'): string {
  // the role is inside the signature the sync server checks, which is what
  // stops a client asking for more than it was given
  const payload = `tester.${fileId}.${role}.${Date.now() + 3_600_000}`;
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

async function join(
  role: 'editor' | 'viewer' = 'editor',
  room = ROOM,
  port = PORT,
): Promise<{ store: DocStore; provider: WebsocketProvider }> {
  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  const provider = new WebsocketProvider(`ws://localhost:${port}`, room, ydoc, {
    params: { token: token(room, role) },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Two providers in one process would otherwise sync to each other over a
    // BroadcastChannel and never involve the server — which is the only thing
    // these tests are actually about.
    disableBc: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync server never synced')), 10_000);
    provider.on('sync', (ok: boolean) => {
      if (!ok) return;
      clearTimeout(timer);
      resolve();
    });
  });
  store.ensureRoot();
  return { store, provider };
}

const snapshots = () => {
  const dir = path.join(dataDir, 'snapshots');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlike-snap-'));
  server = spawn('node', ['server/ws.mjs'], {
    env: { ...process.env, AUTH_SECRET: SECRET, SYNC_PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync server never started')), 10_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

test.afterAll(() => {
  server?.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

/**
 * A viewer's socket is the half of read-only access that has to hold when the
 * client is not the one we shipped. The editor hides its tools; this is what
 * stops a modified client, or a script, writing anyway.
 */
test('the sync server drops writes from a view-only member', async () => {
  const room = 'viewer-probe';
  const editor = await join('editor', room);
  const viewer = await join('viewer', room);

  viewer.store.create('rect', ROOT_ID, { name: 'Sneaky', w: 10, h: 10 });
  // long enough for a legitimate update to have made the round trip
  await new Promise((resolve) => setTimeout(resolve, 750));
  expect(Object.values(editor.store.getSnapshot()).some((n) => n.name === 'Sneaky')).toBe(false);

  // and the same write from an editor does land, so the test is not vacuous
  editor.store.create('rect', ROOT_ID, { name: 'Allowed', w: 10, h: 10 });
  await expect
    .poll(() => Object.values(viewer.store.getSnapshot()).some((n) => n.name === 'Allowed'))
    .toBe(true);

  editor.provider.destroy();
  viewer.provider.destroy();
});

test('a wipe pins the state that preceded it', async () => {
  const { store, provider } = await join();

  for (let i = 0; i < 6; i++) {
    store.create('rect', ROOT_ID, { name: `Keep ${i}`, x: i * 40, y: 0, w: 30, h: 30 });
  }
  // the first save after a restart establishes the baseline
  await expect.poll(snapshots, { timeout: 15_000 }).not.toHaveLength(0);
  expect(snapshots().some((f) => f.endsWith('__keep.bin'))).toBe(false);

  // ⌘A + Delete
  store.remove([...store.getSnapshot()[ROOT_ID].children]);
  await expect.poll(() => snapshots().filter((f) => f.endsWith('__keep.bin')), { timeout: 15_000 })
    .toHaveLength(1);

  const pinned = snapshots().find((f) => f.endsWith('__keep.bin'))!;
  const rescued = new Y.Doc();
  Y.applyUpdate(rescued, new Uint8Array(fs.readFileSync(path.join(dataDir, 'snapshots', pinned))));
  expect(new DocStore(rescued).getSnapshot()[ROOT_ID].children).toHaveLength(6);

  provider.destroy();
});

test('restoring re-inserts content that a connected client already deleted', async () => {
  const { store, provider } = await join();
  expect(store.getSnapshot()[ROOT_ID].children).toHaveLength(0);

  const pinned = snapshots().find((f) => f.endsWith('__keep.bin'))!;
  const source = new Y.Doc();
  Y.applyUpdate(source, new Uint8Array(fs.readFileSync(path.join(dataDir, 'snapshots', pinned))));
  const from = new DocStore(source);

  // the restore path: paste, not a file swap — this client still holds the
  // deletions, and a file swap would simply re-apply them on reconnect
  store.paste(from.serialize([...from.getSnapshot()[ROOT_ID].children]), ROOT_ID);

  await expect.poll(() => store.getSnapshot()[ROOT_ID].children.length).toBe(6);
  provider.destroy();
});

/**
 * A room the last person leaves has to be *freed*, not merely forgotten.
 *
 * Awareness runs an interval to expire stale peers, and that timer keeps the
 * awareness — and through it the entire document — reachable however many
 * references the server drops. The server ran for weeks like that and nobody
 * noticed; then the editor suite, which opens and closes the same room once per
 * test, walked it into a 4 GB heap and killed it two thirds of the way through.
 *
 * So the assertion is the thing that actually broke: a server given a small
 * heap still has to survive being used. Leaking, it dies here in single-figure
 * cycles; freeing, its live set is one document and it never comes close.
 */
test('a room that goes idle is freed, not just forgotten', async () => {
  const port = PORT + 1;
  const room = 'leak-probe';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlike-leak-'));
  const capped = spawn('node', ['--max-old-space-size=192', 'server/ws.mjs'], {
    env: { ...process.env, AUTH_SECRET: SECRET, SYNC_PORT: String(port), DATA_DIR: dir },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('capped sync server never started')), 10_000);
    capped.stdout!.on('data', (chunk: Buffer) => {
      if (!chunk.toString().includes('listening')) return;
      clearTimeout(timer);
      resolve();
    });
  });

  /** One full round trip: join, edit, leave — open through release. */
  async function cycle(fill?: (store: DocStore) => void): Promise<void> {
    const { store, provider } = await join('editor', room, port);
    if (fill) fill(store);
    else store.create('rect', ROOT_ID, { name: 'touch' });
    // the release path only runs once the server has seen the socket close
    await new Promise((resolve) => setTimeout(resolve, 120));
    provider.destroy();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  try {
    // a document with some substance, so a retained copy of it costs something
    await cycle((store) => {
      store.ydoc.transact(() => {
        for (let index = 0; index < 3_000; index++) {
          store.create('rect', ROOT_ID, { name: `layer ${index}` });
        }
      });
    });
    for (let round = 0; round < 12; round++) {
      await cycle();
      expect(capped.exitCode, `the sync server died after ${round + 1} idle rooms`).toBeNull();
    }

    // and it is still a working server, not merely a living process
    const { store, provider } = await join('editor', room, port);
    expect(store.getSnapshot()[ROOT_ID].children.length).toBeGreaterThan(3_000);
    provider.destroy();
  } finally {
    capped.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
