'use client';

import { nodeStyle, styleToCss } from '../document/css';
import { applyToRange, plainText, runsOf, styleOfRange } from '../document/text';
import type { Doc, FontSpec, SceneNode } from '../document/types';
import { DEFAULT_FONT } from '../document/defaults';
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
  'fills',
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
  'effects',
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
export function cssFor(
  rootId: string,
  doc: Doc,
  deep: boolean,
  /** token ids to names, so a bound field copies out as its variable */
  varNames: Record<string, string> = {},
): string {
  const rules: string[] = [];
  const visit = (id: string) => {
    const node = doc[id];
    if (!node) return;
    rules.push(`.${cssClass(node)} {\n${styleToCss(nodeStyle(node, doc, varNames))}\n}`);
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

/**
 * Figma's ⇧X: the fill colour and the stroke colour change places.
 *
 * The layer's paint may be a stack rather than one colour, and only the topmost
 * visible solid in it has a colour a stroke can wear — so that is the one that
 * travels, and it is put back into the same slot it came from. A layer with no
 * stroke gains a one-pixel one in the colour its fill had, which is what Figma
 * does and is the whole point of the key: it is how you outline a filled shape.
 */
export function swapFillAndStroke(store: DocStore, ids: string[]): boolean {
  const doc = store.getSnapshot();
  const swappable = ids.filter((id) => {
    const n = doc[id];
    return !!n && (n.fill !== null || !!solidIndex(n) || !!n.border);
  });
  if (!swappable.length) return false;

  store.updateMany(swappable, (n) => {
    const index = solidIndex(n);
    const fillColor = index === null ? n.fill : n.fills![index].value;
    const strokeColor = n.border?.color ?? null;

    const patch: Partial<SceneNode> = {};
    if (index === null) patch.fill = strokeColor;
    else patch.fills = n.fills!.map((p, i) => (i === index ? { ...p, value: strokeColor ?? 'transparent' } : p));

    patch.border = fillColor
      ? { ...(n.border ?? DEFAULT_STROKE), color: fillColor }
      : null;
    return patch;
  });
  store.commit();
  return true;
}

/** The paint a stroke can take its colour from: the top visible solid. */
function solidIndex(node: SceneNode): number | null {
  if (!node.fills?.length) return null;
  for (let i = node.fills.length - 1; i >= 0; i--) {
    const paint = node.fills[i];
    if (paint.visible && paint.value.startsWith('#')) return i;
  }
  return null;
}

/** What a layer with no stroke gets when a fill colour arrives on it. */
const DEFAULT_STROKE = { width: 1, color: '#000000', style: 'solid', position: 'inside' } as const;

/**
 * Figma's text shortcuts, which act on the layer rather than on a run.
 *
 * ⌥⌘L / ⌥⌘T / ⌥⌘R / ⌥⌘J set the alignment and ⇧⌘< / ⇧⌘> step the size, and both
 * are reached from two places — the canvas with a text layer selected, and the
 * text editor with the caret inside one. They live here so there is one mapping
 * rather than two that can drift apart.
 */
export const TEXT_ALIGN_KEYS: Record<string, FontSpec['align']> = {
  KeyL: 'left',
  KeyT: 'center',
  KeyR: 'right',
  KeyJ: 'justify',
};

/** The text layers in a selection — the rest of it has no type to set. */
function textNodes(store: DocStore, ids: string[]): string[] {
  const doc = store.getSnapshot();
  return ids.filter((id) => doc[id]?.type === 'text');
}

export function alignText(store: DocStore, ids: string[], align: FontSpec['align']): boolean {
  const texts = textNodes(store, ids);
  if (!texts.length) return false;
  store.updateMany(texts, (n) => ({ font: { ...(n.font ?? DEFAULT_FONT), align } }));
  store.commit();
  return true;
}

/**
 * Figma's ⌘B / ⌘I / ⌘U / ⇧⌘X, with the layer selected rather than opened.
 *
 * In Figma you do not have to enter a text layer to embolden it — the marks act
 * on the whole layer from the canvas, and on the selected characters once you
 * are inside. This is the outer half; `TextEditor` has the inner one, and both
 * go through `applyToRange` so a mark set from the canvas is the same mark the
 * editor would have set.
 *
 * The layer is on when *all* of it is on, which is what makes the key a toggle:
 * a layer with one bold word goes fully bold before it goes back to plain.
 */
export function toggleMark(
  store: DocStore,
  ids: string[],
  mark: 'bold' | 'italic' | 'underline' | 'strike',
): boolean {
  const texts = textNodes(store, ids);
  if (!texts.length) return false;
  const doc = store.getSnapshot();

  const every = texts.every((id) => {
    const runs = runsOf(doc[id]);
    return !!styleOfRange(runs, 0, plainText(runs).length)[mark];
  });

  store.updateMany(texts, (n) => {
    const runs = runsOf(n);
    return { runs: applyToRange(runs, 0, plainText(runs).length, { [mark]: every ? undefined : true }) };
  });
  store.commit();
  return true;
}

/** One point at a time, as Figma steps it, and never down through zero. */
export function stepFontSize(store: DocStore, ids: string[], by: number): boolean {
  const texts = textNodes(store, ids);
  if (!texts.length) return false;
  store.updateMany(texts, (n) => {
    const font = n.font ?? DEFAULT_FONT;
    return { font: { ...font, size: Math.max(1, font.size + by) } };
  });
  store.commit();
  return true;
}
