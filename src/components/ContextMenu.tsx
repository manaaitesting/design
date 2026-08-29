'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useCollections,
  useCustomFonts,
  useDoc,
  usePages,
  useStore,
  useTokenVars,
  useTokens,
  useVarNames,
} from './Session';
import { hasNodes, readNodes, writeNodes } from '../lib/clipboard';
import {
  copyAsPng,
  copyAsSvg,
  copyProperties,
  cssFor,
  flip,
  hasProperties,
  pasteAt,
  pasteProperties,
  pointerWorld,
  writeText,
} from '../lib/actions';
import { download, safeFilename } from '../export/raster';
import { toHtml, toJson, toReact } from '../export/toCode';
import { pageActions, useUI } from '../state/ui';
import { canEditPoints } from '../document/geometry';
import type { BooleanOp } from '../document/types';

interface Item {
  label: string;
  shortcut?: string;
  /** return value is ignored — commands report success to themselves */
  run?: () => unknown;
  disabled?: boolean;
  /** draws a separator above this row */
  divider?: boolean;
  items?: Item[];
  onHover?: (id: string | null) => void;
}

/**
 * One panel of the menu, and every panel below it.
 *
 * A submenu is a DOM child of the row that owns it, so moving the pointer into
 * it never fires the row's `pointerleave` — the reason a naive implementation
 * closes the moment you reach for it.
 */
