'use client';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DocStore } from '../document/store';
import type { Identity } from './identity';
import { seedDocument } from '../document/seed';

export interface Presence {
  /** awareness connection id — unique per tab, unlike the account id */
  clientId: number;
  identity: Identity;
  /** Pointer position in world (canvas) coordinates. */
  cursor: { x: number; y: number } | null;
  selection: string[];
}

export interface Session {
  ydoc: Y.Doc;
  store: DocStore;
  provider: WebsocketProvider;
  identity: Identity;
  destroy(): void;
}

function syncUrl(): string {
  const env = process.env.NEXT_PUBLIC_SYNC_URL;
  if (env) return env;
  const { protocol, hostname } = window.location;
  const scheme = protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${hostname}:1234`;
}

const cache = new Map<string, Session>();

/**
 * One session per room, cached so React re-mounts (fast refresh, route changes)
 * don't open a second socket and duplicate the presence list.
 *
 * `token` is the HMAC the sync server checks before letting this socket join —
 * see `issueSyncToken` in src/server/auth.ts.
 */
export function getSession(room: string, identity: Identity, token: string): Session {
  const existing = cache.get(room);
  if (existing) return existing;

  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  const provider = new WebsocketProvider(syncUrl(), room, ydoc, {
    connect: true,
    params: { token },
  });

  provider.awareness.setLocalStateField('identity', identity);
  provider.awareness.setLocalStateField('cursor', null);
  provider.awareness.setLocalStateField('selection', []);

  // Seed only once the server has told us what it already has, otherwise every
  // client would race to create its own starter artboards.
  provider.once('sync', (isSynced: boolean) => {
    if (!isSynced) return;
    store.ensureRoot();
    seedDocument(store);
  });

  const session: Session = {
    ydoc,
    store,
    provider,
    identity,
    destroy() {
      provider.destroy();
      ydoc.destroy();
      cache.delete(room);
    },
  };
  cache.set(room, session);
  return session;
}
