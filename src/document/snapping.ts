import type { Doc, SceneNode } from './types';
import { isInFlow } from './types';

/**
 * Edge, centre and spacing snapping while dragging.
 *
 * Figma's precision comes from this more than from anything in the panel: you
 * drag near an alignment and it takes, then draws the line it snapped to. The
 * candidates are the siblings at the same level plus the parent's own box.
 *
 * Alignment is only half of it. The other half is spacing: a drag that lands
 * near an even arrangement takes that too, and both spaces are drawn with the
 * measurement on them. That is how a row is spaced by hand outside auto layout.
 */

/** A line the box lined up with: drawn across `axis`, spanning `from`…`to`. */
export interface AlignGuide {
  kind: 'align';
  axis: 'x' | 'y';
  /** world coordinate of the guide line */
  at: number;
  /** world-space extent to draw, so the line spans the nodes it relates */
  from: number;
  to: number;
}

/** A space that was measured: it runs along `axis`, and it carries a number. */
export interface GapGuide {
  kind: 'gap';
  axis: 'x' | 'y';
  /** the space itself, along `axis` */
  from: number;
  to: number;
  /** where across the other axis the bar is drawn */
  at: number;
}

export type SnapGuide = AlignGuide | GapGuide;

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

/** The box's near and far edge on one axis, and its middle on the other. */
const near = (box: Box, axis: 'x' | 'y') => (axis === 'x' ? box.x : box.y);
const far = (box: Box, axis: 'x' | 'y') => (axis === 'x' ? box.x + box.w : box.y + box.h);
const middle = (box: Box, axis: 'x' | 'y') =>
  axis === 'x' ? box.y + box.h / 2 : box.x + box.w / 2;

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

    // An alignment and a spacing on the same axis both set the same
    // coordinate, so only one of them can win; the alignment is the tighter
    // claim, and spacing gets the axis it leaves free.
    if (!best) {
      const spaced = spacingSnap(moving, candidates, axis, threshold);
      if (spaced) {
        if (axis === 'x') result.x = Math.round(moving.x + spaced.delta);
        else result.y = Math.round(moving.y + spaced.delta);
        result.guides.push(...spaced.guides);
      }
      continue;
    }
    if (axis === 'x') result.x = Math.round(moving.x + best.delta);
    else result.y = Math.round(moving.y + best.delta);

    // draw the guide across both boxes so the relationship is legible
    const cross = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'h' : 'w';
    const a = moving[cross];
    const b = best.other[cross];
    result.guides.push({
      kind: 'align',
      axis,
      at: best.at,
      from: Math.min(a, b),
      to: Math.max(a + moving[size], b + best.other[size]),
    });
  }

  return result;
}

/**
 * Figma's equal-spacing snap, on one axis.
 *
 * Two arrangements read as even, and both are worth taking. The box lands
 * *between* two others and the two spaces either side of it are made equal; or
 * it lands *beyond* a pair, and the space it opens is made to match the space
 * those two already hold — which is how a row gets built one layer at a time.
 *
 * Only boxes that overlap the moving one across the other axis count, or a
 * layer in a different row would be treated as a neighbour in this one.
 */
function spacingSnap(
  moving: Box,
  candidates: Box[],
  axis: 'x' | 'y',
  threshold: number,
): { delta: number; guides: GapGuide[] } | null {
  const cross = axis === 'x' ? 'y' : 'x';
  const inRow = candidates.filter(
    (c) => near(c, cross) < far(moving, cross) && far(c, cross) > near(moving, cross),
  );
  const before = inRow
    .filter((c) => far(c, axis) <= near(moving, axis))
    .sort((a, b) => far(b, axis) - far(a, axis));
  const after = inRow
    .filter((c) => near(c, axis) >= far(moving, axis))
    .sort((a, b) => near(a, axis) - near(b, axis));

  const at = middle(moving, axis);
  const bar = (from: number, to: number): GapGuide => ({ kind: 'gap', axis, from, to, at });

  if (before[0] && after[0]) {
    const left = near(moving, axis) - far(before[0], axis);
    const right = near(after[0], axis) - far(moving, axis);
    const delta = (right - left) / 2;
    if (Math.abs(delta) <= threshold) {
      return {
        delta,
        guides: [
          bar(far(before[0], axis), near(moving, axis) + delta),
          bar(far(moving, axis) + delta, near(after[0], axis)),
        ],
      };
    }
  }

  for (const [side, sign] of [
    [before, 1],
    [after, -1],
  ] as const) {
    if (!side[0] || !side[1]) continue;
    // the space those two already hold, and the one this drag is opening
    const reference = Math.abs(near(side[0], axis) - far(side[1], axis));
    const own = sign > 0 ? near(moving, axis) - far(side[0], axis) : near(side[0], axis) - far(moving, axis);
    const delta = (reference - own) * sign;
    if (Math.abs(delta) > threshold) continue;
    const ref = bar(
      Math.min(far(side[1], axis), near(side[0], axis)),
      Math.max(far(side[1], axis), near(side[0], axis)),
    );
    const made =
      sign > 0
        ? bar(far(side[0], axis), near(moving, axis) + delta)
        : bar(far(moving, axis) + delta, near(side[0], axis));
    return { delta, guides: [ref, made] };
  }

  return null;
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
