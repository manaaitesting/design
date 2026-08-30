'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas } from './Canvas';
import { ContextMenu } from './ContextMenu';
import { ExportDialog } from './ExportDialog';
import { RenameDialog } from './RenameDialog';
import { FontFaces } from './FontFaces';
import { Thumbnail } from './Thumbnail';
import { History } from './History';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { Present } from './Present';
import { PromptBar } from './PromptBar';
import { Resizer } from './Resizer';
import { ShadersModal } from './ShadersModal';
import { ToolRail, sampleColor } from './ToolRail';
import { useCollections, useCustomFonts, useDoc, useStore, useTokens, useTokenVars } from './Session';
import { PANEL, ZOOM, loadFileView, saveFileView, useUI, type Tool, type Viewport } from '../state/ui';
import { fitBounds, fitView, selectionBounds } from '../lib/view';
import { boardsOf } from '../document/layers';
import { isInFlow, ROOT_ID, pageOf, topLevelOf, type BooleanOp, type Doc } from '../document/types';
import { firstChild, inverseOf, parentOf, siblingOf } from '../document/selection';
import { openingFrame } from '../document/prototype';
import { canEditPoints } from '../document/geometry';
import { readNodes, writeNodes } from '../lib/clipboard';
import {
  alignText,
  copyAsPng,
  copyProperties,
  flip,
  pasteAt,
  pasteProperties,
  stepFontSize,
  TEXT_ALIGN_KEYS,
} from '../lib/actions';
import { download, safeFilename } from '../export/raster';
import { toTailwind } from '../export/tailwind';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'move',
  k: 'scale',
  h: 'pan',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  s: 'slice',
  t: 'text',
  c: 'comment',
};

/** Tools that need ⇧ — Figma puts the arrow behind the line this way. */
const SHIFT_TOOL_KEYS: Record<string, Tool> = {
  l: 'arrow',
  // ⇧S arms the Section tool. Wrapping a selection in one is ⌘S, which is a
  // different command on a different key — see the handler below.
  s: 'section',
};
/**
 * Figma's alignment shortcuts, by physical key.
 *
 * Keyed on `event.code` for the same reason the boolean ops below are: ⌥ rewrites
 * the character on macOS, so ⌥A arrives as "å" and `event.key` cannot match it.
 */
const ALIGN_KEYS: Record<string, 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'> = {
  KeyA: 'left',
  KeyH: 'hcenter',
  KeyD: 'right',
  KeyW: 'top',
  KeyV: 'vcenter',
  KeyS: 'bottom',
};