function Panel({
  items,
  x,
  y,
  width,
  onClose,
}: {
  items: Item[];
  x: number;
  y: number;
  width: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** which row's submenu is showing, and where that submenu should sit */
  const [open, setOpen] = useState<{ index: number; left: number; top: number } | null>(null);
  const [at, setAt] = useState({ left: x, top: y, ready: false });

  // Measure once mounted, then keep the panel fully on screen. Flipping to the
  // left of the anchor beats letting a submenu run off the window.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setAt({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
      ready: true,
    });
  }, [x, y, items]);

  return (
    <div
      ref={ref}
      className="ctx"
      style={{ left: at.left, top: at.top, width, visibility: at.ready ? 'visible' : 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
    >
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          style={{ position: 'relative' }}
          onPointerEnter={(event) => {
            item.onHover?.(null);
            if (item.disabled || !item.items) return setOpen(null);
            const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOpen({ index, left: box.right - 4, top: box.top - 6 });
          }}
        >
          {item.divider && <div className="ctx-sep" />}
          <button
            type="button"
            className="ctx-row"
            role="menuitem"
            disabled={item.disabled}
            data-open={open?.index === index}
            onPointerEnter={() => item.onHover?.(null)}
            onClick={() => {
              if (item.items) return;
              void item.run?.();
              onClose();
            }}
          >
            <span className="ctx-label">{item.label}</span>
            {item.items ? (
              <span className="ctx-arrow">›</span>
            ) : (
              item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>
            )}
          </button>
          {open?.index === index && item.items && (
            <Panel
              items={item.items}
              x={open.left}
              y={open.top}
              width={item.items.some((i) => (i.shortcut ?? '').length > 2) ? 232 : 200}
              onClose={onClose}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Closed, the menu subscribes to nothing but its own open/closed flag.
 *
 * The commands below need the document and the token table, and both of those
 * hooks wake on every document revision — so reading them out here would
 * re-render the menu on every frame of a drag, for a component that renders
 * nothing. Splitting the body off keeps that cost behind the right-click.
 */
export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu);
  if (!menu) return null;
  return <Menu menu={menu} />;
}

type OpenMenu = NonNullable<ReturnType<typeof useUI.getState>['contextMenu']>;

/**
 * The menu a right-click on a row in the Pages list opens.
 *
 * Kept apart from the canvas menu because it shares none of its commands: the
 * subject is a page, not a selection, and every entry below acts on that page.
 */
function PageMenu({
  id,
  x,
  y,
  onClose,
}: {
  id: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const store = useStore();
  const doc = useDoc();
  const pages = usePages();
  const only = pages.length <= 1;

  const items: Item[] = [
    {
      label: 'Copy link to page',
      // the page is a query on the file's own URL, which is what the editor
      // reads back on load — see `Editor`
      run: () => writeText(`${location.origin}${location.pathname}?page=${id}`),
    },
    {
      label: 'Rename page',
      divider: true,
      run: () => pageActions.rename?.(id),
    },
    {
      label: 'Duplicate page',
      run: () => {
        const copy = store.duplicatePage(id);
        if (copy) useUI.getState().setPage(copy);
      },
    },
    {
      label: 'Delete page',
      divider: true,
      // a file with one page cannot lose it, so the row greys rather than lies
      disabled: only,
      run: () => pageActions.remove?.(id),
    },
  ];

  if (!doc[id]) return null;
  return <Panel items={items} x={x} y={y} width={200} onClose={onClose} />;
}

function Menu({ menu }: { menu: OpenMenu }) {
  const store = useStore();
  const doc = useDoc();
  const varNames = useVarNames();
  const tokens = useTokens();
  const collections = useCollections();
  const fonts = useCustomFonts();
  const tokenVars = useTokenVars();
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const setHover = useUI((s) => s.setHover);

  const close = () => useUI.getState().setContextMenu(null);

  useEffect(() => {
    const dismiss = () => close();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // a right-click on a page row is about that page, not about the selection
  if (menu.page) return <PageMenu id={menu.page} x={menu.x} y={menu.y} onClose={close} />;

  const has = selection.length > 0;
  const one = selection.length === 1;
  const first = doc[selection[0]];
  const target = selection[0];
  const zoom = useUI.getState().viewport.zoom;

  const level = () => {
    const entered = useUI.getState().entered;
    return entered && doc[entered] ? entered : useUI.getState().page;
  };

  async function pasteHere() {
    const payload = await readNodes();
    if (!payload) return;
    const world = pointerWorld(useUI.getState().viewport, menu.x, menu.y);
    const pasted = world
      ? pasteAt(store, payload, level(), world)
      : store.paste(payload, level(), { x: 20, y: 20 });
    if (pasted.length) select(pasted);
  }

  /** Drops the selection and pastes in its place, keeping the original spot. */
  async function pasteToReplace() {
    const payload = await readNodes();
    const anchor = doc[selection[0]];
    if (!payload || !anchor?.parent) return;
    const pasted = pasteAt(store, payload, anchor.parent, { x: anchor.x, y: anchor.y });
    store.remove(selection);
    if (pasted.length) select(pasted);
  }

  const codeItems: Item[] = [
    { label: 'CSS', disabled: !one, run: () => writeText(cssFor(target, doc, false, varNames)) },
    { label: 'CSS (all layers)', disabled: !one, run: () => writeText(cssFor(target, doc, true, varNames)) },
    {
      label: 'React',
      disabled: !one,
      run: () => {
        const { markup, css } = toReact(target, doc, tokens, collections, fonts);
        return writeText(`${markup}\n\n/* ${safeFilename(first?.name ?? 'layer')}.css */\n${css}`);
      },
    },
    { label: 'HTML', disabled: !one, run: () => writeText(toHtml(target, doc, tokens, collections, fonts)) },
    { label: 'JSON', disabled: !one, run: () => writeText(toJson(target, doc)) },
  ];

  const copyPasteAs: Item[] = [
    { label: 'Copy as code', items: codeItems, disabled: !one },
    {
      label: 'Copy as SVG',
      disabled: !one,
      run: () => copyAsSvg(target, zoom, tokenVars),
    },
    {
      label: 'Copy as PNG',
      shortcut: '⇧⌘C',
      disabled: !one,
      run: () =>
        copyAsPng(target, zoom, 2, tokenVars, (blob) =>
          download(blob, `${safeFilename(first?.name ?? 'layer')}.png`),
        ),
    },
    {
      label: 'Copy properties',
      shortcut: '⌥⌘C',
      divider: true,
      disabled: !has,
      run: () => void copyProperties(doc, selection),
    },
    {
      label: 'Paste properties',
      shortcut: '⌥⌘V',
      disabled: !has || !hasProperties(),
      run: () => void pasteProperties(store, selection),
    },
  ];

  const combine = (op: BooleanOp) => {
    const id = store.booleanGroup(selection, op);
    if (id) select([id]);
  };

  const items: Item[] = [];

  // Overlapping layers make right-click ambiguous, so list what is under the
  // pointer and let you pick — the stack arrives deepest-first.
  if (menu.stack.length > 1) {
    items.push({
      label: 'Select layer',
      items: menu.stack.map((id) => ({
        label: doc[id]?.name ?? id,
        onHover: () => setHover(id),
        run: () => {
          select([id]);
          const parent = doc[id]?.parent;
          useUI.getState().setEntered(parent && doc[parent]?.type !== 'page' ? parent : null);
        },
      })),
    });
  }

  items.push(
    {
      label: 'Copy',
      shortcut: '⌘C',
      divider: menu.stack.length > 1,
      disabled: !has,
      run: () => void writeNodes(store.serialize(selection)),
    },
    { label: 'Paste here', disabled: !hasNodes(), run: pasteHere },
    { label: 'Paste to replace', shortcut: '⇧⌘R', disabled: !hasNodes() || !has, run: pasteToReplace },
    { label: 'Copy/Paste as', items: copyPasteAs },

    { label: 'Bring to front', shortcut: ']', divider: true, disabled: !has, run: () => store.reorder(selection, 'front') },
    { label: 'Send to back', shortcut: '[', disabled: !has, run: () => store.reorder(selection, 'back') },

    {
      label: 'Group selection',
      shortcut: '⌘G',
      divider: true,
      disabled: !has,
      run: () => {
        const id = store.group(selection);
        if (id) select([id]);
      },
    },
    {
      label: 'Frame selection',
      shortcut: '⌥⌘G',
      disabled: !has,
      run: () => {
        const id = store.wrapInFlex(selection, false);
        if (id) select([id]);
      },
    },
    {
      label: 'Ungroup',
      shortcut: '⇧⌘G',
      disabled: !has || !first?.children.length,
      run: () => {
        const freed = store.ungroup(selection);
        if (freed.length) select(freed);
      },
    },

    {
      label: 'Boolean groups',
      divider: true,
      disabled: selection.length < 2,
      items: [
        { label: 'Union selection', shortcut: '⌥⌘U', run: () => combine('union') },
        { label: 'Subtract selection', shortcut: '⌥⌘S', run: () => combine('subtract') },
        { label: 'Intersect selection', shortcut: '⌥⌘I', run: () => combine('intersect') },
        { label: 'Exclude selection', shortcut: '⌥⌘X', run: () => combine('exclude') },
      ],
    },
    {
      label: first?.isMask ? 'Remove mask' : 'Use as mask',
      shortcut: '⌃⌘M',
      disabled: !has,
      run: () => store.toggleMask(selection),
    },
    {
      label: 'Flatten',
      shortcut: '⌘E',
      disabled: !has,
      run: () => {
        const flattened = store.flatten(selection);
        if (flattened) {
          select([flattened]);
          useUI.getState().setVectorEdit(flattened);
        }
      },
    },
    {
      label: 'Outline stroke',
      shortcut: '⇧⌘O',
      disabled: !has || !first?.border,
      run: () => {
        const made = store.outlineStroke(selection);
        if (made.length) select(made);
      },
    },
    {
      label: 'Edit points',
      shortcut: '⏎',
      disabled: !one || !first || !canEditPoints(first.type),
      run: () => useUI.getState().setVectorEdit(target),
    },
    {
      label: 'Create section',
      shortcut: '⇧S',
      disabled: !has,
      run: () => {
        const id = store.wrapInSection(selection);
        if (id) select([id]);
      },
    },
    {
      label: 'Add auto layout',
      shortcut: '⇧A',
      divider: true,
      disabled: !has,
      run: () => {
        const id = store.autoLayoutSelection(selection);
        if (id) select([id]);
      },
    },
    {
      label: 'Combine as variants',
      disabled: selection.filter((id) => doc[id]?.isComponent).length < 2,
      run: () => {
        const id = store.combineAsVariants(selection);
        if (id) select([id]);
      },
    },
    {
      label: 'Create component',
      shortcut: '⌥⌘K',
      disabled: !one,
      run: () => void store.createComponent(target),
    },

    {
      label: 'Show/Hide',
      shortcut: '⇧⌘H',
      divider: true,
      disabled: !has,
      run: () => store.updateMany(selection, (n) => ({ visible: !n.visible })),
    },
    {
      label: 'Lock/Unlock',
      shortcut: '⇧⌘L',
      disabled: !has,
      run: () => store.updateMany(selection, (n) => ({ locked: !n.locked })),
    },

    { label: 'Flip horizontal', shortcut: '⇧H', divider: true, disabled: !has, run: () => flip(store, selection, 'h') },
    { label: 'Flip vertical', shortcut: '⇧V', disabled: !has, run: () => flip(store, selection, 'v') },

    {
      label: 'Delete',
      shortcut: '⌫',
      divider: true,
      disabled: !has,
      run: () => {
        store.remove(selection);
        select([]);
      },
    },
  );

  return <Panel items={items} x={menu.x} y={menu.y} width={216} onClose={close} />;
}
