'use client';

import { nodeStyle, styleToCss } from '../document/css';
import type { Doc, SceneNode } from '../document/types';
import type { DocStore } from '../document/store';
import { nodeToPng, nodeToSvg } from '../export/raster';
import { toWorld, type Viewport } from '../state/ui';

/**
 * The commands behind the right-click menu.
 *
 * They live here rather than in the menu component because the same commands
 * are on the keyboard: a shortcut printed next to a menu row has to run the
 * very same code, or the two drift apart the first time either is edited.
 */

/** What "Copy properties" carries: paint and type, never position or size. */
const STYLE_KEYS = [
  'fill',
  'fillVisible',
  'fillOpacity',
  'opacity',
  'blend',
  'radius',
  'radii',
  'border',
  'outline',
  'shadow',
  'innerShadow',
  'filters',
  'font',
] as const satisfies readonly (keyof SceneNode)[];

/** Module-level, like Figma's: it survives selection changes, not reloads. */
let styleClipboard: Partial<SceneNode> | null = null;

export function copyProperties(doc: Doc, selection: string[]): boolean {
  const node = doc[selection[0]];
  if (!node) return false;
  const picked: Partial<SceneNode> = {};
  for (const key of STYLE_KEYS) {
    const value = node[key];
    if (value !== undefined) (picked as Record<string, unknown>)[key] = value;
  }
  styleClipboard = picked;
  return true;
}

export function hasProperties(): boolean {
  return styleClipboard !== null;
}

export function pasteProperties(store: DocStore, selection: string[]): boolean {
  if (!styleClipboard || !selection.length) return false;
  // structuredClone so the pasted specs are not shared objects across nodes
  store.updateMany(selection, () => structuredClone(styleClipboard!));
  return true;
}

/** Test seam: lets a spec assert the clipboard is genuinely empty at first. */
export function resetProperties(): void {
  styleClipboard = null;
}

// ── code ────────────────────────────────────────────────────────────────
const cssClass = (node: SceneNode) =>
  (node.name || node.type).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';

/** One CSS rule per layer, from the same style function the canvas renders. */
export function cssFor(rootId: string, doc: Doc, deep: boolean): string {
  const rules: string[] = [];
  const visit = (id: string) => {
    const node = doc[id];
    if (!node) return;
    rules.push(`.${cssClass(node)} {\n${styleToCss(nodeStyle(node, doc))}\n}`);
    if (deep) node.children.forEach(visit);
  };
  visit(rootId);
  return rules.join('\n\n');
}

export async function writeText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export async function copyAsSvg(
  id: string,
  zoom: number,
  vars: Record<string, string>,
): Promise<boolean> {
  const serialised = nodeToSvg(id, zoom, vars);
  if (!serialised) return false;
  return writeText(serialised.svg);
}

/**
 * PNG goes to the clipboard as an image where the browser allows it. Safari
 * and Firefox reject `ClipboardItem` for anything but text, so fall back to a
 * download rather than failing silently.
 */
export async function copyAsPng(
  id: string,
  zoom: number,
  scale: number,
  vars: Record<string, string>,
  onFallback: (blob: Blob) => void,
): Promise<boolean> {
  const blob = await nodeToPng(id, zoom, scale, vars);
  try {
    const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (!Item) throw new Error('no ClipboardItem');
    await navigator.clipboard.write([new Item({ 'image/png': blob })]);
    return true;
  } catch {
    onFallback(blob);
    return false;
  }
}

// ── geometry ────────────────────────────────────────────────────────────
/**
 * Where a click at (clientX, clientY) lands in the document, or null when it
 * lands outside the canvas — a menu opened from the layers panel has no point
 * under it, and callers should fall back rather than paste off-screen.
 */
export function pointerWorld(vp: Viewport, clientX: number, clientY: number) {
  const canvas = document.querySelector<HTMLElement>('[data-canvas-root]');
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return null;
  const inside =
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  if (!inside) return null;
  return toWorld(vp, clientX - rect.left, clientY - rect.top);
}

/**
 * Paste, then shift what landed so its top-left sits under the pointer —
 * simpler than reverse-engineering the payload's own origin, and it keeps the
 * relative layout of a multi-node paste intact.
 */
export function pasteAt(
  store: DocStore,
  payload: string,
  parentId: string,
  at: { x: number; y: number },
): string[] {
  const pasted = store.paste(payload, parentId, { x: 0, y: 0 });
  if (!pasted.length) return pasted;
  const snap = store.getSnapshot();
  const nodes = pasted.map((id) => snap[id]).filter(Boolean);
  if (!nodes.length) return pasted;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  store.updateMany(pasted, (n) => ({ x: n.x + (at.x - minX), y: n.y + (at.y - minY) }));
  return pasted;
}

export function flip(store: DocStore, selection: string[], axis: 'h' | 'v'): void {
  store.updateMany(selection, (n) => (axis === 'h' ? { flipH: !n.flipH } : { flipV: !n.flipV }));
}
