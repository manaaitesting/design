'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import { FigButton } from './ui/Figma';
import { useCollections, useDoc, usePages, useReadOnly, useSession, useStore, useTokens } from './Session';
import {
  fetchLibraryComponentAction,
  listLibraryAction,
  publishComponentAction,
  type LibraryEntry,
} from '../server/actions';
import {
  BOOLEAN_SCOPES,
  COLOR_SCOPES,
  DEFAULT_COLLECTION,
  DEFAULT_COLLECTION_ID,
  NUMBER_SCOPES,
  SCOPE_LABEL,
  type VarScope,
} from '../document/variables';
import type { Token } from '../document/types';
import { PANEL, pageActions, useUI } from '../state/ui';
import { viewCentre as canvasCentre } from '../lib/view';
import { ancestors, descendants, ROOT_ID, type NodeType } from '../document/types';
import {
  flattenLayers,
  isContainer,
  searchLayers,
  isLegalDrop,
  movingNodes,
  placementFor,
  rangeBetween,
  type DropTarget,
  type LayerRow as Row,
} from '../document/layers';

/** Row indent per nesting level, in px. The drop line uses it too. */
const INDENT = 14;
// the row is inset 6px, so the glyph column starts 6px in to land where it did
const GUTTER = 10;
/** How long a collapsed frame has to sit under the pointer before it opens. */
const SPRING_OPEN_MS = 500;

const TYPE_ICON: Record<NodeType, React.ReactNode> = {
  page: <Icon.Page />,
  section: <Icon.Section />,
  frame: <Icon.Frame />,
  rect: <Icon.Square />,
  ellipse: <Icon.Circle />,
  text: <Icon.Text />,
  image: <Icon.ImageAi />,
  shader: <Icon.Shader />,
  vector: <Icon.Pen />,
  polygon: <Icon.Polygon />,
  star: <Icon.Star />,
  line: <Icon.Line />,
  arrow: <Icon.Arrow />,
  boolean: <Icon.Boolean op="union" />,
  slice: <Icon.Slice />,
};

/**
 * Runs a layer drag.
 *
 * Press decides the selection the way a file list does — plain click replaces,
 * ⌘ toggles, ⇧ takes the range from the anchor — and a press on a row that is
 * already part of a multi-selection holds that selection so the whole group can
 * be dragged, narrowing it only if the pointer never moved.
 */
