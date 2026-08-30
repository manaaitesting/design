'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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
  alignText,
  componentize,
  componentizeEach,
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
import { download, framesToPdf, nodeToPng, safeFilename } from '../export/raster';
import { toHtml, toJson, toReact } from '../export/toCode';
import { toAndroidXml, toSwiftUI } from '../export/toNative';
import { toTailwind } from '../export/tailwind';
import { pageActions, textActions, useUI } from '../state/ui';
import { fitView, revealNode } from '../lib/view';
import { canEditPoints } from '../document/geometry';
import { descendants, type BooleanOp, type Doc, type SceneNode } from '../document/types';
import { boardsOf } from '../document/layers';

export interface Item {
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

/** A rendered blob as an inline data URL, which is how this document stores images. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the rendered image.'));
    reader.readAsDataURL(blob);
  });
}

/** The main this layer follows, if it follows one. */
function mainOf(node: SceneNode | undefined): string | null {
  return node?.instanceOf ?? null;
}

/**
 * Whether anything inside this instance has been changed away from its main.
 *
 * An override can be on any layer in the subtree, not only the instance root —
 * the usual one is a label three levels down — so the whole tree is asked.
 */
function hasOverrides(id: string, doc: Doc): boolean {
  return [id, ...descendants(id, doc)].some((child) => (doc[child]?.overridden ?? []).length > 0);
}

/**
 * One panel of the menu, and every panel below it.
 *
 * A submenu is a DOM child of the row that owns it, so moving the pointer into
 * it never fires the row's `pointerleave` — the reason a naive implementation
 * closes the moment you reach for it.
 *
 * Exported because it is every menu in the app: the clamping, the scroll on
 * overflow and the keyboard are worth having once rather than per menu.
 */
export function Panel({
  items,
  x,
  y,
  width,
  onClose,
  onBack,
  takeFocus = true,
}: {
  items: Item[];
  x: number;
  y: number;
  width: number;
  onClose: () => void;
  /** ← in a submenu hands the keyboard back to the row that opened it */
  onBack?: () => void;
  takeFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** which row's submenu is showing, where it should sit, and how it was asked for */
  const [open, setOpen] = useState<{ index: number; left: number; top: number; byKey: boolean } | null>(null);
  const [at, setAt] = useState({ left: x, top: y, ready: false });
  /** the row the keyboard is on, which is not the row the pointer is over */
  const [active, setActive] = useState(-1);
  const rows = useId();

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

  // An open menu owns the keyboard, which it cannot do without holding focus.
  // Not before it has been measured: the panel is `visibility: hidden` until
  // then, and a hidden element cannot take focus. A submenu takes it only when
  // the keyboard opened it — taking it on hover would leave the keyboard
  // nowhere the moment the pointer moved off again.
  useEffect(() => {
    if (takeFocus && at.ready) ref.current?.focus();
  }, [takeFocus, at.ready]);

  // A panel with more rows than the window is tall cannot be clamped onto the
  // screen — the arithmetic above pins it to the top and the rest hangs off the
  // bottom, unreachable. Scrolling is what Figma does with a long menu, and it
  // is the only answer that does not hide a command.
  const fit = { maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' as const };

  /** the rows the keyboard can land on — a greyed row is not one of them */
  const live = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);

  const reveal = (index: number) => {
    setActive(index);
    setOpen(null);
    ref.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  };

  const step = (delta: number) => {
    if (!live.length) return;
    const here = live.indexOf(active);
    reveal(
      here < 0
        ? delta > 0
          ? live[0]
          : live[live.length - 1]
        : live[(here + delta + live.length) % live.length],
    );
  };

  const openSub = (index: number, byKey: boolean) => {
    const box = ref.current?.children[index]?.getBoundingClientRect();
    if (!box) return;
    setOpen({ index, left: box.right - 4, top: box.top - 6, byKey });
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const item = items[active];
    const keys: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      Home: () => void (live.length && reveal(live[0])),
      End: () => void (live.length && reveal(live[live.length - 1])),
      ArrowRight: () => void (item?.items && openSub(active, true)),
      ArrowLeft: () => {
        if (open) {
          setOpen(null);
          ref.current?.focus();
        } else onBack?.();
      },
      Enter: () => {
        if (!item) return;
        if (item.items) return openSub(active, true);
        void item.run?.();
        onClose();
      },
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      event.stopPropagation();
      handler();
      return;
    }

    // Figma's typeahead: a letter jumps to the next row that starts with it,
    // wrapping, so pressing the same letter again walks the rows that share it.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const from = live.indexOf(active) + 1;
    const hit = [...live.slice(from), ...live.slice(0, from)].find((index) =>
      items[index].label.toLowerCase().startsWith(event.key.toLowerCase()),
    );
    if (hit === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    reveal(hit);
  };

  return (
    <div
      ref={ref}
      className="ctx"
      style={{ left: at.left, top: at.top, width, ...fit, visibility: at.ready ? 'visible' : 'hidden' }}
      // A click on a row must not move focus: the text menu's commands act on
      // the caret in the layer behind it, and taking focus would end the edit
      // before the row had run.
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      role="menu"
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? `${rows}-${active}` : undefined}
    >
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          style={{ position: 'relative' }}
          onPointerEnter={(event) => {
            item.onHover?.(null);
            setActive(-1);
            if (item.disabled || !item.items) return setOpen(null);
            const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOpen({ index, left: box.right - 4, top: box.top - 6, byKey: false });
          }}
        >
          {item.divider && <div className="ctx-sep" />}
          <button
            type="button"
            id={`${rows}-${index}`}
            className="ctx-row"
            role="menuitem"
            disabled={item.disabled}
            data-active={active === index || undefined}
            aria-haspopup={item.items ? 'menu' : undefined}
            aria-expanded={item.items ? open?.index === index : undefined}
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
              onBack={() => {
                setOpen(null);
                ref.current?.focus();
              }}
              takeFocus={open.byKey}
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
  const tokenVars = useTokenVars();
  const only = pages.length <= 1;

  const items: Item[] = [
    {
      label: 'Copy link to page',
      // the page is a query on the file's own URL, which is what the editor
      // reads back on load — see `Editor`
      run: () => writeText(`${location.origin}${location.pathname}?page=${id}`),
    },
    {
      label: 'Export frames to PDF',
      divider: true,
      // a page with no boards on it has nothing to make pages out of
      disabled: !boardsOf(doc, id).length,
      run: async () => {
        const boards = boardsOf(doc, id);
        const name = safeFilename(doc[id]?.name ?? 'page');
        try {
          const { blob, missed } = await framesToPdf(
            boards,
            useUI.getState().viewport.zoom,
            2,
            tokenVars,
          );
          download(blob, `${name}.pdf`);
          if (missed) {
            window.alert(
              `${missed} board${missed === 1 ? ' was' : 's were'} not on screen and could not be drawn. ` +
                'Zoom out to fit the page and export again to include them.',
            );
          }
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'The export failed.');
        }
      },
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

/**
 * The menu a right-click inside a text layer being edited opens.
 *
 * The subject is a range of characters rather than a layer, so none of the
 * object commands are here — the canvas menu's "Copy" copies the layer, and its
 * "Delete" removes the one you are mid-sentence in. Cut and Copy read the live
 * DOM range; the marks are run by the editor that owns the runs, because a
 * change made behind its back is overwritten by the next keystroke.
 */
function TextMenu({
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
  const range = window.getSelection()?.toString() ?? '';
  const mark = (key: 'bold' | 'italic' | 'underline' | 'strike') => () => textActions.mark?.(key);

  const items: Item[] = [
    {
      label: 'Cut',
      shortcut: '⌘X',
      disabled: !range,
      run: () => {
        void writeText(range);
        // the deletion goes through the browser so the editor's `onInput` sees
        // it and the runs follow it, the way typing and pasting already do
        document.execCommand('delete');
      },
    },
    { label: 'Copy', shortcut: '⌘C', disabled: !range, run: () => writeText(range) },
    { label: 'Paste', shortcut: '⌘V', run: () => textActions.pastePlain?.() },

    { label: 'Bold', shortcut: '⌘B', divider: true, run: mark('bold') },
    { label: 'Italic', shortcut: '⌘I', run: mark('italic') },
    { label: 'Underline', shortcut: '⌘U', run: mark('underline') },
    { label: 'Strikethrough', shortcut: '⇧⌘X', run: mark('strike') },

    {
      label: 'Text alignment',
      divider: true,
      items: [
        { label: 'Left', shortcut: '⌥⌘L', run: () => alignText(store, [id], 'left') },
        { label: 'Center', shortcut: '⌥⌘T', run: () => alignText(store, [id], 'center') },
        { label: 'Right', shortcut: '⌥⌘R', run: () => alignText(store, [id], 'right') },
        { label: 'Justified', shortcut: '⌥⌘J', run: () => alignText(store, [id], 'justify') },
      ],
    },
  ];

  // Alone among the menus this one does not take the keyboard: the caret it
  // acts on lives in the focus, and a panel that took it would collapse the
  // range and end the edit before a row could run.
  return <Panel items={items} x={x} y={y} width={200} onClose={onClose} takeFocus={false} />;
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
  const pageId = useUI((s) => s.page);
  const pages = usePages();
  const setHover = useUI((s) => s.setHover);
  const editing = useUI((s) => s.editing);

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

  // and one over a caret is about the characters, not about the layer they sit
  // in — offering Delete there would destroy the layer you are mid-sentence in
  if (editing && doc[editing]) {
    return <TextMenu id={editing} x={menu.x} y={menu.y} onClose={close} />;
  }

  const has = selection.length > 0;
  const one = selection.length === 1;
  /**
   * Whether anything in the selection follows a main.
   *
   * Figma omits the instance commands rather than greying them — a rectangle
   * has no main to detach from, and a row that can never light up on this
   * selection is noise. The greying below still does its job inside the group:
   * with an instance selected, "Push changes" says by greying that there is
   * nothing to push.
   */
  const instances = selection.some((id) => doc[id]?.instanceOf);
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

  /**
   * Figma's "Rasterize selection".
   *
   * Rendered here rather than in the store because this is where the DOM is —
   * the picture is the canvas's own rendering of the layer, read back through
   * the same exporter the PNG export uses, so what you get is what you saw.
   *
   * Every layer is rendered before the first one is replaced: rasterising as we
   * go would take the next layer's element off the canvas midway through, and
   * a layer that is not on screen cannot be rendered.
   */
  async function rasterizeSelection() {
    const rendered: [string, string][] = [];
    for (const id of selection) {
      try {
        const blob = await nodeToPng(id, zoom, 2, tokenVars);
        rendered.push([id, await blobToDataUrl(blob)]);
      } catch {
        // a layer that is not on screen cannot be rendered; the rest still can
      }
    }
    const made = rendered
      .map(([id, src]) => store.rasterize(id, src))
      .filter((id): id is string => !!id);
    store.commit();
    if (made.length) select(made);
  }

  /** A text layer already following a path, when that is the whole selection. */
  const onPath = one && first?.textPath ? first.id : null;

  /**
   * The pair a "Type on path" needs: exactly one text layer and exactly one
   * shape whose points can be opened, in either order.
   */
  const typeOnPath = (() => {
    if (selection.length !== 2) return null;
    const [a, b] = selection.map((id) => doc[id]);
    if (!a || !b) return null;
    const text = a.type === 'text' ? a : b.type === 'text' ? b : null;
    const source = text === a ? b : a;
    if (!text || text.textPath || !canEditPoints(source.type)) return null;
    return { text: text.id, source: source.id };
  })();

  /**
   * Figma's canvas menu, which is a different menu rather than the object menu
   * with everything greyed.
   *
   * Nothing under the pointer and nothing selected means every command that
   * acts on a layer is dead, so none of them is offered — what is left is the
   * handful of things the canvas itself can do.
   */
  if (!has && !menu.stack.length) {
    const ui = useUI.getState();
    return (
      <Panel
        items={[
          { label: 'Paste here', disabled: !hasNodes(), run: pasteHere },
          {
            label: 'Show/Hide UI',
            shortcut: '⌘\\',
            divider: true,
            run: () => ui.toggleChrome(),
          },
          { label: 'Show/Hide comments', shortcut: '⇧C', run: () => ui.toggleView('comments') },
          {
            label: 'Show/Hide multiplayer cursors',
            shortcut: '⌥⌘\\',
            run: () => ui.toggleView('cursors'),
          },
          {
            label: 'Zoom to fit',
            shortcut: '⇧1',
            divider: true,
            run: () => {
              const fitted = fitView(doc, ui.leftPanel, ui.leftWidth, ui.rightWidth);
              if (fitted) ui.setViewport(fitted);
            },
          },
          { label: 'Zoom to 100%', shortcut: '⇧0', run: () => ui.zoomTo(1) },
          {
            label: 'Select all',
            shortcut: '⌘A',
            divider: true,
            // select-all applies to the level you're in, as the keyboard's does
            run: () => select(doc[level()]?.children ?? []),
          },
          {
            label: 'Actions…',
            shortcut: '⌘/',
            divider: true,
            run: () => ui.setPaletteOpen(true),
          },
        ]}
        x={menu.x}
        y={menu.y}
        width={232}
        onClose={close}
      />
    );
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
    {
      label: 'Tailwind',
      shortcut: '⌥T',
      disabled: !one,
      run: () => {
        const { markup, css } = toTailwind(target, doc, tokens, collections, fonts);
        return writeText(css.trim() ? `${markup}\n\n/* ${safeFilename(first?.name ?? 'layer')}.css */\n${css}` : markup);
      },
    },
    { label: 'HTML', disabled: !one, run: () => writeText(toHtml(target, doc, tokens, collections, fonts)) },
    { label: 'SwiftUI', disabled: !one, run: () => writeText(toSwiftUI(target, doc, tokens)) },
    { label: 'Android XML', disabled: !one, run: () => writeText(toAndroidXml(target, doc, tokens)) },
    { label: 'JSON', disabled: !one, run: () => writeText(toJson(target, doc)) },
  ];

  const copyPasteAs: Item[] = [
    {
      label: 'Copy link to layer',
      shortcut: '⌘L',
      disabled: !one,
      // the layer is a query on the file's own URL, and the editor reads it
      // back on load — opening on the right page, selected and framed
      run: () => writeText(`${location.origin}${location.pathname}?node=${target}`),
    },
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
      // Figma offers these four wherever you right-click, selection or not
      label: 'Show/Hide UI',
      shortcut: '⌘\\',
      run: () => useUI.getState().toggleChrome(),
    },
    {
      label: 'Show/Hide comments',
      shortcut: '⇧C',
      run: () => useUI.getState().toggleView('comments'),
    },
    {
      label: 'Actions…',
      shortcut: '⌘/',
      divider: true,
      run: () => useUI.getState().setPaletteOpen(true),
    },
    {
      label: 'Copy',
      shortcut: '⌘C',
      divider: true,
      disabled: !has,
      run: () => void writeNodes(store.serialize(selection)),
    },
    { label: 'Paste here', disabled: !hasNodes(), run: pasteHere },
    { label: 'Paste to replace', shortcut: '⇧⌘R', disabled: !hasNodes() || !has, run: pasteToReplace },
    { label: 'Copy/Paste as', items: copyPasteAs },
    {
      label: 'Duplicate',
      shortcut: '⌘D',
      disabled: !has,
      run: () => select(store.duplicate(selection)),
    },
    {
      label: 'Rename',
      shortcut: '⌘R',
      disabled: !has,
      run: () => useUI.getState().setRenameOpen(true),
    },
    {
      label: 'Move to page',
      // a file with one page has nowhere to move to, so the row greys rather
      // than opening onto an empty list
      disabled: !has || pages.length < 2,
      items: pages
        .filter((id) => id !== pageId)
        .map((id) => ({
          label: doc[id]?.name ?? 'Page',
          run: () => {
            store.moveToPage(selection, id);
            store.commit();
            // the layers are on another page now; keeping them selected would
            // leave the panels describing something nobody can see
            select([]);
          },
        })),
    },
    ...(instances
      ? [
          {
            label: 'Detach instance',
            shortcut: '⌥⌘B',
            run: () => {
              for (const id of selection) if (doc[id]?.instanceOf) store.detachInstance(id);
              store.commit();
            },
          },
          {
            label: 'Go to main component',
            disabled: !one || !mainOf(first) || !doc[mainOf(first)!],
            run: () => revealNode(mainOf(first)!, doc),
          },
          {
            label: 'Push changes to main component',
            // nothing to push is not the same as nothing selected, and the row
            // says which by greying rather than by running and doing nothing
            disabled: !one || !doc[mainOf(first) ?? ''] || !hasOverrides(first?.id ?? '', doc),
            run: () => {
              store.pushToMain(target);
              store.commit();
            },
          },
          {
            label: 'Restore component',
            // only for an instance whose main has gone: with the main still
            // there this would make a second one
            disabled: !one || !mainOf(first) || !!doc[mainOf(first)!],
            run: () => {
              const restored = store.restoreComponent(target);
              store.commit();
              if (restored) select([restored]);
            },
          },
        ]
      : []),
    {
      label: onPath ? 'Take off path' : 'Type on path',
      // two layers, one of them text and one with an outline — Figma's own
      // requirement, and the reason this is a menu command rather than a panel
      // control: a panel only ever knows about one layer
      disabled: !onPath && !typeOnPath,
      run: () => {
        if (onPath) store.detachFromPath(onPath);
        else if (typeOnPath) store.attachToPath(typeOnPath.text, typeOnPath.source);
        store.commit();
      },
    },
    {
      label: 'Rasterize selection',
      disabled: !has,
      run: () => void rasterizeSelection(),
    },
    { label: 'Bring to front', shortcut: ']', divider: true, disabled: !has, run: () => store.reorder(selection, 'front') },
    { label: 'Bring forward', shortcut: '⌘]', disabled: !has, run: () => store.reorder(selection, 'forward') },
    { label: 'Send backward', shortcut: '⌘[', disabled: !has, run: () => store.reorder(selection, 'backward') },
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
        { label: 'Exclude selection', shortcut: '⌥⌘E', run: () => combine('exclude') },
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
      label: 'Set as thumbnail',
      // the file browser shows one frame per file; this is how you choose it
      disabled: selection.length !== 1 || first?.type !== 'frame',
      run: () => store.update(pageId, { thumbnailOf: selection[0] }),
    },
    {
      // Figma's menu says which way it will go, rather than offering both
      label: first?.flex ? 'Remove auto layout' : 'Add auto layout',
      shortcut: '⇧A',
      divider: true,
      disabled: !has,
      run: () => {
        if (first?.flex) {
          for (const id of selection) store.setAutoLayout(id, false);
          return;
        }
        const id = store.autoLayoutSelection(selection);
        if (id) select([id]);
      },
    },
    // two mains or it is not a thing you can ask for, so the row is absent
    // rather than permanently grey on the selections that fill this menu
    ...(selection.filter((id) => doc[id]?.isComponent).length >= 2
      ? [
          {
            label: 'Combine as variants',
            run: () => {
              const id = store.combineAsVariants(selection);
              if (id) select([id]);
            },
          },
        ]
      : []),
    {
      label: 'Create component',
      shortcut: '⌥⌘K',
      disabled: !has,
      run: () => {
        const made = componentize(store, selection);
        if (made) select([made]);
      },
    },
    {
      // Figma's second gesture: a row of icons becomes a row of components,
      // rather than one component with a row of icons inside it
      label: 'Create multiple components',
      disabled: selection.length < 2,
      run: () => void componentizeEach(store, selection),
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
