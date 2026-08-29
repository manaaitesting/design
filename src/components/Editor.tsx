'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas } from './Canvas';
import { ContextMenu } from './ContextMenu';
import { ExportDialog } from './ExportDialog';
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
import { useDoc, useStore, useTokenVars } from './Session';
import { PANEL, ZOOM, useUI, type Tool } from '../state/ui';
import { fitBounds, fitView, selectionBounds } from '../lib/view';
import { ROOT_ID, type BooleanOp, type Doc } from '../document/types';
import { firstChild, parentOf, siblingOf } from '../document/selection';
import { openingFrame } from '../document/prototype';
import { canEditPoints } from '../document/geometry';
import { readNodes, writeNodes } from '../lib/clipboard';
import { copyAsPng, copyProperties, flip, pasteAt, pasteProperties } from '../lib/actions';
import { download, safeFilename } from '../export/raster';

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

export function Editor({ fileName }: { fileName: string }) {
  const store = useStore();
  const doc = useDoc();
  const tokenVars = useTokenVars();
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

  // A link copied from the Pages menu carries `?page=` — open on that page once
  // the document has actually loaded it, rather than on whatever came first.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    const wanted = new URLSearchParams(window.location.search).get('page');
    if (!wanted) {
      deepLinked.current = true;
      return;
    }
    if (!store.listPages().includes(wanted)) return;
    deepLinked.current = true;
    useUI.getState().setPage(wanted);
  }, [doc, store]);

  // Frame the document once, as soon as the first content arrives from sync.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current) return;
    const fitted = fitView(doc, leftPanel, leftWidth, rightWidth);
    if (!fitted) return;
    framed.current = true;
    useUI.getState().setViewport(fitted);
  }, [doc, leftPanel, leftWidth, rightWidth]);

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
      if (event.shiftKey && event.key.toLowerCase() === 's' && selection.length) {
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
      if (event.key === ']' && selection.length) return store.reorder(selection, 'front');
      if (event.key === '[' && selection.length) return store.reorder(selection, 'back');

      // ── Nudge ──────────────────────────────────────────────────────────
      if (event.key.startsWith('Arrow') && selection.length) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        store.updateMany(selection, (n) => ({ x: n.x + dx, y: n.y + dy }));
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
  }, [store, doc, leftPanel, tokenVars]);

  return (
    <div
      className="fig-shell"
      // Figma's Outlines view: the design as its geometry, with the paint taken
      // away. It is a way of looking, not a change to the document, so it is a
      // class on the shell rather than anything the canvas has to re-render.
      data-outlines={outlines ? 'true' : undefined}
      style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}
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
      <History />
      <Palette />
      <Present />
    </div>
  );
}