function useLayerDrag(rows: Row[], reorderable = true) {
  const store = useStore();
  const [dragging, setDragging] = useState<string[]>([]);
  const [target, setTarget] = useState<DropTarget | null>(null);

  // the listeners below outlive the render that installed them, and a spring
  // -loaded frame opening mid-drag changes the rows under the pointer
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const press = (id: string, event: React.PointerEvent) => {
    const ui = useUI.getState();
    const doc = store.getSnapshot();
    const mod = event.metaKey || event.ctrlKey;
    let deferred = false;

    if (event.shiftKey && ui.anchor && ui.anchor !== id) {
      ui.select(rangeBetween(rowsRef.current, ui.anchor, id));
    } else if (mod) {
      ui.toggle(id);
      ui.setAnchor(id);
    } else if (ui.selection.length > 1 && ui.selection.includes(id)) {
      deferred = true;
    } else {
      ui.select([id]);
      ui.setAnchor(id);
      // so a following click on the canvas selects siblings, not the artboard
      const parent = doc[id]?.parent;
      ui.setEntered(parent && doc[parent]?.type !== 'page' ? parent : null);
    }

    // A filtered tree is not the stacking order, so there is nowhere honest for
    // a drop to land in it. Pressing still selects; it just cannot restack.
    if (!reorderable) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const moving = movingNodes(
      useUI.getState().selection.includes(id) ? useUI.getState().selection : [id],
      rowsRef.current,
    );
    let active = false;
    let drop: DropTarget | null = null;
    let springId: string | null = null;
    let spring: ReturnType<typeof setTimeout> | null = null;

    const cancelSpring = () => {
      if (spring) clearTimeout(spring);
      spring = null;
      springId = null;
    };

    /**
     * The list scrolls itself while a layer is held near its edge.
     *
     * Without it a drop target that was off-screen when the press started is
     * unreachable: you cannot scroll with the pointer down, so a layer at the
     * bottom of a long file could never be dropped into a frame at the top.
     * The speed ramps with how far into the edge you push, which is how Figma
     * makes both a nudge and a long haul possible with one gesture. The target
     * follows for free — it is recomputed from `elementFromPoint` every move,
     * and scrolling fires more moves.
     */
    let edge = 0;
    let scrolling: number | null = null;
    const runScroll = () => {
      scrolling = null;
      if (!edge) return;
      const list = document.querySelector<HTMLElement>('[data-layers-list]');
      if (list) list.scrollTop += edge;
      scrolling = requestAnimationFrame(runScroll);
    };
    const scrollNear = (y: number) => {
      const list = document.querySelector<HTMLElement>('[data-layers-list]');
      if (!list) return;
      const box = list.getBoundingClientRect();
      const zone = 28;
      const over = y - (box.bottom - zone);
      const under = box.top + zone - y;
      edge = over > 0 ? Math.min(18, over) : under > 0 ? -Math.min(18, under) : 0;
      if (edge && scrolling === null) scrolling = requestAnimationFrame(runScroll);
    };
    const stopScroll = () => {
      edge = 0;
      if (scrolling !== null) cancelAnimationFrame(scrolling);
      scrolling = null;
    };

    const move = (e: PointerEvent) => {
      if (!active) {
        // a few pixels of slop so a plain click still selects
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        active = true;
        setDragging(moving);
      }

      scrollNear(e.clientY);
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '[data-layer-id]',
      );
      const overId = el?.dataset.layerId;
      const snap = store.getSnapshot();
      // a row being dragged, or living inside one, is not somewhere to drop it
      if (!overId || !snap[overId] || !isLegalDrop(snap, moving, overId)) {
        cancelSpring();
        drop = null;
        setTarget(null);
        return;
      }

      const rect = el!.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const container = isContainer(snap[overId]);
      const where: DropTarget['where'] =
        container && ratio > 0.25 && ratio < 0.75 ? 'inside' : ratio < 0.5 ? 'above' : 'below';

      // Figma springs a closed frame open when you hover it holding layers
      if (overId !== springId) {
        cancelSpring();
        const row = rowsRef.current.find((r) => r.id === overId);
        if (container && row?.hasChildren && !row.open) {
          springId = overId;
          spring = setTimeout(() => useUI.getState().setExpanded([overId], true), SPRING_OPEN_MS);
        }
      }

      drop = { id: overId, where };
      setTarget(drop);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cancelSpring();
      stopScroll();
      setDragging([]);
      setTarget(null);

      if (!active) {
        // a click that never became a drag: now narrow to the row pressed
        if (deferred) {
          useUI.getState().select([id]);
          useUI.getState().setAnchor(id);
        }
        return;
      }
      if (!drop) return;

      const snap = store.getSnapshot();
      const placement = placementFor(snap, drop);
      if (!placement || !isLegalDrop(snap, moving, placement.parent)) return;
      store.moveMany(moving, placement.parent, placement.index);
      // the layers have to be visible where they landed
      if (drop.where === 'inside') useUI.getState().setExpanded([placement.parent], true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { dragging, target, press };
}

type Drag = ReturnType<typeof useLayerDrag>;

export function LeftPanel({ fileName }: { fileName: string }) {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  /** the layer search: closed by default, as Figma keeps it */
  const [searching, setSearching] = useState(false);
  const [layerQuery, setLayerQuery] = useState('');
  const toggleLeftPanel = useUI((s) => s.toggleLeftPanel);
  const width = useUI((s) => s.leftWidth);

  return (
    <div className="fig-left" style={{ width }}>
      <div className="fig-left-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 550,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </div>
          <Link href="/files" style={{ color: 'var(--fig-dim)', textDecoration: 'none' }}>
            All files
          </Link>
        </div>
        <button type="button" className="fig-btn" title="Hide panel" onClick={toggleLeftPanel}>
          <Icon.PanelToggle />
        </button>
      </div>

      <div className="fig-tabs" style={{ height: 32, borderTop: '1px solid var(--fig-line)' }}>
        <button type="button" className="fig-tab" data-on={tab === 'design'} onClick={() => setTab('design')}>
          Design
        </button>
        <button type="button" className="fig-tab" data-on={tab === 'assets'} onClick={() => setTab('assets')}>
          Assets
        </button>
        <button type="button" className="fig-tab" data-on={tab === 'theme'} onClick={() => setTab('theme')}>
          Theme
        </button>
      </div>

      {tab === 'design' && (
        <>
          <PagesSection />
          <div className="fig-left-section" style={{ borderTop: '1px solid var(--fig-line)' }}>
            {searching ? (
              <input
                autoFocus
                value={layerQuery}
                placeholder="Search layers"
                aria-label="Search layers"
                // the canvas owns most single keys, and a layer called "Frame 5"
                // cannot be typed if F arms the frame tool halfway through
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    setLayerQuery('');
                    setSearching(false);
                  }
                }}
                onChange={(event) => setLayerQuery(event.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 22,
                  border: 0,
                  borderRadius: 5,
                  padding: '0 6px',
                  background: 'var(--color-control)',
                  color: 'inherit',
                  font: 'inherit',
                }}
              />
            ) : (
              <span style={{ flex: 1 }}>Layers</span>
            )}
            <FigButton
              title="Search layers"
              on={searching}
              onClick={() => {
                setSearching((open) => !open);
                setLayerQuery('');
              }}
            >
              <Icon.Search />
            </FigButton>
            <FigButton
              title="Collapse layers  ⌥L"
              onClick={() => useUI.getState().collapseLayers()}
            >
              <FigIcon name="Collapse layers" />
            </FigButton>
          </div>
          <LayersTree query={searching ? layerQuery : ''} />
        </>
      )}
      {tab === 'assets' && <AssetsTab />}
      {tab === 'theme' && <ThemeTab />}

    </div>
  );
}

/**
 * Figma's Pages panel.
 *
 * Three things make it that rather than a list: the title is a disclosure that
 * collapses the whole thing, the list is its own scroll region with a fixed
 * height rather than growing until it pushes Layers off the panel, and the rule
 * beneath it is a drag handle that sets that height. The rows are a grid so a
 * screen reader reads "row 2 of 5, selected" instead of five loose buttons.
 */
