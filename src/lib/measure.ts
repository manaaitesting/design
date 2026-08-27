import type { Box } from '../document/store';

/**
 * Reads back where the browser actually put a frame's children.
 *
 * The canvas is real DOM, so layout is something the browser has already
 * resolved by the time anyone asks — the same reason the selection overlay
 * measures instead of recomputing. Anything that has to turn a computed layout
 * back into fixed coordinates (dropping auto layout, pulling a child out of the
 * flow) needs those numbers, and they only exist here.
 *
 * Sizes come back in world units, so the caller does not have to care what the
 * canvas is zoomed to.
 */
export function measureChildren(parentId: string, zoom: number): Record<string, Box> {
  const parent = document.querySelector<HTMLElement>(`[data-node-id="${parentId}"]`);
  if (!parent) return {};
  const origin = parent.getBoundingClientRect();
  const out: Record<string, Box> = {};

  for (const child of parent.children) {
    const id = (child as HTMLElement).dataset?.nodeId;
    if (!id) continue;
    const box = child.getBoundingClientRect();
    out[id] = {
      x: (box.left - origin.left) / zoom,
      y: (box.top - origin.top) / zoom,
      w: box.width / zoom,
      h: box.height / zoom,
    };
  }
  return out;
}
