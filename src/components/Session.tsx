'use client';

import {
  createContext,
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

  useEffect(() => {
    // Development-only handle so the running document can be inspected and
    // driven from the console (and by automated UI audits).
    if (process.env.NODE_ENV === 'development' && session) {
      (window as unknown as { paperlike?: unknown }).paperlike = {
        // which file this handle belongs to — a tab switch is a client-side
        // navigation, so without it there is no way to tell "the new file has
        // mounted" from "the old one is still here"
        room,
        store: session.store,
        doc: () => session.store.getSnapshot(),
        ui: useUIStore,
        easingCss,
        evaluate: (condition: string, vars: Record<string, string>) =>
          evaluate(condition, (name) => vars[name]),
      };
      // and gone the moment this file is: a handle left over from the previous
      // file would answer for the next one during a client-side navigation,
      // and anything driving it (an audit, a test's reset) would hit the
      // wrong document
      return () => {
        const w = window as unknown as { paperlike?: { room?: string } };
        if (w.paperlike?.room === room) delete w.paperlike;
      };
    }
  }, [session, room]);

  if (!session) return <Booting />;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function Booting() {
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
      Connecting…
    </div>
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
