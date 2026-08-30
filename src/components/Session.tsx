'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { getSession, type Presence, type Session } from '../collab/session';
import { useUI as useUIStore } from '../state/ui';
import { easingCss } from '../document/prototype';
import { evaluate } from '../document/condition';
import type { Identity } from '../collab/identity';
import type { Doc, SceneNode, StyleKind } from '../document/types';
import type { Comment, DocStore, Style, Token } from '../document/store';
import { defaultModes, publish, tokenVars, type Collection } from '../document/variables';
import type { CustomFont } from '../lib/fonts';

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  room,
  identity,
  token,
  readOnly = false,
  children,
}: {
  room: string;
  identity: Identity;
  token: string;
  /** this member may look but not touch — see `roleOf` in server/auth */
  readOnly?: boolean;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // the session opens a WebSocket, so it must not be created during render/SSR
    setSession(getSession(room, identity, token, readOnly));
  }, [room, identity, token, readOnly]);

  const expired = useExpired(session);
  const ready = useReady(session);
  const stalled = useStalled(ready);

  useEffect(() => {
    // Development-only handle so the running document can be inspected and
    // driven from the console (and by automated UI audits). Hung on `ready`
    // rather than on the session, so that finding the handle means the editor
    // is on screen — a caller that drives the viewport before the editor has
    // mounted is overwritten by it the moment it does.
    if (process.env.NODE_ENV === 'development' && session && ready) {
      (window as unknown as { paperlike?: unknown }).paperlike = {
        // which file this handle belongs to — a tab switch is a client-side
        // navigation, so without it there is no way to tell "the new file has
        // mounted" from "the old one is still here"
        room,
        store: session.store,
        provider: session.provider,
        doc: () => session.store.getSnapshot(),
        ui: useUIStore,
        easingCss,
        evaluate: (condition: string, vars: Record<string, string>) =>
          evaluate(condition, (name) => vars[name]),
      };
    }
  }, [session, ready, room]);

  // The only page in a fresh document is created on the first sync, so until
  // that lands there is nothing to draw on — and the store swallows a write
  // whose parent is missing, which is how a normal-looking canvas came to
  // refuse every gesture in silence.
  if (!session || !ready) return <Booting stalled={stalled} />;
  return (
    <SessionContext.Provider value={session}>
      {children}
      {expired && <Expired />}
    </SessionContext.Provider>
  );
}

/**
 * The session has been refused for good — the token could not be renewed
 * because the file, or this person's access to it, is gone.
 *
 * It blocks, because the alternative is a canvas that accepts edits nothing
 * will ever save. A reload is the only move that helps, so it is the only one
 * offered.
 */
function Expired() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.45)',
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 320,
          padding: 24,
          borderRadius: 12,
          background: 'var(--color-panel)',
          boxShadow: 'var(--shadow-pop)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Your session has expired</p>
        <p style={{ margin: '0 0 16px', color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>
          The sync server is no longer accepting this connection, so nothing changed since it
          dropped has been saved. Reload to carry on.
        </p>
        <button type="button" className="btn btn-raised" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

/** How long the document may take to arrive before it is worth saying so. */
const SYNC_GRACE_MS = 6000;

function Booting({ stalled }: { stalled: boolean }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--color-ink-dim)',
      }}
    >
      {stalled ? (
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 600, color: 'var(--color-ink)' }}>
            Cannot reach the sync server
          </p>
          <p style={{ margin: 0, lineHeight: 1.45 }}>
            This file lives on the server, so there is nothing here to draw on until it answers.
            Still trying…
          </p>
        </div>
      ) : (
        'Connecting…'
      )}
    </div>
  );
}

/** Whether the document has arrived at least once — see `watchReady`. */
function useReady(session: Session | null): boolean {
  const subscribe = useCallback(
    (fn: () => void) => session?.watchReady(fn) ?? (() => {}),
    [session],
  );
  return useSyncExternalStore(subscribe, () => session?.ready() ?? false, () => false);
}

