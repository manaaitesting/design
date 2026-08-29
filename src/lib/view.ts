import { PANEL } from '../state/ui';
import { ROOT_ID, type Doc } from '../document/types';

/**
 * Framing the canvas.
 *
 * "Zoom to fit" and "Zoom to selection" are the same arithmetic over different
 * boxes, and the keyboard, the initial framing and the zoom menu all want it —
 * so it lives here rather than in whichever component happened to need it first.
 */

/** World-space bounding box of everything on the page. */
export function contentBounds(doc: Doc) {
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
export function fitView(doc: Doc, leftPanel: boolean, leftWidth: number, rightWidth: number) {
  const bounds = contentBounds(doc);
  if (!bounds) return null;
  return fitBounds(bounds, leftPanel, leftWidth, rightWidth);
}

/** Viewport that centres `bounds` in the canvas area between the panels. */
export function fitBounds(bounds: Bounds, leftPanel: boolean, leftWidth: number, rightWidth: number) {
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
