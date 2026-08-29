import { createHmac } from 'node:crypto';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { DocStore } from '../src/document/store';
import type { Doc } from '../src/document/types';

/**
 * Live document access for the MCP server.
 *
 * The server joins each file over the same authenticated WebSocket the editor
 * uses, so an agent reads and writes the *running* document — edits appear on
 * every open canvas immediately, and the CRDT merges them with whatever a human
 * is doing at the same moment. No import/export round trip.
 */

const SYNC_URL = process.env.SYNC_URL ?? 'ws://localhost:1234';
const AGENT_ID = 'mcp-agent';

function syncToken(fileId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set — copy .env.example to .env.local.');
  const expires = Date.now() + 60 * 60 * 1000;
  // the agent edits the live document, so it joins as an editor — the role is
  // inside the signature the sync server checks
  const payload = `${AGENT_ID}.${fileId}.editor.${expires}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

interface Session {
  ydoc: Y.Doc;
  store: DocStore;
  provider: WebsocketProvider;
}

const sessions = new Map<string, Promise<Session>>();

/** Joins a file and resolves once the server has sent its state. */
export function openFile(fileId: string): Promise<Session> {
  const existing = sessions.get(fileId);
  if (existing) return existing;

  const opening = new Promise<Session>((resolve, reject) => {
    const ydoc = new Y.Doc();
    const store = new DocStore(ydoc);
    const provider = new WebsocketProvider(SYNC_URL, fileId, ydoc, {
      params: { token: syncToken(fileId) },
      // y-websocket expects a browser WebSocket; ws is the Node equivalent
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    });

    const timer = setTimeout(() => {
      provider.destroy();
      sessions.delete(fileId);
      reject(new Error(`Timed out joining "${fileId}". Is the sync server running?`));
    }, 8000);

    provider.once('sync', (isSynced: boolean) => {
      if (!isSynced) return;
      clearTimeout(timer);
      // A file that has never been opened in a browser has no page yet, and
      // every mutation hangs its node off one. The editor does this on connect;
      // an agent joining first has to do it too, or `create_node` writes into a
      // document with no root.
      store.ensureRoot();
      resolve({ ydoc, store, provider });
    });
  });

  sessions.set(fileId, opening);
  return opening;
}

export function closeAll(): void {
  for (const pending of sessions.values()) {
    pending.then((s) => s.provider.destroy()).catch(() => undefined);
  }
  sessions.clear();
}

/**
 * Compact tree, in the spirit of Figma's get_metadata — ids, types, boxes.
 *
 * `limit` stops the walk at a given number of levels. A row that was cut short
 * says how many children are still under it, so an agent knows to ask again
 * rather than assuming the layer is empty.
 */
export function outline(
  doc: Doc,
  rootId: string,
  depth = 0,
  out: string[] = [],
  limit?: number,
): string[] {
  const node = doc[rootId];
  if (!node) return out;
  const size = node.type === 'page' ? '' : ` ${Math.round(node.w)}×${Math.round(node.h)} @ ${Math.round(node.x)},${Math.round(node.y)}`;
  const flags = [
    node.flex ? `flex:${node.flex.mode === 'grid' ? 'grid' : node.flex.direction}` : '',
    node.visible ? '' : 'hidden',
    node.locked ? 'locked' : '',
  ].filter(Boolean);
  const cut = limit !== undefined && depth + 1 >= limit && node.children.length > 0;
  const more = cut ? `  … ${node.children.length} more inside` : '';
  out.push(
    `${'  '.repeat(depth)}${node.type} "${node.name}" id=${node.id}${size}${flags.length ? ` [${flags.join(' ')}]` : ''}${more}`,
  );
  if (cut) return out;
  for (const child of node.children) outline(doc, child, depth + 1, out, limit);
  return out;
}
