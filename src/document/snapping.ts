import type { Doc, SceneNode } from './types';
import { isInFlow } from './types';

/**
 * Edge and centre snapping while dragging.
 *
 * Figma's precision comes from this more than from anything in the panel: you
 * drag near an alignment and it takes, then draws the line it snapped to. The
 * candidates are the siblings at the same level plus the parent's own box.
 */

export interface SnapGuide {
  axis: 'x' | 'y';
  /** world coordinate of the guide line */
  at: number;
  /** world-space extent to draw, so the line spans the nodes it relates */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function edgesOf(box: Box, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [box.x, box.x + box.w / 2, box.x + box.w] : [box.y, box.y + box.h / 2, box.y + box.h];
}

/**
 * Snaps a dragged box to nearby siblings.
 *
 * `threshold` is in world units, so callers divide their pixel tolerance by the
 * zoom — the snap should feel the same distance on screen at any magnification.
 */
export function snap(
  moving: Box,
  candidates: Box[],
  threshold: number,
): SnapResult {
  const result: SnapResult = { x: moving.x, y: moving.y, guides: [] };

  for (const axis of ['x', 'y'] as const) {
    const movingEdges = edgesOf(moving, axis);
    let best: { delta: number; at: number; other: Box } | null = null;

    for (const other of candidates) {
      for (const target of edgesOf(other, axis)) {
        for (const edge of movingEdges) {
          const delta = target - edge;
          if (Math.abs(delta) > threshold) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: target, other };
        }
      }
    }

    if (!best) continue;
    if (axis === 'x') result.x = Math.round(moving.x + best.delta);
    else result.y = Math.round(moving.y + best.delta);

    // draw the guide across both boxes so the relationship is legible
    const cross = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'h' : 'w';
    const a = moving[cross];
    const b = best.other[cross];
    result.guides.push({
      axis,
      at: best.at,
      from: Math.min(a, b),
      to: Math.max(a + moving[size], b + best.other[size]),
    });
  }

  return result;
}

/**
 * The candidate edge nearest `value` on one axis, for snapping a resize.
 *
 * A drag moves a whole box and can be snapped by shifting it; a resize moves one
 * edge, and the other three have to stay where they are — so this answers about
 * a single coordinate rather than about a box.
 */
export function nearestEdge(
  value: number,
  candidates: Box[],
  axis: 'x' | 'y',
  threshold: number,
): { at: number; other: Box } | null {
  let best: { at: number; other: Box; delta: number } | null = null;
  for (const other of candidates) {
    for (const target of edgesOf(other, axis)) {
      const delta = Math.abs(target - value);
      if (delta > threshold) continue;
      if (!best || delta < best.delta) best = { at: target, other, delta };
    }
  }
  return best ? { at: best.at, other: best.other } : null;
}

/** Boxes worth snapping to: siblings at the same level, plus the parent's frame. */
export function snapCandidates(doc: Doc, movingIds: string[], parentId: string): Box[] {
  const parent = doc[parentId];
  if (!parent) return [];

  const boxes: Box[] = (parent.children ?? [])
    .filter((id) => !movingIds.includes(id))
    .map((id) => doc[id])
    .filter((n): n is SceneNode => !!n && n.visible && !isInFlow(n, doc))
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));

  // the container itself, so you can centre against it
  if (parent.type !== 'page') boxes.push({ x: 0, y: 0, w: parent.w, h: parent.h });
  return boxes;
}
