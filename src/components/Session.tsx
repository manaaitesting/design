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
import type { Identity } from '../collab/identity';
import type { Doc, SceneNode } from '../document/types';
import type { Comment, DocStore, Token } from '../document/store';

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  room,
  identity,
  token,
  children,
}: {
  room: string;
  identity: Identity;
  token: string;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // the session opens a WebSocket, so it must not be created during render/SSR
    setSession(getSession(room, identity, token));
  }, [room, identity, token]);

  useEffect(() => {
    // Development-only handle so the running document can be inspected and
    // driven from the console (and by automated UI audits).
    if (process.env.NODE_ENV === 'development' && session) {
      (window as unknown as { paperlike?: unknown }).paperlike = {
        store: session.store,
        doc: () => session.store.getSnapshot(),
        ui: useUIStore,
      };
    }
  }, [session]);

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

export function useComments(page: string): Comment[] {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getRevision, () => 0);
  return store.listComments(page);
}

/** Tokens as CSS custom properties, applied to the canvas root. */
export function useTokenVars(): Record<string, string> {
  const tokens = useTokens();
  const vars: Record<string, string> = {};
  for (const token of tokens) vars[`--${token.name}`] = token.value;
  return vars;
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