function PagesSection() {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** the magnifier in this header, which used to be a picture of one */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const doc = useDoc();
  const store = useStore();
  const allPages = usePages();
  const active = useUI((s) => s.page);
  const setPage = useUI((s) => s.setPage);
  const height = useUI((s) => s.pagesHeight);
  const setHeight = useUI((s) => s.setPagesHeight);
  const setContextMenu = useUI((s) => s.setContextMenu);

  /**
   * Dragging a page to another place in the list.
   *
   * Simpler than the layer drag it is modelled on: pages do not nest, so there
   * is only above and below, and the drop is one `movePage`. It stands down
   * while the list is filtered, for the same reason the layer tree's does — a
   * filtered list is not the order, so there is nowhere honest to land.
   */
  const [dragPage, setDragPage] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const pressPage = (id: string, event: React.PointerEvent) => {
    setPage(id);
    if (needle) return;
    const startY = event.clientY;
    let active = false;
    let to: number | null = null;

    const move = (e: PointerEvent) => {
      if (!active) {
        if (Math.abs(e.clientY - startY) < 4) return;
        active = true;
        setDragPage(id);
      }
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '[data-page-id]',
      );
      const overId = row?.dataset.pageId;
      if (!overId) return;
      const box = row!.getBoundingClientRect();
      const index = allPages.indexOf(overId);
      to = e.clientY - box.top > box.height / 2 ? index + 1 : index;
      setDropAt(to);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragPage(null);
      setDropAt(null);
      if (active && to !== null) {
        store.movePage(id, to);
        store.commit();
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const needle = query.trim().toLowerCase();
  const pages = needle
    ? allPages.filter((id) => (doc[id]?.name ?? '').toLowerCase().includes(needle))
    : allPages;

  const remove = (id: string) => {
    const next = allPages.find((other) => other !== id);
    store.removePage(id);
    if (id === active && next) setPage(next);
  };

  return (
    <div style={{ paddingTop: 8 }}>
      <div className="fig-left-section">
        <button
          type="button"
          className="fig-disclosure"
          aria-expanded={open}
          aria-controls="fig-pages-list"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="fig-disclosure-caret" aria-hidden>
            <Icon.Chevron open={open} />
          </span>
          {!searching && <span>Pages</span>}
        </button>
        {searching && (
          <input
            autoFocus
            value={query}
            placeholder="Search pages"
            aria-label="Search pages"
            // the canvas owns most single keys, exactly as the layer search says
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                setQuery('');
                setSearching(false);
              }
            }}
            onChange={(event) => setQuery(event.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              border: 0,
              borderRadius: 5,
              padding: '0 6px',
              background: 'var(--color-control)',
              color: 'inherit',
              font: 'inherit',
            }}
          />
        )}
        <FigButton
          title="Search pages"
          on={searching}
          onClick={() => {
            setSearching((value) => !value);
            setQuery('');
            if (!open) setOpen(true);
          }}
        >
          <Icon.Search />
        </FigButton>
        <button
          type="button"
          className="fig-btn"
          title="New page"
          onClick={() => {
            setPage(store.addPage());
            if (!open) setOpen(true);
          }}
        >
          <Icon.Plus />
        </button>
      </div>

      {open && (
        <>
          <div
            id="fig-pages-list"
            className="fig-pages-list"
            role="grid"
            aria-label="Pages"
            style={{ height }}
          >
            {pages.map((id, index) => (
              <div key={id} role="row" aria-rowindex={index + 1} aria-selected={id === active}>
                <div role="gridcell">
                  <div
                    className="fig-layer"
                    data-page-id={id}
                    data-on={id === active}
                    data-dragging={dragPage === id || undefined}
                    data-drop={
                      dropAt === null || dragPage === null
                        ? undefined
                        : dropAt === allPages.indexOf(id)
                          ? 'above'
                          : dropAt === allPages.indexOf(id) + 1
                            ? 'below'
                            : undefined
                    }
                    aria-current={id === active ? 'page' : undefined}
                    style={{ paddingLeft: 10 }}
                    onPointerDown={(event) => pressPage(id, event)}
                    onDoubleClick={() => setRenaming(id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPage(id);
                      setContextMenu({ x: event.clientX, y: event.clientY, stack: [], page: id });
                    }}
                  >
                    <span style={{ display: 'flex', color: 'var(--color-ink-muted)' }}>
                      <Icon.Page />
                    </span>
                    {renaming === id ? (
                      <input
                        autoFocus
                        aria-label="Page name"
                        defaultValue={doc[id]?.name ?? 'Page'}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: 0,
                          background: '#fff',
                          borderRadius: 3,
                          padding: '0 4px',
                          outline: '1.5px solid var(--color-select)',
                        }}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value) store.update(id, { name: value });
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <span className="fig-ellipsis" style={{ flex: 1 }}>
                        {doc[id]?.name ?? 'Page'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <PagesResizer height={height} onResize={setHeight} />
        </>
      )}
      {/* the section owns the rename and delete its context menu asks for, so
          the menu stays a list of labels and the state stays here */}
      <PageMenuBridge onRename={setRenaming} onDelete={remove} />
    </div>
  );
}

/**
 * The handle along the bottom of the Pages list.
 *
 * It is the rule between Pages and Layers, so the list gains a resize affordance
 * without gaining a row of chrome — the same trade `Resizer` makes between a
 * panel and the canvas.
 */
function PagesResizer({
  height,
  onResize,
}: {
  height: number;
  onResize: (height: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ y: 0, height: 0 });

  return (
    <div
      className="fig-pages-resizer"
      role="slider"
      tabIndex={0}
      aria-label="Resize handle"
      aria-orientation="vertical"
      aria-valuenow={height}
      aria-valuemin={PANEL.pages.min}
      aria-valuemax={PANEL.pages.max}
      aria-valuetext={`${height} pixels`}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        origin.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        document.body.classList.add('fig-resizing-v');
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        onResize(origin.current.height + (event.clientY - origin.current.y));
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
        document.body.classList.remove('fig-resizing-v');
      }}
      onDoubleClick={() => onResize(PANEL.pages.base)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 8;
        if (event.key === 'ArrowDown') return onResize(height + step);
        if (event.key === 'ArrowUp') return onResize(height - step);
      }}
    />
  );
}