/** Figma's boolean shortcuts, by the key each one is bound to. */
const BOOLEAN_KEYS: Record<string, BooleanOp> = {
  KeyU: 'union',
  KeyS: 'subtract',
  KeyI: 'intersect',
  // Figma binds Exclude to E, not X — X is the fill/stroke swap
  KeyE: 'exclude',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * useLayoutEffect warns when a client component is rendered on the server,
 * which this one is. On the client it still runs before paint, so a restored
 * panel width lands without a frame at the default.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Editor({ fileName, room }: { fileName: string; room: string }) {
  const store = useStore();
  const doc = useDoc();
  const tokenVars = useTokenVars();
  const tokens = useTokens();
  const collections = useCollections();
  const fonts = useCustomFonts();
  const leftPanel = useUI((s) => s.leftPanel);
  const outlines = useUI((s) => s.view.outlines);
  const chrome = useUI((s) => s.chrome);
  const leftWidth = useUI((s) => s.leftWidth);
  const rightWidth = useUI((s) => s.rightWidth);

  // Saved widths are read after mount: reading them during render would make
  // the server and client markup disagree.
  useIsoLayoutEffect(() => {
    useUI.getState().hydratePanels();
  }, []);

  // The UI store outlives this component, and a selection, a drilled-into frame
  // or a page id from the tab you just left names nothing in the file you just
  // opened. Runs before the effects below, which restore what *this* file had.
  const openedAt = useRef<Viewport | null>(null);
  useIsoLayoutEffect(() => {
    useUI.getState().resetForFile();
    // Where the canvas stood the moment this file opened. Framing waits for the
    // document to arrive, which can be a beat or two; if the viewport has moved
    // by then, someone is already looking around and the frame must not yank
    // the canvas out from under them.
    openedAt.current = useUI.getState().viewport;
  }, [room]);

  // Shrinking the window can leave the panels wider than the space available.
  // Re-running the setters re-applies the clamp against the new innerWidth.
  useEffect(() => {
    const onResize = () => {
      const ui = useUI.getState();
      ui.setLeftWidth(ui.leftWidth);
      ui.setRightWidth(ui.rightWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Declared here rather than beside the framing effect below: the deep-link
  // effect sets it, to say the canvas has already been pointed somewhere.
  const framed = useRef(false);

  /**
   * The last digit typed, for Figma's opacity shortcut.
   *
   * A single digit is tens — 5 is 50% — but a second one typed straight after
   * refines the first rather than replacing it, so 4 then 5 is 45% and not 50%.
   * That only works if the keys remember each other for a moment.
   */
  const opacityKeys = useRef({ at: 0, digits: '' });

  // A copied link carries `?page=` and, when it points at one layer, `?node=`.
  // Both are honoured once the document has actually loaded, rather than on
  // whatever arrived first — and `node` wins, since a link to a layer says
  // which page it is on by saying which layer it is.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    const query = new URLSearchParams(window.location.search);
    const wantedPage = query.get('page');
    const wantedNode = query.get('node');
    if (!wantedPage && !wantedNode) {
      deepLinked.current = true;
      return;
    }

    const ui = useUI.getState();
    if (wantedNode) {
      // the node has to be here *and* reachable, or the page it names is wrong
      const home = pageOf(wantedNode, doc);
      if (!home) return;
      deepLinked.current = true;
      ui.setPage(home);
      ui.select([wantedNode]);
      const bounds = selectionBounds([wantedNode], doc);
      const fitted = bounds && fitBounds(bounds, leftPanel, ui.leftWidth, ui.rightWidth);
      if (fitted) ui.setViewport(fitted);
      // the frame-on-open effect below must not undo the framing we just did
      framed.current = true;
      return;
    }

    if (!store.listPages().includes(wantedPage!)) return;
    deepLinked.current = true;
    ui.setPage(wantedPage!);
  }, [doc, store, leftPanel]);

  // Frame the document once, as soon as the first content arrives from sync —
  // unless this file has been open in a tab before, in which case it reopens
  // where it was left rather than snapping back to fit-all.
  useEffect(() => {
    if (framed.current) return;
    // nothing has arrived from sync yet — restoring a page the document does
    // not have would silently drop you back on the first one
    const pages = store.listPages();
    if (!pages.length) return;

    const now = useUI.getState().viewport;
    const opened = openedAt.current;
    if (opened && (now.x !== opened.x || now.y !== opened.y || now.zoom !== opened.zoom)) {
      framed.current = true;
      return;
    }

    const saved = loadFileView(room);
    if (saved) {
      framed.current = true;
      const ui = useUI.getState();
      ui.setViewport(saved.viewport);
      // a `?page=` link is an explicit instruction and outranks the memory
      const linked = new URLSearchParams(window.location.search).get('page');
      if (!linked && saved.page !== ui.page && pages.includes(saved.page)) ui.setPage(saved.page);
      return;
    }
    // Past the check above the document has arrived, so this is the opening
    // view whether or not there was anything to frame. Leaving `framed` false
    // for an empty file would mean an empty file never remembers where you
    // left it — which is exactly the file you are about to put something in.
    framed.current = true;
    const fitted = fitView(doc, leftPanel, leftWidth, rightWidth);
    if (fitted) useUI.getState().setViewport(fitted);
  }, [doc, leftPanel, leftWidth, rightWidth, room, store]);

  // …and record where you leave it. Writing on every wheel tick would hammer
  // storage, so this settles first; the unmount write is what catches the last
  // move before a tab switch takes the component away.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remember = () => {
      const { viewport, page } = useUI.getState();
      const opened = openedAt.current;
      // Nothing has set a viewport for *this* file yet — while a file is still
      // arriving, what is on screen belongs to the tab we came from, and
      // writing it here would greet you with the wrong file's framing.
      if (
        opened &&
        viewport.x === opened.x &&
        viewport.y === opened.y &&
        viewport.zoom === opened.zoom
      ) {
        return;
      }
      saveFileView(room, { viewport, page });
    };
    const unsubscribe = useUI.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(remember, 400);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      remember();
    };
  }, [room]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = event.metaKey || event.ctrlKey;

      // Present runs its own keys; the editor's would fire underneath it
      if (ui.presenting) return;

      // ⇧⌘⏎ — play the prototype, as in Figma
      if (mod && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        ui.present(openingFrame(doc, ui.page, ui.selection));
        return;
      }

      // ⌘/ or ⌘K — quick actions. Checked before anything else so it opens
      // from wherever you are, including inside a panel field.
      // ⌥ is not part of this one: ⌥⌘K is "create component", and swallowing
      // it here would quietly break the menu's own shortcut
      // ⌘K is Figma's Create link when text is selected; the palette keeps ⌘/
      if (
        mod &&
        !event.altKey &&
        event.key.toLowerCase() === 'k' &&
        ui.selection.length === 1 &&
        doc[ui.selection[0]]?.type === 'text'
      ) {
        event.preventDefault();
        ui.setLinkEditor(ui.selection[0]);
        return;
      }
      if (mod && !event.altKey && (event.key === '/' || event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }

      if (event.key === 'Escape') {
        if (ui.paletteOpen) ui.setPaletteOpen(false);
        else if (ui.vectorEdit) ui.setVectorEdit(null);
        else if (ui.historyOpen) ui.setHistoryOpen(false);
        else if (ui.exportOpen) ui.setExportOpen(false);
        else if (ui.shadersOpen) ui.setShadersOpen(false);
        else if (ui.editing) ui.setEditing(null);
        else if (ui.contextMenu) ui.setContextMenu(null);
        else if (ui.prompt) {
          ui.setPrompt(null);
          ui.setTool('move');
        } else if (ui.selection.length === 1 && parentOf(ui.selection[0], doc)) {
          // Figma's Escape: step out to the parent, keeping a selection
          const parent = parentOf(ui.selection[0], doc)!;
          ui.select([parent]);
          ui.setEntered(parentOf(parent, doc));
        } else ui.clearSelection();
        return;
      }

      if (isTyping(event.target)) return;

      // Holding a shortcut fires keydown repeatedly. Structural commands must
      // run once per press, or a held ⌘G buries a layer nine frames deep.
      const ONE_SHOT = new Set(['g', 'd', 'a', 'f', 'e', 'l', 'h']);
      if (event.repeat && (ONE_SHOT.has(event.key.toLowerCase()) || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter')) {
        return;
      }
      // belt and braces: if a text node is in edit mode, keystrokes belong to it
      // even if the contentEditable lost focus, or "hello" would fire h/e/l/o
      // as tool shortcuts and scatter the document
      if (ui.editing) return;

      const { selection, select } = ui;

      // ── Walking the tree ───────────────────────────────────────────────
      if (event.key === 'Enter' && selection.length === 1 && !event.shiftKey) {
        // What a text layer has instead of children is its text, so ⏎ opens
        // that — the same key that steps into a frame steps into the words.
        if (doc[selection[0]]?.type === 'text') {
          event.preventDefault();
          ui.setEditing(selection[0]);
          return;
        }
        // a shape has points rather than children; ⏎ edits them. A parametric
        // one stays parametric until a point actually moves, so this is safe to
        // press on a star you only wanted to look at.
        if (canEditPoints(doc[selection[0]]?.type)) {
          event.preventDefault();
          ui.setVectorEdit(selection[0]);
          return;
        }
        const child = firstChild(selection[0], doc);
        if (child) {
          event.preventDefault();
          ui.setEntered(selection[0]);
          select([child]);
          return;
        }
      }
      if (event.key === 'Tab' && selection.length === 1) {
        const next = siblingOf(selection[0], doc, event.shiftKey ? -1 : 1);
        if (next) {
          event.preventDefault();
          select([next]);
          return;
        }
      }

      // ── Right-click menu commands ──────────────────────────────────────
      // These run before the plain clipboard block: ⌥⌘C and ⇧⌘C would
      // otherwise be swallowed by ⌘C, which does not test the modifiers.
      // Alt rewrites event.key on macOS (⌥C is 'ç'), so match on event.code.
      if (mod && event.altKey && event.code === 'KeyG' && selection.length) {
        event.preventDefault();
        const framed = store.wrapInFlex(selection, false);
        if (framed) select([framed]);
        return;
      }
      if (mod && event.altKey && event.code === 'KeyK' && selection.length === 1) {
        event.preventDefault();
        store.createComponent(selection[0]);
        return;
      }
      if (mod && event.altKey && BOOLEAN_KEYS[event.code] && selection.length > 1) {
        event.preventDefault();
        const combined = store.booleanGroup(selection, BOOLEAN_KEYS[event.code]);
        if (combined) select([combined]);
        return;
      }
      // ⌃⇧P — pixel preview, as Figma binds it: off → 1× → 2× → off
      if (event.ctrlKey && event.shiftKey && !mod && event.code === 'KeyP') {
        event.preventDefault();
        const now = ui.view.pixelPreview;
        ui.setPixelPreview(now === 'off' ? '1x' : now === '1x' ? '2x' : 'off');
        return;
      }
      // ⌘\ — every panel out of the way, as Figma binds it
      if (mod && event.code === 'Backslash' && !event.altKey) {
        event.preventDefault();
        ui.toggleChrome();
        return;
      }
      // ⇧E — the Measure tool, latched; ⌥ still measures without it
      if (!mod && event.shiftKey && !event.altKey && event.code === 'KeyE') {
        event.preventDefault();
        ui.setTool(ui.tool === 'measure' ? 'move' : 'measure');
        return;
      }
      // ⌘L — a link back to exactly this: the file, the page, and the layer
      // when there is one. Figma's Copy link, and what `?node=` above reads.
      if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyL') {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.search = '';
        if (selection.length === 1) url.searchParams.set('node', selection[0]);
        else url.searchParams.set('page', ui.page);
        void navigator.clipboard?.writeText(url.toString());
        return;
      }
      // ⌥T — the selection as Tailwind, beside the other ⌥ copies
      if (event.altKey && !mod && !event.shiftKey && event.code === 'KeyT' && selection.length === 1) {
        event.preventDefault();
        const { markup, css } = toTailwind(selection[0], doc, tokens, collections, fonts);
        void navigator.clipboard?.writeText(css.trim() ? `${markup}\n\n/* stylesheet */\n${css}` : markup);
        return;
      }
      // I — sample a colour into the selection, Figma's "Copy colors"
      if (!mod && !event.altKey && !event.shiftKey && event.code === 'KeyI' && selection.length) {
        event.preventDefault();
        void sampleColor(store, selection);
        return;
      }
      // ⌥L — shut every open row in the layers panel, as Figma binds it
      if (event.altKey && !mod && !event.ctrlKey && event.code === 'KeyL') {
        event.preventDefault();
        ui.collapseLayers();
        return;
      }
      // ⌥A / ⌥D / ⌥W / ⌥S / ⌥H / ⌥V — Figma's six alignment shortcuts, next to
      // the tidy and distribute ones below. `store.align` already knows the
      // rule: one layer aligns inside its parent, several to the box they share.
      if (event.altKey && !mod && !event.ctrlKey && !event.shiftKey && selection.length) {
        const edge = ALIGN_KEYS[event.code];
        if (edge) {
          event.preventDefault();
          store.align(selection, edge);
          return;
        }
      }
      // ⌃⌥T / ⌃⌥V / ⌃⌥H — tidy up and distribute, as Figma binds them
      if (event.ctrlKey && event.altKey && !event.metaKey && selection.length > 1) {
        if (event.code === 'KeyT') {
          event.preventDefault();
          store.tidyUp(selection);
          return;
        }
        if (event.code === 'KeyV' && selection.length > 2) {
          event.preventDefault();
          store.distribute(selection, 'vertical');
          return;
        }
        if (event.code === 'KeyH' && selection.length > 2) {
          event.preventDefault();
          store.distribute(selection, 'horizontal');
          return;
        }
      }
      // ⌃⌘M — use the selection as a mask, as Figma binds it
      if (event.ctrlKey && event.metaKey && event.code === 'KeyM' && selection.length) {
        event.preventDefault();
        store.toggleMask(selection);
        return;
      }
      // ⌘E — flatten to one editable path, as Figma binds it
      if (mod && !event.shiftKey && event.code === 'KeyE' && selection.length) {
        event.preventDefault();
        const flattened = store.flatten(selection);
        if (flattened) {
          select([flattened]);
          ui.setVectorEdit(flattened);
        }
        return;
      }
      // ⇧⌘O — turn a stroke into a shape
      if (mod && event.shiftKey && event.code === 'KeyO' && selection.length) {
        event.preventDefault();
        const made = store.outlineStroke(selection);
        if (made.length) select(made);
        return;
      }
      if (mod && event.altKey && event.code === 'KeyC' && selection.length) {
        event.preventDefault();
        copyProperties(doc, selection);
        return;
      }
      if (mod && event.altKey && event.code === 'KeyV' && selection.length) {
        event.preventDefault();
        pasteProperties(store, selection);
        return;
      }
      // ⌥⌘B — detach an instance from its main, as Figma binds it. Only
      // instances answer, so the key falls through on anything else.
      if (mod && event.altKey && event.code === 'KeyB' && selection.length) {
        const instances = selection.filter((id) => doc[id]?.instanceOf);
        if (instances.length) {
          event.preventDefault();
          for (const id of instances) store.detachInstance(id);
          store.commit();
          return;
        }
      }
      // ⌥⌘L / ⌥⌘T / ⌥⌘R / ⌥⌘J — text alignment, which is a layer property here
      // and so belongs on the selection rather than on a run
      if (mod && event.altKey && !event.shiftKey && TEXT_ALIGN_KEYS[event.code] && selection.length) {
        if (alignText(store, selection, TEXT_ALIGN_KEYS[event.code])) {
          event.preventDefault();
          return;
        }
      }
      // ⇧⌘< / ⇧⌘> — one point of type at a time. `<` is ⇧, so the key underneath
      // is the comma; matching the character would need the shift back off it.
      if (mod && event.shiftKey && !event.altKey && selection.length) {
        const step = event.code === 'Comma' ? -1 : event.code === 'Period' ? 1 : 0;
        if (step && stepFontSize(store, selection, step)) {
          event.preventDefault();
          return;
        }
      }
      // ⌘R — one name across the selection, Figma's Rename
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyR' && selection.length) {
        event.preventDefault();
        ui.setRenameOpen(true);
        return;
      }
      if (!mod && event.shiftKey && event.code === 'KeyR') {
        event.preventDefault();
        ui.toggleRulers();
        return;
      }
      // Figma's view options, on Figma's keys
      if (!mod && event.shiftKey && !event.altKey && event.code === 'KeyG') {
        event.preventDefault();
        ui.toggleView('layoutGuides');
        return;
      }
      if (!mod && event.shiftKey && !event.altKey && event.code === 'KeyC' && !event.ctrlKey) {
        event.preventDefault();
        ui.toggleView('comments');
        return;
      }
      if (!mod && event.shiftKey && !event.altKey && event.code === 'KeyY') {
        event.preventDefault();
        ui.toggleView('annotations');
        return;
      }
      if (event.altKey && event.shiftKey && !mod && event.code === 'KeyO') {
        event.preventDefault();
        ui.toggleView('outlines');
        return;
      }
      if (mod && event.altKey && event.code === 'Backslash') {
        event.preventDefault();
        ui.toggleView('cursors');
        return;
      }
      // ⇧' and ⇧⌘' — the pixel grid and whether drags land on it
      if (event.shiftKey && event.code === 'Quote') {
        event.preventDefault();
        ui.toggleView(mod ? 'snapToPixel' : 'pixelGrid');
        return;
      }
      if (mod && event.shiftKey && event.code === 'KeyR' && selection.length) {
        event.preventDefault();
        const anchorNode = doc[selection[0]];
        if (!anchorNode?.parent) return;
        const { parent, x, y } = anchorNode;
        const doomed = [...selection];
        void readNodes().then((payload) => {
          if (!payload) return;
          const pasted = pasteAt(store, payload, parent, { x, y });
          store.remove(doomed);
          if (pasted.length) select(pasted);
        });
        return;
      }
      if (mod && event.shiftKey && event.code === 'KeyC' && selection.length === 1) {
        event.preventDefault();
        const id = selection[0];
        const name = doc[id]?.name ?? 'layer';
        void copyAsPng(id, ui.viewport.zoom, 2, tokenVars, (blob) =>
          download(blob, `${safeFilename(name)}.png`),
        );
        return;
      }
      if (!mod && event.shiftKey && (event.code === 'KeyH' || event.code === 'KeyV') && selection.length) {
        event.preventDefault();
        flip(store, selection, event.code === 'KeyH' ? 'h' : 'v');
        return;
      }

      // ── Clipboard ──────────────────────────────────────────────────────
      if (mod && event.key.toLowerCase() === 'c' && selection.length) {
        event.preventDefault();
        void writeNodes(store.serialize(selection));
        return;
      }
      if (mod && event.key.toLowerCase() === 'x' && selection.length) {
        event.preventDefault();
        void writeNodes(store.serialize(selection));
        store.remove(selection);
        select([]);
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        const inPlace = event.shiftKey;
        void readNodes().then((payload) => {
          if (!payload) return;
          const level = ui.entered && doc[ui.entered] ? ui.entered : ui.page;

          // plain text on the clipboard becomes a text layer, as in Figma
          if (!payload.includes('"paperlike"')) {
            const id = store.create('text', level, { text: payload.slice(0, 500), wMode: 'fit', hMode: 'fit' });
            select([id]);
            return;
          }
          const pasted = store.paste(payload, level, inPlace ? { x: 0, y: 0 } : { x: 20, y: 20 });
          if (pasted.length) select(pasted);
        });
        return;
      }

      // ── Grouping ───────────────────────────────────────────────────────
      if (mod && event.key.toLowerCase() === 'g' && selection.length) {
        event.preventDefault();
        if (event.shiftKey) {
          const freed = store.ungroup(selection);
          select(freed.length ? freed : selection);
        } else {
          const id = store.group(selection);
          if (id) {
            select([id]);
            ui.setEntered(null);
          }
        }
        return;
      }

      // ⇧D — the handoff panel, where Figma puts Dev Mode
      if (!mod && event.shiftKey && event.code === 'KeyD') {
        event.preventDefault();
        ui.setInspectorTab(ui.inspectorTab === 'inspect' ? 'design' : 'inspect');
        return;
      }

      // ── Tools ──────────────────────────────────────────────────────────
      if (!mod && event.shiftKey && SHIFT_TOOL_KEYS[event.key.toLowerCase()]) {
        ui.setTool(SHIFT_TOOL_KEYS[event.key.toLowerCase()]);
        return;
      }
      if (!mod && !event.shiftKey && TOOL_KEYS[event.key.toLowerCase()]) {
        ui.setTool(TOOL_KEYS[event.key.toLowerCase()]);
        return;
      }

      // ── Document ───────────────────────────────────────────────────────
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd' && selection.length) {
        event.preventDefault();
        select(store.duplicate(selection));
        return;
      }
      // ⇧⌘A — select inverse, as Figma binds it. Checked before plain ⌘A,
      // which does not test its modifiers and would otherwise swallow it.
      if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const level = ui.entered && doc[ui.entered] ? ui.entered : ui.page;
        select(inverseOf(selection, doc, level));
        return;
      }
      // ⌥⌘A — select every layer on the page that looks like this one
      if (mod && event.altKey && event.key.toLowerCase() === 'a' && selection.length === 1) {
        event.preventDefault();
        const matches = store.selectMatching(selection[0], ui.page);
        if (matches.length) select(matches);
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        // select-all applies to the level you're in, not always the page
        const level = ui.entered && doc[ui.entered] ? ui.entered : ui.page;
        select(doc[level]?.children ?? doc[ROOT_ID]?.children ?? []);
        return;
      }
      if (mod && event.key.toLowerCase() === 'l' && !event.shiftKey) {
        event.preventDefault();
        void navigator.clipboard.writeText(window.location.href);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        ui.setExportOpen(true);
        return;
      }
      // ⌥⌘H — the snapshots the sync server has been keeping all along
      if (mod && event.altKey && event.code === 'KeyH') {
        event.preventDefault();
        ui.setHistoryOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'h' && selection.length) {
        event.preventDefault();
        store.updateMany(selection, (n) => ({ visible: !n.visible }));
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'l' && selection.length) {
        event.preventDefault();
        store.updateMany(selection, (n) => ({ locked: !n.locked }));
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
        event.preventDefault();
        store.remove(selection);
        select([]);
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === 'a' && selection.length) {
        event.preventDefault();
        const id = store.autoLayoutSelection(selection);
        if (id) select([id]);
        return;
      }
      // ⌘S wraps the selection in a section. Figma binds it here, not on ⇧S —
      // ⇧S arms the tool — and intercepts the browser's Save to do it, which is
      // the same trade every canvas app in a tab makes.
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyS' && selection.length) {
        event.preventDefault();
        const id = store.wrapInSection(selection);
        if (id) select([id]);
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'f' && selection.length) {
        event.preventDefault();
        const id = store.wrapInFlex(selection, false);
        if (id) select([id]);
        return;
      }
      // bare brackets go all the way, ⌘ steps one place — Figma's split
      if (event.key === ']' && selection.length) {
        event.preventDefault();
        return store.reorder(selection, mod ? 'forward' : 'front');
      }
      if (event.key === '[' && selection.length) {
        event.preventDefault();
        return store.reorder(selection, mod ? 'backward' : 'back');
      }

      // ── Nudge ──────────────────────────────────────────────────────────
      if (event.key.startsWith('Arrow') && selection.length) {
        event.preventDefault();

        // A flowed child has no x/y to nudge, so the arrows move it along the
        // order instead — and only along the axis the layout actually flows in,
        // since the cross axis is the layout's to decide.
        const first = doc[selection[0]];
        if (first && isInFlow(first, doc)) {
          const along: Record<string, 'forward' | 'backward'> =
            doc[first.parent!]?.flex?.direction === 'row'
              ? { ArrowRight: 'forward', ArrowLeft: 'backward' }
              : { ArrowDown: 'forward', ArrowUp: 'backward' };
          const where = along[event.key];
          if (where) store.reorder(selection, where);
          return;
        }

        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        store.updateMany(selection, (n) => ({ x: n.x + dx, y: n.y + dy }));
        return;
      }

      // ── Opacity ────────────────────────────────────────────────────────
      // Figma's digits: 5 is 50%, 0 is 100%, and a second digit typed straight
      // after refines the first — 4 then 5 is 45%. The zoom shortcuts below
      // take the same digits behind ⌘ or ⇧, which is why these want neither.
      if (
        !mod &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        selection.length &&
        /^[0-9]$/.test(event.key)
      ) {
        event.preventDefault();
        const now = Date.now();
        const run =
          now - opacityKeys.current.at < 700 ? opacityKeys.current.digits + event.key : event.key;
        opacityKeys.current = { at: now, digits: run.slice(-2) };
        const percent =
          run.length > 1 ? Number(run.slice(-2)) : Number(run) === 0 ? 100 : Number(run) * 10;
        store.updateMany(selection, { opacity: Math.min(100, Math.max(0, percent)) / 100 });
        store.commit();
        return;
      }

      // ── Walking the boards ─────────────────────────────────────────────
      // N and ⇧N, which Figma files under Zoom: the next or previous frame on
      // the page, in canvas order — left to right, then top to bottom, which is
      // the order Figma reads a page in rather than the stacking order.
      if (!mod && !event.altKey && event.code === 'KeyN') {
        event.preventDefault();
        const boards = boardsOf(doc, ui.page);
        if (!boards.length) return;

        const here = selection.length ? boards.indexOf(topLevelOf(selection[0], doc)) : -1;
        const next =
          here < 0
            ? event.shiftKey
              ? boards.length - 1
              : 0
            : (here + (event.shiftKey ? -1 : 1) + boards.length) % boards.length;

        const id = boards[next];
        select([id]);
        const bounds = selectionBounds([id], doc);
        const fitted = bounds && fitBounds(bounds, leftPanel, ui.leftWidth, ui.rightWidth);
        if (fitted) ui.setViewport(fitted);
        return;
      }

      // ── Zoom ───────────────────────────────────────────────────────────
      // Figma takes these with or without the modifier, and every one of them
      // zooms about the middle of the canvas rather than the world origin.
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        ui.zoomBy(ZOOM.step);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        ui.zoomBy(1 / ZOOM.step);
        return;
      }
      // the bare digits are Figma's opacity shortcuts, so these want a modifier
      if (event.key === '0' && (mod || event.shiftKey)) {
        event.preventDefault();
        ui.zoomTo(1);
        return;
      }
      if (event.key === '1' && (mod || event.shiftKey)) {
        event.preventDefault();
        const fitted = fitView(doc, leftPanel, ui.leftWidth, ui.rightWidth);
        if (fitted) ui.setViewport(fitted);
        return;
      }
      if (event.key === '2' && (mod || event.shiftKey)) {
        event.preventDefault();
        const bounds = selectionBounds(ui.selection, doc);
        const fitted = bounds && fitBounds(bounds, leftPanel, ui.leftWidth, ui.rightWidth);
        if (fitted) ui.setViewport(fitted);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, doc, leftPanel, tokenVars, tokens, collections, fonts]);

  return (
    <div
      className="fig-shell"
      // Figma's Outlines view: the design as its geometry, with the paint taken
      // away. It is a way of looking, not a change to the document, so it is a
      // class on the shell rather than anything the canvas has to re-render.
      data-outlines={outlines ? 'true' : undefined}
      // the tab strip above owns the rest of the viewport
      style={{ display: 'flex', height: '100%', overflow: 'hidden' }}
    >
      <FontFaces />
      <Thumbnail />
      {chrome && leftPanel && <LeftPanel fileName={fileName} />}
      {chrome && leftPanel && (
        <Resizer
          side="left"
          label="Resize layers panel"
          width={leftWidth}
          min={PANEL.left.min}
          max={PANEL.left.max}
          onResize={useUI.getState().setLeftWidth}
          onReset={useUI.getState().resetLeftWidth}
        />
      )}
      {chrome && <ToolRail />}
      <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
        <Canvas />
        <PromptBar />
      </div>
      {chrome && (
      <Resizer
        side="right"
        label="Resize design panel"
        width={rightWidth}
        min={PANEL.right.min}
        max={PANEL.right.max}
        onResize={useUI.getState().setRightWidth}
        onReset={useUI.getState().resetRightWidth}
      />
      )}
      {chrome && <Inspector />}

      <ContextMenu />
      <ShadersModal />
      <ExportDialog />
      <RenameDialog />
      <History />
      <Palette />
      <Present />
    </div>
  );
}
