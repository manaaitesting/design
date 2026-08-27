'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas } from './Canvas';
import { ContextMenu } from './ContextMenu';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { Present } from './Present';
import { PromptBar } from './PromptBar';
import { Resizer } from './Resizer';
import { ShadersModal } from './ShadersModal';
import { ToolRail } from './ToolRail';
import { useDoc, useStore, useTokenVars } from './Session';
import { PANEL, useUI, type Tool } from '../state/ui';
import { ROOT_ID, type Doc } from '../document/types';
import { firstChild, parentOf, siblingOf } from '../document/selection';
import { openingFrame } from '../document/prototype';
import { readNodes, writeNodes } from '../lib/clipboard';
import { copyAsPng, copyProperties, flip, pasteAt, pasteProperties } from '../lib/actions';
import { download, safeFilename } from '../export/raster';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'move',
  h: 'pan',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  p: 'pen',
  t: 'text',
  c: 'comment',
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

/** World-space bounding box of everything on the page. */
function contentBounds(doc: Doc) {
  const page = doc[ROOT_ID];
  const kids = (page?.children ?? []).map((id) => doc[id]).filter(Boolean);
  if (!kids.length) return null;
  return {
    minX: Math.min(...kids.map((n) => n.x)),
    minY: Math.min(...kids.map((n) => n.y)),
    maxX: Math.max(...kids.map((n) => n.x + n.w)),
    maxY: Math.max(...kids.map((n) => n.y + n.h)),
  };
}

/** Viewport that centres the page's content in the canvas area. */
function fitView(doc: Doc, leftPanel: boolean, leftWidth: number, rightWidth: number) {
  const bounds = contentBounds(doc);
  if (!bounds) return null;
  // each panel is a border wider than its content box
  const left = leftPanel ? leftWidth + PANEL.border : 0;
  const width = window.innerWidth - left - PANEL.toolRail - (rightWidth + PANEL.border);
  const height = window.innerHeight;
  const zoom = Math.min(
    1,
    Math.min(width / (bounds.maxX - bounds.minX + 160), height / (bounds.maxY - bounds.minY + 160)),
  );
  return {
    zoom,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

export function Editor({ fileName }: { fileName: string }) {
  const store = useStore();
  const doc = useDoc();
  const tokenVars = useTokenVars();
  const leftPanel = useUI((s) => s.leftPanel);
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

      if (event.key === 'Escape') {
        if (ui.exportOpen) ui.setExportOpen(false);
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

      // ── Tools ──────────────────────────────────────────────────────────
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
        const id = store.wrapInFlex(selection);
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
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        ui.setViewport((vp) => ({ ...vp, zoom: Math.min(64, vp.zoom * 1.25) }));
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        ui.setViewport((vp) => ({ ...vp, zoom: Math.max(0.02, vp.zoom / 1.25) }));
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        ui.setViewport((vp) => ({ ...vp, zoom: 1 }));
        return;
      }
      if ((mod && event.key === '1') || (!mod && event.shiftKey && event.key === '1')) {
        event.preventDefault();
        const fitted = fitView(doc, leftPanel, ui.leftWidth, ui.rightWidth);
        if (fitted) ui.setViewport(fitted);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, doc, leftPanel, tokenVars]);

  return (
    <div className="fig-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {leftPanel && <LeftPanel fileName={fileName} />}
      {leftPanel && (
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
      <ToolRail />
      <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
        <Canvas />
        <PromptBar />
      </div>
      <Resizer
        side="right"
        label="Resize design panel"
        width={rightWidth}
        min={PANEL.right.min}
        max={PANEL.right.max}
        onResize={useUI.getState().setRightWidth}
        onReset={useUI.getState().resetRightWidth}
      />
      <Inspector />

      <ContextMenu />
      <ShadersModal />
      <ExportDialog />
      <Present />
    </div>
  );
}
