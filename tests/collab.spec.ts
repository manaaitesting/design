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
 * What a view-only socket is allowed to say.
 *
 * Read-only access is not "drop every write": a viewer may leave a comment, in
 * Figma and here. Comments share the document with the layers, so the rule has
 * to be enforced on the wire rather than by which map the client happens to
 * write into — and these tests hold both halves of it at once.
 */

const SECRET = 'collab-test-secret';
const PORT = 11_240;

let server: ChildProcess;
let dataDir: string;

function token(fileId: string, role: 'editor' | 'viewer'): string {
  const payload = `tester.${fileId}.${role}.${Date.now() + 3_600_000}`;
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

async function join(
  role: 'editor' | 'viewer',
  room: string,
): Promise<{ store: DocStore; provider: WebsocketProvider }> {
  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  const provider = new WebsocketProvider(`ws://localhost:${PORT}`, room, ydoc, {
    params: { token: token(room, role) },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // two providers in one process would otherwise sync to each other over a
    // BroadcastChannel and never involve the server
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
  return { store, provider };
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlike-collab-'));
  server = spawn('node', ['server/ws.mjs'], {
    env: { ...process.env, AUTH_SECRET: SECRET, SYNC_PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync server never started')), 10_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      if (!chunk.toString().includes('listening')) return;
      clearTimeout(timer);
      resolve();
    });
  });
});

test.afterAll(() => {
  server?.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a view-only member's comment reaches everyone else", async () => {
  const room = 'comment-probe';
  const editor = await join('editor', room);
  editor.store.ensureRoot();
  const viewer = await join('viewer', room);

  const id = viewer.store.addComment({
    page: ROOT_ID,
    x: 40,
    y: 60,
    authorId: 'reviewer',
    authorName: 'Reviewer',
    authorColor: '#F24822',
    body: 'the caption is a line too long',
  });
  await expect
    .poll(() => editor.store.listComments(ROOT_ID).map((comment) => comment.id))
    .toContain(id);

  // a reply and a resolve rewrite the same entry, which on the wire is a
  // deletion as well as an insert — the half that a struct-only check misses
  viewer.store.replyToComment(id, {
    authorName: 'Reviewer',
    authorColor: '#F24822',
    body: 'or drop the second clause',
    createdAt: Date.now(),
  });
  viewer.store.updateComment(id, { resolved: true });
  await expect
    .poll(() => {
      const comment = editor.store.listComments(ROOT_ID).find((c) => c.id === id);
      return [comment?.replies.length, comment?.resolved];
    })
    .toEqual([1, true]);

  editor.provider.destroy();
  viewer.provider.destroy();
});

test('letting a viewer comment does not let them edit', async () => {
  const room = 'carve-out-probe';
  const editor = await join('editor', room);
  editor.store.ensureRoot();
  const cover = editor.store.create('rect', ROOT_ID, { name: 'Cover', w: 40, h: 40 });
  const viewer = await join('viewer', room);
  await expect.poll(() => !!viewer.store.getSnapshot()[cover]).toBe(true);

  viewer.store.create('rect', ROOT_ID, { name: 'Sneaky', w: 10, h: 10 });
  viewer.store.update(cover, { name: 'Renamed' });
  viewer.store.remove([cover]);
  // long enough for a legitimate update to have made the round trip
  await new Promise((resolve) => setTimeout(resolve, 750));

  const nodes = editor.store.getSnapshot();
  expect(Object.values(nodes).some((node) => node.name === 'Sneaky')).toBe(false);
  expect(nodes[cover]?.name).toBe('Cover');

  editor.provider.destroy();
  viewer.provider.destroy();
});
