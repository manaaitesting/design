'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDoc, useReadOnly, useStore, useTokenVars } from './Session';
import { inverseOf } from '../document/selection';
import { useUI } from '../state/ui';
import { openingFrame } from '../document/prototype';
import { descendants, ROOT_ID, type Doc } from '../document/types';
import { TYPE_LABEL } from '../document/defaults';
import { componentize, componentizeEach, rasterizeSelection } from '../lib/actions';

/**
 * Quick actions.
 *
 * Figma's ⌘/ is the fastest thing in the app once you know it exists: every
 * command by name, and every layer by name, in one list. Ranking is deliberately
 * simple — a name that starts with what you typed beats one that merely contains
 * it — because anything cleverer makes the first result unpredictable, and an
 * unpredictable first result is the one thing a palette must not have.
 */

interface Entry {
  id: string;
  label: string;
  hint?: string;
  /** commands a viewer cannot run */
  writes?: boolean;
  run: () => void;
}

export function Palette() {
  const doc = useDoc();
  const store = useStore();
  const readOnly = useReadOnly();
  const tokenVars = useTokenVars();
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const entries = useMemo(
    () => (open ? [...commands(doc, store, tokenVars), ...layerEntries(doc)] : []),
    [open, doc, store],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const allowed = entries.filter((entry) => !readOnly || !entry.writes);
    if (!needle) return allowed.slice(0, 12);
    return allowed
      .map((entry) => {
        const name = entry.label.toLowerCase();
        const at = name.indexOf(needle);
        if (at < 0) return null;
        return { entry, rank: at === 0 ? 0 : 1, at };
      })
      .filter((hit): hit is { entry: Entry; rank: number; at: number } => !!hit)
      .sort((a, b) => a.rank - b.rank || a.at - b.at || a.entry.label.length - b.entry.label.length)
      .slice(0, 30)
      .map((hit) => hit.entry);
  }, [entries, query, readOnly]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  if (!open) return null;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    setOpen(false);
    entry.run();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '14vh',
      }}
      onPointerDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div
        style={{
          width: 460,
          maxWidth: '90vw',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <input
          autoFocus
          value={query}
          placeholder="Run a command or jump to a layer…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              choose(results[active]);
            }
          }}
          style={{
            width: '100%',
            height: 44,
            border: 0,
            borderBottom: '1px solid var(--fig-line)',
            padding: '0 14px',
            background: 'transparent',
            font: 'inherit',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <div ref={listRef} className="scroll" style={{ maxHeight: 320 }}>
          {results.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className="fig-palette-row"
              data-on={index === active}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(entry)}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>{entry.label}</span>
              {entry.hint && <span style={{ opacity: 0.5 }}>{entry.hint}</span>}
            </button>
          ))}
          {!results.length && <p className="fig-hint">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>
  );
}

