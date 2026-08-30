import { PANEL, ZOOM, useUI } from '../state/ui';
import { pageOf, pagePoint, ROOT_ID, type Doc } from '../document/types';

/**
 * Framing the canvas.
 *
 * "Zoom to fit" and "Zoom to selection" are the same arithmetic over different
 * boxes, and the keyboard, the initial framing and the zoom menu all want it —
 * so it lives here rather than in whichever component happened to need it first.
 */

/**
 * World-space bounding box of everything on a page.
 *
 * `doc` is the whole document, every page's nodes in one map, so the page has
 * to be named — reading the first one measured Page 1's layers however far
 * away you had navigated.
 */
export function contentBounds(doc: Doc, pageId: string) {
  const page = doc[pageId] ?? doc[ROOT_ID];
  const kids = (page?.children ?? []).map((id) => doc[id]).filter(Boolean);
  if (!kids.length) return null;
  return {
    minX: Math.min(...kids.map((n) => n.x)),
    minY: Math.min(...kids.map((n) => n.y)),
    maxX: Math.max(...kids.map((n) => n.x + n.w)),
    maxY: Math.max(...kids.map((n) => n.y + n.h)),
  };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World-space box around a set of layers — Figma's Zoom to selection. */
export function selectionBounds(ids: string[], doc: Doc): Bounds | null {
  const nodes = ids.map((id) => doc[id]).filter(Boolean);
  if (!nodes.length) return null;
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h)),
  };
}

/** Viewport that centres the page's content in the canvas area. */
export function fitView(
  doc: Doc,
  pageId: string,
  leftPanel: boolean,
  leftWidth: number,
  rightWidth: number,
  maxZoom?: number,
) {
  const bounds = contentBounds(doc, pageId);
  if (!bounds) return null;
  return fitBounds(bounds, leftPanel, leftWidth, rightWidth, maxZoom);
}

/**
 * Viewport that centres `bounds` in the canvas area between the panels.
 *
 * Fitting magnifies as readily as it shrinks — framing a 24px icon in Figma
 * fills the screen with it — so the ceiling is the canvas's own, not 100%.
 * `maxZoom` is there for the one caller that wants the old behaviour: a file
 * opening on a single small layer should not greet you at 40×.
 */
export function fitBounds(
  bounds: Bounds,
  leftPanel: boolean,
  leftWidth: number,
  rightWidth: number,
  maxZoom: number = ZOOM.max,
) {
  // each panel is a border wider than its content box
  const left = leftPanel ? leftWidth + PANEL.border : 0;
  const width = window.innerWidth - left - PANEL.toolRail - (rightWidth + PANEL.border);
  const height = window.innerHeight;
  const zoom = Math.max(
    ZOOM.min,
    Math.min(
      maxZoom,
      Math.min(
        width / (bounds.maxX - bounds.minX + 160),
        height / (bounds.maxY - bounds.minY + 160),
      ),
    ),
  );
  return {
    zoom,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

/**
 * The middle of the canvas area, in world coordinates.
 *
 * Where something goes when it is created from a panel rather than drawn: the
 * Assets list dropping a component, the frame presets making a board. `inset`
 * backs off by half the thing's size so it lands centred rather than with its
 * corner in the middle.
 */
export function viewCentre(
  viewport: { x: number; y: number; zoom: number },
  inset: { w: number; h: number } = { w: 120, h: 80 },
): { x: number; y: number } {
  const rect =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>('[data-canvas-root]')?.getBoundingClientRect();
  const width = rect?.width ?? 1200;
  const height = rect?.height ?? 800;
  return {
    x: Math.round((width / 2 - viewport.x) / viewport.zoom - inset.w / 2),
    y: Math.round((height / 2 - viewport.y) / viewport.zoom - inset.h / 2),
  };
}

/**
 * Puts a layer on screen: its page, selected, framed.
 *
 * The order matters — the page has to change before the selection, or the
 * selection lands on a page nobody is looking at. The box is measured in page
 * space rather than off `node.x`, because a layer worth jumping to is often
 * nested: a variant main lives inside its component set, and framing it by its
 * parent-local coordinates would land on empty canvas.
 */
export function revealNode(id: string, doc: Doc): boolean {
  const node = doc[id];
  const home = pageOf(id, doc);
  if (!node || !home) return false;

  const ui = useUI.getState();
  ui.setPage(home);
  ui.select([id]);

  const at = pagePoint(id, doc);
  const fitted = fitBounds(
    { minX: at.x, minY: at.y, maxX: at.x + node.w, maxY: at.y + node.h },
    ui.leftPanel,
    ui.leftWidth,
    ui.rightWidth,
  );
  if (fitted) ui.setViewport(fitted);
  return true;
}
