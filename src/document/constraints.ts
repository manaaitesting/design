import type { Constraint, Doc, SceneNode } from './types';
import { isInFlow } from './types';

/**
 * Applies Figma's constraints when a frame resizes.
 *
 * Without these, a child pinned to the right edge drifts as soon as you widen
 * its frame — which is what makes a design feel like it falls apart under
 * resizing. Children in a flex flow are skipped: their parent owns them.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function along(
  constraint: Constraint,
  start: number,
  size: number,
  oldParent: number,
  newParent: number,
): { start: number; size: number } {
  const endGap = oldParent - (start + size);
  const scale = oldParent === 0 ? 1 : newParent / oldParent;

  switch (constraint) {
    case 'end':
      return { start: newParent - endGap - size, size };
    case 'center':
      return { start: Math.round((newParent - size) / 2 + (start - (oldParent - size) / 2)), size };
    case 'stretch':
      // both edges pinned, so the child absorbs the difference
      return { start, size: Math.max(1, newParent - endGap - start) };
    case 'scale':
      return { start: Math.round(start * scale), size: Math.max(1, Math.round(size * scale)) };
    default:
      return { start, size };
  }
}

/** New boxes for every constrained child of a frame that changed size. */
export function applyConstraints(
  doc: Doc,
  parentId: string,
  from: { w: number; h: number },
  to: { w: number; h: number },
): Map<string, Partial<SceneNode>> {
  const out = new Map<string, Partial<SceneNode>>();
  const parent = doc[parentId];
  if (!parent || (from.w === to.w && from.h === to.h)) return out;

  for (const childId of parent.children) {
    const child = doc[childId];
    if (!child || isInFlow(child, doc)) continue;

    const spec = child.constraints ?? { h: 'start' as const, v: 'start' as const };
    const horizontal = along(spec.h, child.x, child.w, from.w, to.w);
    const vertical = along(spec.v, child.y, child.h, from.h, to.h);

    const patch: Partial<SceneNode> = {};
    if (horizontal.start !== child.x) patch.x = Math.round(horizontal.start);
    if (horizontal.size !== child.w) {
      patch.w = Math.round(horizontal.size);
      patch.wMode = 'fixed';
    }
    if (vertical.start !== child.y) patch.y = Math.round(vertical.start);
    if (vertical.size !== child.h) {
      patch.h = Math.round(vertical.size);
      patch.hMode = 'fixed';
    }
    if (Object.keys(patch).length) out.set(childId, patch);
  }
  return out;
}