/** Every command the palette can run, in the order they are offered by default. */
function commands(doc: Doc, store: ReturnType<typeof useStore>, tokenVars: Record<string, string>): Entry[] {
  const ui = () => useUI.getState();
  const selection = () => ui().selection;
  const pick = (ids: string[]) => ui().select(ids);

  const make = (id: string, label: string, run: () => void, hint?: string, writes = true): Entry => ({
    id,
    label,
    hint,
    writes,
    run,
  });

  return [
    make('frame', 'Frame selection', () => {
      const framed = store.wrapInFlex(selection(), false);
      if (framed) pick([framed]);
    }, '⇧F'),
    make('auto-layout', 'Add auto layout', () => {
      const id = store.autoLayoutSelection(selection());
      if (id) pick([id]);
    }, '⇧A'),
    make('select-inverse', 'Select inverse', () => {
      const state = ui();
      const level = state.entered && doc[state.entered] ? state.entered : state.page;
      pick(inverseOf(state.selection, doc, level));
    }, '⇧⌘A', false),
    make('group', 'Group selection', () => {
      const id = store.group(selection());
      if (id) pick([id]);
    }, '⌘G'),
    make('ungroup', 'Ungroup', () => {
      const freed = store.ungroup(selection());
      if (freed.length) pick(freed);
    }, '⇧⌘G'),
    make('component', 'Create component', () => {
      const made = componentize(store, selection());
      if (made) pick([made]);
    }, '⌥⌘K'),
    make('components', 'Create multiple components', () => {
      componentizeEach(store, selection());
    }),
    // Figma keeps these off the right-click menu and in here, where a name finds them
    make('section', 'Create section', () => {
      const id = store.wrapInSection(selection());
      if (id) pick([id]);
    }, '⇧S'),
    make('rasterize', 'Rasterize selection', () => {
      void rasterizeSelection(store, selection(), ui().viewport.zoom, tokenVars).then((made) => {
        if (made.length) pick(made);
      });
    }),
    make('duplicate', 'Duplicate', () => pick(store.duplicate(selection())), '⌘D'),
    make('rename', 'Rename', () => ui().setRenameOpen(true), '⌘R', false),
    make('forward', 'Bring forward', () => store.reorder(selection(), 'forward'), '⌘]'),
    make('backward', 'Send backward', () => store.reorder(selection(), 'backward'), '⌘['),
    make('delete', 'Delete', () => {
      store.remove(selection());
      pick([]);
    }, '⌫'),
    make('union', 'Union selection', () => runBoolean(store, 'union'), '⌥⌘U'),
    make('subtract', 'Subtract selection', () => runBoolean(store, 'subtract'), '⌥⌘S'),
    make('intersect', 'Intersect selection', () => runBoolean(store, 'intersect'), '⌥⌘I'),
    make('exclude', 'Exclude selection', () => runBoolean(store, 'exclude'), '⌥⌘E'),
    make('mask', 'Use as mask', () => store.toggleMask(selection()), '⌃⌘M'),
    make('flatten', 'Flatten', () => {
      const flattened = store.flatten(selection());
      if (flattened) {
        pick([flattened]);
        ui().setVectorEdit(flattened);
      }
    }, '⌘E'),
    make('outline-stroke', 'Outline stroke', () => {
      const made = store.outlineStroke(selection());
      if (made.length) pick(made);
    }, '⇧⌘O'),
    make('tidy', 'Tidy up', () => store.tidyUp(selection())),
    make('resize-to-fit', 'Resize to fit', () => store.resizeToFit(selection())),
    make('flip-h', 'Flip horizontal', () =>
      store.updateMany(selection(), (node) => ({ flipH: !node.flipH })), '⇧H'),
    make('flip-v', 'Flip vertical', () =>
      store.updateMany(selection(), (node) => ({ flipV: !node.flipV })), '⇧V'),
    make('lock', 'Lock / unlock', () =>
      store.updateMany(selection(), (node) => ({ locked: !node.locked })), '⇧⌘L'),
    make('hide', 'Show / hide', () =>
      store.updateMany(selection(), (node) => ({ visible: !node.visible })), '⇧⌘H'),

    make('rulers', 'Toggle rulers', () => ui().toggleRulers(), '⇧R', false),
    make('inspect', 'Inspect (dev handoff)', () => ui().setInspectorTab('inspect'), '⇧D', false),
    make('prototype', 'Prototype tab', () => ui().setInspectorTab('prototype'), undefined, false),
    make('assets', 'Assets panel', () => ui().setTab('assets'), undefined, false),
    make('variables', 'Variables panel', () => ui().setTab('theme'), undefined, false),
    make('export', 'Export…', () => ui().setExportOpen(true), '⇧⌘E', false),
    make('present', 'Present', () => {
      const state = ui();
      state.present(openingFrame(doc, state.page, state.selection));
    }, '⇧⌘⏎', false),
    make('shaders', 'Shaders…', () => ui().setShadersOpen(true), undefined, false),
    make('zoom-100', 'Zoom to 100%', () =>
      ui().setViewport((vp) => ({ ...vp, zoom: 1 })), '⌘0', false),
    make('panel', 'Toggle left panel', () => ui().toggleLeftPanel(), undefined, false),
  ];
}

function runBoolean(
  store: ReturnType<typeof useStore>,
  op: 'union' | 'subtract' | 'intersect' | 'exclude',
): void {
  const ui = useUI.getState();
  const id = store.booleanGroup(ui.selection, op);
  if (id) ui.select([id]);
}

/** Every layer on the current page, so the palette doubles as find-in-file. */
function layerEntries(doc: Doc): Entry[] {
  const pageId = useUI.getState().page;
  const page = doc[pageId] ?? doc[ROOT_ID];
  if (!page) return [];

  return descendants(page.id, doc)
    .map((id) => doc[id])
    .filter((node) => !!node)
    .slice(0, 500)
    .map((node) => ({
      id: `layer-${node.id}`,
      label: node.name,
      hint: TYPE_LABEL[node.type],
      writes: false,
      run: () => {
        const ui = useUI.getState();
        ui.select([node.id]);
        ui.setExpanded(ancestorsOf(node.id, doc), true);
        centreOn(node.id);
      },
    }));
}

/**
 * Brings a layer into the middle of the canvas.
 *
 * The position is measured off the rendered element rather than the node's
 * x/y: a nested or flowed layer's coordinates are relative to its parent, and
 * only the browser knows where that put it.
 */
function centreOn(id: string): void {
  const canvas = document.querySelector<HTMLElement>('[data-canvas-root]');
  const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!canvas || !el) return;
  const base = canvas.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const ui = useUI.getState();
  const { zoom, x, y } = ui.viewport;
  // where the layer's centre sits in world coordinates
  const world = {
    x: (box.left + box.width / 2 - base.left - x) / zoom,
    y: (box.top + box.height / 2 - base.top - y) / zoom,
  };
  ui.setViewport((vp) => ({
    ...vp,
    x: base.width / 2 - world.x * vp.zoom,
    y: base.height / 2 - world.y * vp.zoom,
  }));
}

function ancestorsOf(id: string, doc: Doc): string[] {
  const out: string[] = [];
  let current = doc[id]?.parent;
  while (current && doc[current]) {
    out.push(current);
    current = doc[current].parent;
  }
  return out;
}
