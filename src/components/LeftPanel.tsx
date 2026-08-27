'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useDoc, usePages, useStore, useTokens } from './Session';
import { useUI } from '../state/ui';
import { ancestors, descendants, ROOT_ID, type NodeType } from '../document/types';
import {
  flattenLayers,
  isContainer,
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
};

/**
 * Runs a layer drag.
 *
 * Press decides the selection the way a file list does — plain click replaces,
 * ⌘ toggles, ⇧ takes the range from the anchor — and a press on a row that is
 * already part of a multi-selection holds that selection so the whole group can
 * be dragged, narrowing it only if the pointer never moved.
 */
function useLayerDrag(rows: Row[]) {
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

    const move = (e: PointerEvent) => {
      if (!active) {
        // a few pixels of slop so a plain click still selects
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        active = true;
        setDragging(moving);
      }

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
        <button type="button" className="fig-tab" data-on={tab === 'theme'} onClick={() => setTab('theme')}>
          Theme
        </button>
      </div>

      {tab === 'design' ? (
        <>
          <PagesSection />
          <div className="fig-left-section" style={{ borderTop: '1px solid var(--fig-line)' }}>
            <span style={{ flex: 1 }}>Layers</span>
          </div>
          <LayersTree />
        </>
      ) : (
        <ThemeTab />
      )}

    </div>
  );
}

function PagesSection() {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const doc = useDoc();
  const store = useStore();
  const pages = usePages();
  const active = useUI((s) => s.page);
  const setPage = useUI((s) => s.setPage);

  return (
    <div style={{ paddingTop: 8 }}>
      <div className="fig-left-section">
        <span style={{ flex: 1 }}>Pages</span>
        <button type="button" className="fig-btn" title="Search pages">
          <Icon.Search />
        </button>
        <button
          type="button"
          className="fig-btn"
          title="New page"
          onClick={() => setPage(store.addPage())}
        >
          <Icon.Plus />
        </button>
      </div>

      {open &&
        pages.map((id) => (
          <div
            key={id}
            className="fig-layer"
            data-on={id === active}
            style={{ paddingLeft: 10 }}
            onClick={() => setPage(id)}
            onDoubleClick={() => setRenaming(id)}
          >
            <span style={{ display: 'flex', color: 'var(--color-ink-muted)' }}>
              <Icon.Page />
            </span>
            {renaming === id ? (
              <input
                autoFocus
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
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {doc[id]?.name ?? 'Page'}
              </span>
            )}
            {pages.length > 1 && (
              <button
                type="button"
                className="fig-btn fig-layer-icons"
                style={{ flex: 'none' }}
                title="Delete page"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = pages.find((other) => other !== id);
                  store.removePage(id);
                  if (id === active && next) setPage(next);
                }}
              >
                <Icon.Minus />
              </button>
            )}
          </div>
        ))}
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
function LayersTree() {
  const doc = useDoc();
  const pageId = useUI((s) => s.page);
  const expanded = useUI((s) => s.expanded);
  const selection = useUI((s) => s.selection);
  const page = doc[pageId] ?? doc[ROOT_ID];
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => flattenLayers(doc, page?.id ?? ROOT_ID, expanded),
    [doc, page?.id, expanded],
  );
  const drag = useLayerDrag(rows);

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
    <div ref={listRef} className="scroll" style={{ flex: 1, paddingBottom: 12 }}>
      {rows.map((row) => (
        <LayerRow key={row.id} row={row} drag={drag} />
      ))}
      {page && page.children.length === 0 && (
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
 * Tokens are stored in the CRDT and published as CSS custom properties on the
 * canvas root, so a fill of `var(--brand)` resolves live and survives export as
 * a real variable rather than a baked-in hex.
 */
function ThemeTab() {
  const store = useStore();
  const tokens = useTokens();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const visible = query
    ? tokens.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : tokens;

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
        <div style={{ fontWeight: 500, marginTop: 8 }}>Theme tokens</div>
        <div style={{ color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>
          Create tokens to get started, or explore the starter theme.
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-raised"
            onClick={() => store.addToken({ name: `token-${tokens.length + 1}`, type: 'color', value: '#BDEE63' })}
          >
            Create token
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', height: 32, padding: '0 12px', gap: 4 }}>
        {searching ? (
          <input
            autoFocus
            value={query}
            placeholder="Search tokens"
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
            {tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}
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
          title="New token"
          onClick={() => store.addToken({ name: `token-${tokens.length + 1}`, type: 'color', value: '#BDEE63' })}
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
                value={token.value.startsWith('#') ? token.value : '#000000'}
                onChange={(e) => store.updateToken(token.id, { value: e.target.value.toUpperCase() })}
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
              <span style={{ width: 16, flex: 'none', textAlign: 'center', color: 'var(--color-ink-dim)' }}>
                #
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
            <input
              defaultValue={token.value}
              onBlur={(e) => store.updateToken(token.id, { value: e.target.value.trim() })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              style={{
                width: 66,
                flex: 'none',
                border: 0,
                background: 'transparent',
                outline: 'none',
                color: 'var(--color-ink-muted)',
                textAlign: 'right',
              }}
            />
            <button
              type="button"
              className="btn layer-eye"
              style={{ width: 18, padding: 0, flex: 'none' }}
              title="Delete token"
              onClick={() => store.removeToken(token.id)}
            >
              <Icon.Minus />
            </button>
          </div>
        ))}
        <p style={{ marginTop: 10, color: 'var(--color-ink-dim)', lineHeight: 1.45 }}>
          Use one anywhere a colour is accepted by typing <code>var(--name)</code>.
        </p>
      </div>
    </>
  );
}
