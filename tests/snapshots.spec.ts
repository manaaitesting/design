import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
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

function token(fileId: string): string {
  const payload = `tester.${fileId}.${Date.now() + 3_600_000}`;
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

async function join(): Promise<{ store: DocStore; provider: WebsocketProvider }> {
  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  const provider = new WebsocketProvider(`ws://localhost:${PORT}`, ROOM, ydoc, {
    params: { token: token(ROOM) },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
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