/**
 * Lets the page context menu reach this section's rename and delete.
 *
 * Renaming is a piece of panel state — which row is showing an input — so the
 * menu cannot own it, and a page the menu deletes has to hand the active page
 * on to a survivor. Publishing the two callbacks is cheaper than lifting the
 * whole list into the store for the sake of one menu.
 */
function PageMenuBridge({
  onRename,
  onDelete,
}: {
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  useEffect(() => {
    pageActions.rename = onRename;
    pageActions.remove = onDelete;
    return () => {
      pageActions.rename = null;
      pageActions.remove = null;
    };
  }, [onRename, onDelete]);
  return null;
}

/** What a variable holds the moment its type is chosen. */
const NEW_TOKEN_VALUE: Record<Token['type'], string> = {
  color: '#BDEE63',
  number: '0',
  text: '',
  boolean: 'true',
};

/**
 * Where a variable may be used, and what it is for.
 *
 * Scoping is what keeps a colour picker usable once a theme has forty colours
 * in it: a variable meant for borders stops being offered as a fill. Ticking
 * nothing means "wherever the type fits", which is what every variable starts
 * as — you opt into scoping when the list gets long enough to need it.
 */
function ScopeEditor({ token }: { token: Token }) {
  const store = useStore();
  const available =
    token.type === 'color'
      ? COLOR_SCOPES
      : token.type === 'boolean'
        ? BOOLEAN_SCOPES
        : NUMBER_SCOPES;
  const scopes = token.scopes ?? [];

  const toggle = (scope: VarScope) => {
    const next = scopes.includes(scope)
      ? scopes.filter((entry) => entry !== scope)
      : [...scopes, scope];
    store.updateToken(token.id, { scopes: next });
  };

  return (
    <div className="fig-scope">
      <div className="fig-scope-head">Where “{token.name}” can be used</div>
      <div className="fig-scope-item" style={{ marginBottom: 6 }}>
        <select
          value={token.type}
          aria-label="Variable type"
          // the value and the scopes are both about the old type, so changing
          // it starts them again rather than carrying a hex into a boolean
          onChange={(event) => {
            const type = event.target.value as Token['type'];
            store.updateToken(token.id, {
              type,
              value: NEW_TOKEN_VALUE[type],
              values: {},
              scopes: [],
            });
          }}
          style={{ font: 'inherit', width: '100%' }}
        >
          <option value="color">Color</option>
          <option value="number">Number</option>
          <option value="text">Text</option>
          <option value="boolean">Boolean</option>
        </select>
      </div>
      <div className="fig-scope-grid">
        {available.map((scope) => (
          <label key={scope} className="fig-scope-item">
            <input
              type="checkbox"
              checked={scopes.length === 0 || scopes.includes(scope)}
              onChange={() => toggle(scope)}
              style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
            />
            {SCOPE_LABEL[scope]}
          </label>
        ))}
      </div>
      <input
        defaultValue={token.description ?? ''}
        placeholder="What is it for?"
        onBlur={(event) => store.updateToken(token.id, { description: event.target.value.trim() })}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="fig-scope-note"
      />
      <label className="fig-scope-item" style={{ marginTop: 4 }}>
        <input
          type="checkbox"
          checked={!!token.hidden}
          onChange={(event) => store.updateToken(token.id, { hidden: event.target.checked })}
          style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
        />
        Hide from the pickers
      </label>
    </div>
  );
}

/**
 * The layer list.
 *
 * Rows are flattened rather than nested so that the list has an order: shift
 * -select needs a range, and a drag needs to know what sits above the pointer.
 * Front-most first, like Figma — see `document/layers`.
 */
function LayersTree({ query }: { query: string }) {
  const doc = useDoc();
  const pageId = useUI((s) => s.page);
  const expanded = useUI((s) => s.expanded);
  const selection = useUI((s) => s.selection);
  const page = doc[pageId] ?? doc[ROOT_ID];
  const listRef = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  // A search answers with the layers that match and the chain that leads to
  // each — a hit six levels down says nothing without the frames above it.
  const rows = useMemo(
    () =>
      searching
        ? searchLayers(doc, page?.id ?? ROOT_ID, query)
        : flattenLayers(doc, page?.id ?? ROOT_ID, expanded),
    [doc, page?.id, expanded, query, searching],
  );
  const drag = useLayerDrag(rows, !searching);

  // Selecting on the canvas has to reveal the layer: open every ancestor, then
  // bring the row into view, the way Figma follows a selection.
  useEffect(() => {
    if (!selection.length) return;
    const parents = selection.flatMap((id) =>
      ancestors(id, doc).filter((node) => node.type !== 'page').map((node) => node.id),
    );
    if (parents.length) useUI.getState().setExpanded(parents, true);
  }, [selection, doc]);

  useEffect(() => {
    const id = selection[0];
    if (!id) return;
    listRef.current
      ?.querySelector(`[data-layer-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selection, rows]);

  return (
    <div ref={listRef} data-layers-list className="scroll" style={{ flex: 1, paddingBottom: 12 }}>
      {rows.map((row) => (
        <LayerRow key={row.id} row={row} drag={drag} />
      ))}
      {searching && rows.length === 0 && (
        <div style={{ padding: '6px 16px', color: 'var(--fig-dim)' }}>No layers match</div>
      )}
      {!searching && page && page.children.length === 0 && (
        <div style={{ padding: '6px 16px', color: 'var(--fig-dim)' }}>Press F to draw a frame</div>
      )}
    </div>
  );
}

function LayerRow({ row, drag }: { row: Row; drag: Drag }) {
  const { id, node, depth } = row;
  const store = useStore();
  const selected = useUI((s) => s.selection.includes(id));
  const setHover = useUI((s) => s.setHover);
  const setEditing = useUI((s) => s.setEditing);
  const [renaming, setRenaming] = useState(false);

  const drop = drag.target?.id === id ? drag.target.where : null;
  const component = node.isComponent || !!node.instanceOf;
  const indent = GUTTER + depth * INDENT;

  return (
    <div
      className="fig-layer"
      data-layer-id={id}
      data-on={selected}
      data-hidden={row.hidden}
      data-locked={row.locked}
      data-drop={drop ?? undefined}
      style={{ paddingLeft: indent, opacity: drag.dragging.includes(id) ? 0.4 : undefined }}
      onPointerDown={(e) => {
        if (e.button !== 0 || renaming) return;
        drag.press(id, e);
      }}
      onPointerEnter={() => setHover(id)}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) => {
        e.preventDefault();
        // Right-clicking outside the selection moves it, the way a left click
        // would; right-clicking inside one keeps the whole selection, so the
        // commands still apply to every row you had picked.
        const ui = useUI.getState();
        if (!ui.selection.includes(id)) ui.select([id]);
        // one row, so no "Select layer" disambiguation — the panel has already
        // said which layer this is
        ui.setContextMenu({ x: e.clientX, y: e.clientY, stack: [id] });
      }}
    >
      {drop === 'above' || drop === 'below' ? (
        <span className="fig-layer-drop" data-where={drop} style={{ left: indent }} />
      ) : null}

      <button
        type="button"
        className="fig-btn"
        style={{
          width: 12,
          minWidth: 12,
          padding: 0,
          flex: 'none',
          visibility: row.hasChildren ? 'visible' : 'hidden',
        }}
        title={row.open ? 'Collapse' : 'Expand'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          // ⌥ opens or closes the whole subtree, as it does in Figma
          if (e.altKey) {
            const doc = store.getSnapshot();
            useUI.getState().setExpanded([id, ...descendants(id, doc)], !row.open);
            return;
          }
          useUI.getState().toggleExpanded(id);
        }}
      >
        <span style={{ display: 'inline-flex', transform: row.open ? 'rotate(90deg)' : undefined }}>
          <Icon.Chevron />
        </span>
      </button>

      <span
        style={{
          display: 'flex',
          flex: 'none',
          color: component ? 'var(--fig-purple)' : 'var(--color-ink-muted)',
        }}
      >
        {component ? <Icon.Component solid={!!node.isComponent} /> : TYPE_ICON[node.type]}
      </span>

      {renaming ? (
        <input
          autoFocus
          defaultValue={node.name}
          style={{ flex: 1, minWidth: 0, border: 0, background: '#fff', borderRadius: 3, padding: '0 4px', outline: '1.5px solid var(--color-select)' }}
          onPointerDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value) store.update(id, { name: value });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', color: component ? 'var(--fig-purple)' : undefined }}
        >
          {node.name}
        </span>
      )}

      {node.flex && (
        <span style={{ flex: 'none', color: 'var(--color-ink-dim)', fontSize: 10 }}>
          {node.flex.direction === 'row' ? '→' : '↓'}
        </span>
      )}
      <button
        type="button"
        className={node.locked ? 'fig-btn' : 'fig-btn fig-layer-icons'}
        style={{ flex: 'none' }}
        title={node.locked ? 'Unlock' : 'Lock'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          store.update(id, { locked: !node.locked });
        }}
      >
        <Icon.Lock open={!node.locked} />
      </button>
      <button
        type="button"
        className={node.visible ? 'fig-btn fig-layer-icons' : 'fig-btn'}
        style={{ flex: 'none' }}
        title={node.visible ? 'Hide' : 'Show'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          // hiding what you are editing would leave the caret in nothing
          if (node.visible) setEditing(null);
          store.update(id, { visible: !node.visible });
        }}
      >
        <Icon.Eye off={!node.visible} />
      </button>
    </div>
  );
}


const STARTER_TOKENS = [
  { name: 'brand', type: 'color' as const, value: '#BDEE63' },
  { name: 'ink', type: 'color' as const, value: '#111111' },
  { name: 'surface', type: 'color' as const, value: '#FFFFFF' },
  { name: 'muted', type: 'color' as const, value: '#6B6B6B' },
  { name: 'radius', type: 'number' as const, value: '12' },
];


/**
 * The Assets tab.
 *
 * Figma's is where a file's components live once they stop being layers you
 * scroll past and become parts you reach for. Clicking one drops an instance in
 * the middle of the view; dragging one places it where you let go — and a set's
 * variants are listed under it, because picking the right variant is most of
 * what choosing a component means.
 */
function AssetsTab() {
  const doc = useDoc();
  const store = useStore();
  const readOnly = useReadOnly();
  const pageId = useUI((s) => s.page);
  const select = useUI((s) => s.select);
  const room = useSession().provider.roomname;
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const mains = Object.values(doc).filter((node) => node.isComponent);
  const sets = Object.values(doc).filter((node) => node.isComponentSet);
  const loose = mains.filter((node) => !(node.parent && doc[node.parent]?.isComponentSet));

  const match = (name: string) => !query || name.toLowerCase().includes(query.toLowerCase());
  const entries = [
    ...sets.filter((node) => match(node.name)).map((node) => ({ node, variants: node.children.map((id) => doc[id]).filter(Boolean) })),
    ...loose.filter((node) => match(node.name)).map((node) => ({ node, variants: [] })),
  ];

  /** Places an instance, either where it was dropped or in the middle of the view. */
  const place = (mainId: string, at?: { x: number; y: number }) => {
    if (readOnly) return;
    const centre = at ?? canvasCentre(useUI.getState().viewport);
    const id = store.createInstance(mainId, pageId, centre);
    if (id) select([id]);
  };

  /** Publishes a component to the shared library, or re-publishes it. */
  const publish = async (mainId: string) => {
    const node = store.getSnapshot()[mainId];
    if (!node) return;
    const result = await publishComponentAction(room, mainId, node.name, store.serialize([mainId]));
    if (result.error) {
      setNotice(result.error);
      return;
    }
    store.update(mainId, { libraryId: result.id, libraryVersion: result.version });
    store.commit();
    setNotice(
      result.version === 1
        ? `Published “${node.name}” to the library.`
        : `Published “${node.name}” — revision ${result.version}.`,
    );
  };

  if (!mains.length) {
    // no components of its own is not the same as nothing to offer: a file can
    // still reach for anything published from the files it can see
    return (
      <div className="scroll" style={{ flex: 1 }}>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-ink-muted)', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 500, color: 'var(--color-ink)', marginBottom: 6 }}>
            No components in this file
          </div>
          Select a layer and press ⌥⌘K to make one.
        </div>
        <div style={{ padding: '0 8px 12px' }}>
          <LibrarySection query="" readOnly={readOnly} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', height: 32, padding: '0 12px', gap: 4 }}>
        <input
          value={query}
          placeholder="Search components"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            height: 22,
            border: 0,
            borderRadius: 5,
            padding: '0 6px',
            background: 'var(--color-control)',
            boxShadow: 'var(--shadow-control)',
            outline: 'none',
          }}
        />
      </div>

      <div className="scroll" style={{ flex: 1, padding: '0 8px 12px' }}>
        <div className="fig-left-section" style={{ paddingLeft: 4 }}>
          <span style={{ flex: 1 }}>In this file</span>
        </div>
        {entries.map(({ node, variants }) => (
          <div key={node.id}>
            <AssetRow
              node={node}
              depth={0}
              disabled={readOnly || node.isComponentSet === true}
              onPlace={place}
              onPublish={readOnly || node.isComponentSet ? undefined : () => publish(node.id)}
              published={!!node.libraryId}
            />
            {variants.map((variant) => (
              <AssetRow
                key={variant.id}
                node={variant}
                depth={1}
                disabled={readOnly}
                onPlace={place}
              />
            ))}
          </div>
        ))}
        {!entries.length && (
          <p style={{ padding: '8px 4px', color: 'var(--color-ink-dim)' }}>Nothing matches “{query}”.</p>
        )}

        <LibrarySection query={query} readOnly={readOnly} />
        {notice && <p className="fig-hint">{notice}</p>}
      </div>
    </>
  );
}

function AssetRow({
  node,
  depth,
  disabled,
  onPlace,
  onPublish,
  published,
}: {
  node: { id: string; name: string; isComponentSet?: boolean };
  depth: number;
  disabled: boolean;
  onPlace: (id: string, at?: { x: number; y: number }) => void;
  onPublish?: () => void;
  published?: boolean;
}) {
  return (
    <div
      className="fig-layer"
      style={{ paddingLeft: 8 + depth * 14, cursor: disabled ? 'default' : 'grab' }}
      title={disabled && node.isComponentSet ? 'Pick a variant below' : 'Click or drag onto the canvas'}
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-paperlike-component', node.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => !disabled && onPlace(node.id)}
    >
      <span style={{ display: 'flex', color: 'var(--fig-purple, #7B61FF)' }}>
        <Icon.Component solid={!node.isComponentSet} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      {onPublish && (
        <button
          type="button"
          className="fig-btn fig-layer-icons"
          style={{ flex: 'none' }}
          title={published ? 'Publish a new revision to the library' : 'Publish to the library'}
          onClick={(event) => {
            event.stopPropagation();
            onPublish();
          }}
        >
          {published ? '↑' : '⇧'}
        </button>
      )}
    </div>
  );
}

/**
 * Components published from any file you can see.
 *
 * Importing one copies it in as a local main that remembers where it came
 * from — instances point at that copy, so a later revision can be taken in one
 * place and reach every instance at once.
 */
function LibrarySection({ query, readOnly }: { query: string; readOnly: boolean }) {
  const store = useStore();
  const doc = useDoc();
  const pageId = useUI((s) => s.page);
  const select = useUI((s) => s.select);
  const room = useSession().provider.roomname;
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The library is a server list, not a document one: fetch it when the panel
  // opens, not on every keystroke that changes the document.
  useEffect(() => {
    let live = true;
    void listLibraryAction().then((list) => {
      if (live) setEntries(list);
    });
    return () => {
      live = false;
    };
  }, []);

  // the local copy of each library component: a main, not a stray paste
  const mine = new Map(
    Object.values(doc)
      .filter((node) => node.libraryId && node.isComponent)
      .map((node) => [node.libraryId!, node]),
  );

  const shown = (entries ?? []).filter(
    (entry) =>
      // a component published *from this file* is already in the list above
      entry.fileId !== room &&
      (!query || entry.name.toLowerCase().includes(query.toLowerCase())),
  );
  if (!shown.length) return null;

  const take = async (entry: LibraryEntry) => {
    setBusy(entry.id);
    const result = await fetchLibraryComponentAction(entry.id);
    setBusy(null);
    if (!result.payload) return;

    const existing = mine.get(entry.id);
    if (existing) {
      store.updateFromLibrary(existing.id, result.payload, result.version ?? entry.version);
      store.commit();
      select([existing.id]);
      return;
    }
    const id = store.importComponent(result.payload, pageId, {
      id: entry.id,
      version: result.version ?? entry.version,
    }, canvasCentre(useUI.getState().viewport));
    store.commit();
    if (id) select([id]);
  };

  return (
    <>
      <div className="fig-left-section" style={{ paddingLeft: 4, marginTop: 10 }}>
        <span style={{ flex: 1 }}>Library</span>
      </div>
      {shown.map((entry) => {
        const local = mine.get(entry.id);
        const stale = local && (local.libraryVersion ?? 0) < entry.version;
        return (
          <div key={entry.id} className="fig-layer" style={{ paddingLeft: 8 }}>
            <span style={{ display: 'flex', color: 'var(--fig-purple, #7B61FF)' }}>
              <Icon.Component solid />
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.name}
              <span style={{ color: 'var(--color-ink-dim)' }}> · {entry.fileName}</span>
            </span>
            <button
              type="button"
              className="btn"
              disabled={readOnly || busy === entry.id || (!!local && !stale)}
              title={
                stale
                  ? `Take revision ${entry.version}`
                  : local
                    ? 'Up to date'
                    : 'Bring this component into the file'
              }
              onClick={() => void take(entry)}
            >
              {busy === entry.id ? '…' : stale ? 'Update' : local ? 'Added' : 'Add'}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** The middle of the canvas in world coordinates — where a click-placed asset goes. */

/**
 * Variables.
 *
 * They live in the CRDT and publish as CSS custom properties on the canvas
 * root, so a fill of `var(--brand)` resolves live and survives export as a real
 * variable rather than a baked-in hex.
 *
 * A collection gives its variables modes — light and dark, one brand and
 * another — and every mode gets a column here, because the whole point of a
 * mode is comparing it with the one beside it.
 */
function ThemeTab() {
  const store = useStore();
  const tokens = useTokens();
  const collections = useCollections();
  const [collectionId, setCollectionId] = useState(DEFAULT_COLLECTION_ID);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [renamingMode, setRenamingMode] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const collection =
    collections.find((entry) => entry.id === collectionId) ?? collections[0] ?? DEFAULT_COLLECTION;
  const modes = collection.modes;

  const mine = tokens.filter((token) => (token.collection ?? DEFAULT_COLLECTION_ID) === collection.id);
  const visible = query
    ? mine.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : mine;

  if (tokens.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <span style={{ color: 'var(--color-ink-dim)', transform: 'scale(1.6)' }}>
          <Icon.Logo />
        </span>
        <div style={{ fontWeight: 500, marginTop: 8 }}>Variables</div>
        <div style={{ color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>
          Create a variable to get started, or explore the starter theme.
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-raised"
            onClick={() =>
              store.addToken({
                name: `token-${tokens.length + 1}`,
                type: 'color',
                value: '#BDEE63',
                collection: collection.id,
              })
            }
          >
            Create variable
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => STARTER_TOKENS.forEach((token) => store.addToken(token))}
          >
            Starter theme
          </button>
        </div>
      </div>
    );
  }

  const valueIn = (token: (typeof tokens)[number], modeId: string): string =>
    token.values?.[modeId] ?? (modeId === collection.defaultMode ? token.value : token.value);

  return (
    <>
      {/* collections */}
      <div className="fig-left-section" style={{ borderTop: '1px solid var(--fig-line)' }}>
        <select
          className="fig-plain-select"
          value={collection.id}
          onChange={(event) => setCollectionId(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          {collections.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="fig-btn"
          title="New collection"
          onClick={() => setCollectionId(store.addCollection(`Collection ${collections.length + 1}`))}
        >
          <Icon.Plus />
        </button>
      </div>

      {/* modes */}
      <div className="fig-modes">
        {modes.map((mode) => (
          <span
            key={mode.id}
            className="fig-mode"
            data-on={collection.defaultMode === mode.id || undefined}
            title={
              collection.defaultMode === mode.id
                ? 'The mode the canvas shows — double-click to rename'
                : 'Click to show this mode on the canvas'
            }
            onClick={() => store.updateCollection(collection.id, { defaultMode: mode.id })}
            onDoubleClick={() => setRenamingMode(mode.id)}
          >
            {renamingMode === mode.id ? (
              <input
                autoFocus
                defaultValue={mode.name}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name) {
                    store.updateCollection(collection.id, {
                      modes: modes.map((m) => (m.id === mode.id ? { ...m, name } : m)),
                    });
                  }
                  setRenamingMode(null);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setRenamingMode(null);
                }}
                style={{ width: 60, border: 0, background: 'transparent', outline: 'none' }}
              />
            ) : (
              mode.name
            )}
            {modes.length > 1 && (
              <button
                type="button"
                className="fig-mode-x"
                title="Delete mode"
                onClick={(event) => {
                  event.stopPropagation();
                  store.removeMode(collection.id, mode.id);
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className="fig-btn"
          title="Add mode"
          onClick={() => store.addMode(collection.id)}
        >
          <Icon.Plus />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', height: 32, padding: '0 12px', gap: 4 }}>
        {searching ? (
          <input
            autoFocus
            value={query}
            placeholder="Search variables"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => !query && setSearching(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                setQuery('');
                setSearching(false);
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              border: 0,
              borderRadius: 5,
              padding: '0 6px',
              background: 'var(--color-control)',
              boxShadow: 'var(--shadow-control)',
              outline: 'none',
            }}
          />
        ) : (
          <span style={{ flex: 1, color: 'var(--color-ink-muted)' }}>
            {mine.length} {mine.length === 1 ? 'variable' : 'variables'}
          </span>
        )}
        <button
          type="button"
          className="btn"
          style={{ width: 20, padding: 0 }}
          title="Search"
          onClick={() => setSearching((v) => !v)}
        >
          <Icon.Search />
        </button>
        <button
          type="button"
          className="btn"
          style={{ width: 20, padding: 0 }}
          title="New variable"
          onClick={() =>
            store.addToken({
              name: `token-${tokens.length + 1}`,
              type: 'color',
              value: '#BDEE63',
              collection: collection.id,
            })
          }
        >
          <Icon.Plus />
        </button>
      </div>

      <div className="scroll" style={{ flex: 1, padding: '0 12px 12px' }}>
        {visible.map((token) => (
          <div key={token.id} className="layer-row" style={{ paddingLeft: 0, gap: 8, height: 30 }}>
            {token.type === 'color' ? (
              <input
                type="color"
                value={valueIn(token, collection.defaultMode).startsWith('#')
                  ? valueIn(token, collection.defaultMode)
                  : '#000000'}
                onChange={(e) =>
                  store.setTokenValue(token.id, collection.defaultMode, e.target.value.toUpperCase())
                }
                style={{
                  width: 16,
                  height: 16,
                  flex: 'none',
                  padding: 0,
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: 3,
                  background: 'none',
                }}
              />
            ) : (
              <span
                style={{ width: 16, flex: 'none', textAlign: 'center', color: 'var(--color-ink-dim)' }}
                title={token.type}
              >
                {token.type === 'boolean' ? '◑' : token.type === 'text' ? 'T' : '#'}
              </span>
            )}
            <input
              defaultValue={token.name}
              onBlur={(e) => {
                const name = e.target.value.trim().replace(/[^a-zA-Z0-9-]/g, '-');
                if (name) store.updateToken(token.id, { name });
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none' }}
            />
            {modes.map((mode) =>
              // a boolean has two values, so it gets the control that has two
              // rather than a text field you can type nonsense into
              token.type === 'boolean' ? (
                <select
                  key={`${token.id}-${mode.id}`}
                  value={valueIn(token, mode.id) === 'false' ? 'false' : 'true'}
                  title={`${token.name} · ${mode.name}`}
                  onChange={(e) => store.setTokenValue(token.id, mode.id, e.target.value)}
                  style={{
                    width: modes.length > 1 ? 58 : 66,
                    flex: 'none',
                    border: 0,
                    background: 'transparent',
                    outline: 'none',
                    color: 'var(--color-ink-muted)',
                    font: 'inherit',
                  }}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  key={`${token.id}-${mode.id}`}
                  // keyed by value as well: a mode switch has to re-seed the field
                  defaultValue={valueIn(token, mode.id)}
                  title={`${token.name} · ${mode.name}`}
                  onBlur={(e) => store.setTokenValue(token.id, mode.id, e.target.value.trim())}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  style={{
                    width: modes.length > 1 ? 58 : 66,
                    flex: 'none',
                    border: 0,
                    background: 'transparent',
                    outline: 'none',
                    color: 'var(--color-ink-muted)',
                    textAlign: 'right',
                  }}
                />
              ),
            )}
            <button
              type="button"
              className="btn layer-eye"
              style={{ width: 18, padding: 0, flex: 'none' }}
              data-on={editing === token.id || undefined}
              title="Scope and description"
              onClick={() => setEditing(editing === token.id ? null : token.id)}
            >
              <Icon.Sliders />
            </button>
            <button
              type="button"
              className="btn layer-eye"
              style={{ width: 18, padding: 0, flex: 'none' }}
              title="Delete variable"
              onClick={() => store.removeToken(token.id)}
            >
              <Icon.Minus />
            </button>
          </div>
        ))}
        {visible.map((token) =>
          editing === token.id ? <ScopeEditor key={`${token.id}-scope`} token={token} /> : null,
        )}
        <p style={{ marginTop: 10, color: 'var(--color-ink-dim)', lineHeight: 1.45 }}>
          Use one anywhere a colour is accepted by typing <code>var(--name)</code>. A frame can
          switch modes from the Design panel.
        </p>
      </div>
    </>
  );
}
