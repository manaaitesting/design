'use client';

import { create } from 'zustand';

/**
 * The strip of files open at the top of the editor.
 *
 * paper.design's tabs, and the reason they exist there: a design session is
 * rarely one file. You are looking at the marketing page while you build the
 * dashboard, and you are prompting an agent against both. A tab strip makes
 * that a switch rather than a trip back through the file browser.
 *
 * The list is per-browser, not per-document — it is a property of *your*
 * session, like which panels you have open, so it lives in localStorage rather
 * than in the CRDT. Two people in the same file see their own strips.
 */

const KEY = 'paperlike:tabs';

/** Storage is unavailable in private windows and blocked by some settings. */
function persist(tabs: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // a tab strip is not worth breaking navigation over
  }
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export interface TabsState {
  /** Open file ids, in strip order. */
  tabs: string[];
  /**
   * Files closed this session, most recent last — what ⇧⌘T reopens.
   *
   * Session-scoped on purpose: an undo stack that survived a restart would
   * offer to reopen a file you closed last week.
   */
  closed: string[];
  /**
   * False until the saved strip has been read.
   *
   * Reading localStorage during render would make the server and client markup
   * disagree, so the strip shows only the file you are actually on until the
   * effect has run — the same bargain `hydratePanels` makes for panel widths.
   */
  hydrated: boolean;

  /**
   * Reads the saved strip, drops files that are no longer yours, and makes
   * sure the file you are on is in it. Call once on mount.
   */
  hydrate: (active: string, known: string[]) => void;

  /** Adds a file to the end of the strip if it is not already there. */
  open: (id: string) => void;

  /**
   * Closes a tab and says where to go next: the file to its right, else the one
   * to its left, else null for "nothing is open any more".
   */
  close: (id: string) => string | null;

  /** Everything except this one. Returns the id, which is now the only tab. */
  closeOthers: (id: string) => void;
  /** Everything after this one — the browser's "close tabs to the right". */
  closeAfter: (id: string) => void;
  /** Every tab. Returns nothing: the caller is going back to the file browser. */
  closeAll: () => void;
  /** Puts the most recently closed file back, and says which it was. */
  reopen: () => string | null;

  /** Drag-reorder: the tab at `from` lands at `to`. */
  move: (from: number, to: number) => void;

  /** The file `delta` places along from `active`, wrapping at both ends. */
  neighbour: (active: string, delta: number) => string | null;
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  closed: [],
  hydrated: false,

  hydrate: (active, known) => {
    const allowed = new Set(known);
    // a file that was deleted, or unshared, must not linger in the strip —
    // its tab would be a link to a 404
    const saved = read().filter((id) => allowed.has(id));
    const tabs = saved.includes(active) ? saved : [...saved, active];
    persist(tabs);
    set({ tabs, hydrated: true });
  },

  open: (id) =>
    set((state) => {
      if (state.tabs.includes(id)) return state;
      const tabs = [...state.tabs, id];
      persist(tabs);
      return { tabs };
    }),

  close: (id) => {
    const { tabs, closed } = get();
    const index = tabs.indexOf(id);
    if (index < 0) return null;
    const next = [...tabs.slice(0, index), ...tabs.slice(index + 1)];
    persist(next);
    set({ tabs: next, closed: [...closed, id] });
    // the one on the right takes over, as a browser does, and the one on the
    // left only when there is no right
    return next[index] ?? next[index - 1] ?? null;
  },

  closeOthers: (id) =>
    set((state) => {
      persist([id]);
      return { tabs: [id], closed: [...state.closed, ...state.tabs.filter((tab) => tab !== id)] };
    }),

  closeAfter: (id) =>
    set((state) => {
      const index = state.tabs.indexOf(id);
      if (index < 0) return state;
      const tabs = state.tabs.slice(0, index + 1);
      persist(tabs);
      return { tabs, closed: [...state.closed, ...state.tabs.slice(index + 1)] };
    }),

  closeAll: () =>
    set((state) => {
      persist([]);
      return { tabs: [], closed: [...state.closed, ...state.tabs] };
    }),

  reopen: () => {
    const { tabs, closed } = get();
    const id = closed[closed.length - 1];
    if (!id) return null;
    const next = tabs.includes(id) ? tabs : [...tabs, id];
    persist(next);
    set({ tabs: next, closed: closed.slice(0, -1) });
    return id;
  },

  move: (from, to) =>
    set((state) => {
      if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) {
        return state;
      }
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      persist(tabs);
      return { tabs };
    }),

  neighbour: (active, delta) => {
    const { tabs } = get();
    if (tabs.length < 2) return null;
    const index = tabs.indexOf(active);
    if (index < 0) return tabs[0];
    // wrapping is what ⌃⇥ does in every tabbed thing, browsers included
    return tabs[(index + delta + tabs.length) % tabs.length];
  },
}));