/** Whether the wait has gone on long enough to stop calling it "connecting". */
function useStalled(ready: boolean): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setStalled(true), SYNC_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);
  return stalled;
}

/** Whether this session has been refused for good — see `watchExpiry`. */
function useExpired(session: Session | null): boolean {
  const subscribe = useCallback(
    (fn: () => void) => session?.watchExpiry(fn) ?? (() => {}),
    [session],
  );
  return useSyncExternalStore(
    subscribe,
    () => session?.expired() ?? false,
    () => false,
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

export function useStore(): DocStore {
  return useSession().store;
}

/** True when this member can only look. The store refuses writes either way. */
export function useReadOnly(): boolean {
  return useSession().readOnly;
}

const EMPTY: Doc = {};

export function useDoc(): Doc {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
}

export function useNode(id: string | null | undefined): SceneNode | undefined {
  const doc = useDoc();
  return id ? doc[id] : undefined;
}

/** Pages and tokens live outside the node map, but change on the same tick. */
export function usePages(): string[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listPages();
}

export function useTokens(): Token[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listTokens();
}

/** Faces uploaded into this document, for the menu and for `@font-face`. */
export function useCustomFonts(): CustomFont[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listFonts();
}

/** The variable collections, and the mode each is showing by default. */
export function useCollections(): Collection[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listCollections();
}

export function useDefaultModes(): Record<string, string> {
  const collections = useCollections();
  // a fresh object every render would defeat every memo downstream of it
  return useMemo(() => defaultModes(collections), [collections]);
}

export function useStyles(kind?: StyleKind): Style[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listStyles(kind);
}

export function useComments(page: string): Comment[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listComments(page);
}

/** Token ids mapped to their names, for the `var()` a bound field emits. */
export function useVarNames(): Record<string, string> {
  const tokens = useTokens();
  const names: Record<string, string> = {};
  for (const token of tokens) names[token.id] = token.name;
  return names;
}

/**
 * Tokens as CSS custom properties, applied to the canvas root.
 *
 * These are the default mode of every collection. A frame that overrides a mode
 * re-declares the same names on itself and the cascade takes over — see
 * `document/variables`.
 */
export function useTokenVars(): Record<string, string> {
  const tokens = useTokens();
  const modes = useDefaultModes();
  return useMemo(() => tokenVars(tokens, modes), [tokens, modes]);
}

/**
 * A number variable is published unitless.
 *
 * Whoever uses it supplies the unit — `calc(var(--x) * 1px)` for a length,
 * `calc(var(--x) / 100)` for a ratio. Publishing "16px" instead would make the
 * variable usable as a width and nowhere else.
 */
export function cssValueOf(token: Token): string {
  return publish(token, token.value);
}

/** Everyone else in the room, in a stable order so avatars don't shuffle. */
export function usePresence(): Presence[] {
  const { provider } = useSession();
  const [version, bump] = useState(0);

  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    provider.awareness.on('change', onChange);
    return () => {
      provider.awareness.off('change', onChange);
    };
  }, [provider]);

  return useMemo(() => {
    const local = provider.awareness.clientID;
    const out: Presence[] = [];
    for (const [clientId, state] of provider.awareness.getStates()) {
      if (clientId === local) continue;
      const presence = state as Partial<Presence>;
      if (!presence?.identity) continue;
      out.push({
        clientId,
        identity: presence.identity,
        cursor: presence.cursor ?? null,
        selection: presence.selection ?? [],
        view: presence.view ?? null,
        spotlight: !!presence.spotlight,
        chat: presence.chat ?? null,
        following: presence.following ?? null,
      });
    }
    return out.sort((a, b) => a.clientId - b.clientId);
  }, [provider, version]);
}

export function useConnected(): boolean {
  const { provider } = useSession();
  return useSyncExternalStore(
    (fn) => {
      provider.on('status', fn);
      return () => provider.off('status', fn);
    },
    () => provider.wsconnected,
    () => false,
  );
}
