'use client';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DocStore } from '../document/store';
import type { Identity } from './identity';
import { seedDocument } from '../document/seed';
import { refreshSyncTokenAction } from '../server/actions';

export interface Presence {
  /** awareness connection id — unique per tab, unlike the account id */
  clientId: number;
  identity: Identity;
  /** Pointer position in world (canvas) coordinates. */
  cursor: { x: number; y: number } | null;
  selection: string[];
  /**
   * What this person is looking at, so someone following them can look at the
   * same thing. Published on a throttle — a viewport changes on every frame of
   * a pan, and awareness is not a place to send sixty messages a second.
   */
  view?: { x: number; y: number; zoom: number; w: number; h: number } | null;
  /** they are presenting: everyone else is pulled along behind them */
  spotlight?: boolean;
  /** a line of cursor chat, shown beside their pointer until they clear it */
  chat?: string | null;
  /** who they are following, so two people cannot chase each other in a loop */
  following?: number | null;
}

export interface Session {
  ydoc: Y.Doc;
  store: DocStore;
  provider: WebsocketProvider;
  identity: Identity;
  /** this member may look but not touch */
  readOnly: boolean;
  /** the document has arrived at least once, so there is something to draw on */
  ready(): boolean;
  watchReady(fn: () => void): () => void;
  /** the sync server has refused this session for good and no fresh token can be had */
  expired(): boolean;
  watchExpiry(fn: () => void): () => void;
  destroy(): void;
}

/** A one-way switch with listeners: it is thrown once, and everyone hears. */
function latch() {
  const watchers = new Set<() => void>();
  let thrown = false;
  return {
    get: () => thrown,
    watch(fn: () => void): () => void {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    throw() {
      if (thrown) return;
      thrown = true;
      for (const fn of watchers) fn();
    },
  };
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
export function getSession(
  room: string,
  identity: Identity,
  token: string,
  readOnly = false,
): Session {
  const existing = cache.get(room);
  if (existing) return existing;

  const ydoc = new Y.Doc();
  const store = new DocStore(ydoc);
  // The sync server drops writes from a viewer's socket regardless; this stops
  // them locally too, so a read-only session never shows an edit that is about
  // to be thrown away.
  store.readOnly = readOnly;
  const provider = new WebsocketProvider(syncUrl(), room, ydoc, {
    connect: true,
    params: { token },
  });

  provider.awareness.setLocalStateField('identity', identity);
  provider.awareness.setLocalStateField('cursor', null);
  provider.awareness.setLocalStateField('selection', []);
  provider.awareness.setLocalStateField('view', null);
  provider.awareness.setLocalStateField('spotlight', false);
  provider.awareness.setLocalStateField('chat', null);
  provider.awareness.setLocalStateField('following', null);

  // Seed only once the server has told us what it already has, otherwise every
  // client would race to create its own starter artboards.
  provider.once('sync', (isSynced: boolean) => {
    if (!isSynced || readOnly) return;
    store.ensureRoot();
    seedDocument(store);
  });

  const expired = latch();

  /**
   * The token was minted when the page was rendered and lives an hour, so a tab
   * open longer than that reconnects with a credential the sync server has
   * already stopped accepting — and 4401 is a close y-websocket treats as
   * final, so without this the first refusal past the hour would be the last.
   * Mint another and carry on; if the answer is that there is no access any
   * more, stop and let the UI say so instead of retrying against a shut door.
   */
  provider.on('closed', ({ code }: { code: number }) => {
    if (code !== 4401 || expired.get()) return;
    void (async () => {
      const fresh = await refreshSyncTokenAction(room).catch(() => null);
      if (fresh) {
        provider.params.token = fresh;
        provider.connect();
        return;
      }
      expired.throw();
    })();
  });

  /**
   * Latched rather than tracked, because the provider's own `synced` goes back
   * to false on every drop and blanking a canvas somebody is drawing on would
   * be a worse answer to a blip than the blip. What this marks is the one
   * moment that matters: the document has been here.
   */
  const ready = latch();
  provider.on('sync', (isSynced: boolean) => {
    if (isSynced) ready.throw();
  });

  const session: Session = {
    ydoc,
    store,
    provider,
    identity,
    readOnly,
    ready: ready.get,
    watchReady: ready.watch,
    expired: expired.get,
    watchExpiry: expired.watch,
    destroy() {
      provider.destroy();
      ydoc.destroy();
      cache.delete(room);
    },
  };
  cache.set(room, session);
  return session;
}
