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
 *
 * Two rules the other tools all share and this used to get wrong:
 *
 *  - a snap is drawn against *everything* it lined up with, not against the one
 *    box that happened to win the search. Three layers on a left edge are one
 *    line through all three, which is the whole reason the line is worth
 *    drawing — it says what the alignment is, not merely that there was one.
 *  - the guides are measured off where the box *landed*, not off where it was
 *    when the search ran, so the line touches the layer instead of trailing it.
 *
 * Everything here is in the parent's coordinates, because that is where a
 * node's x/y live. Callers that draw the guides have to lift them into world
 * coordinates first.
 */

/** Numbers this close are the same coordinate; snapping is not exact arithmetic. */
const EPSILON = 0.01;

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
  /**
   * Which axes actually took a snap.
   *
   * The caller needs this because a snap outranks the pixel grid: rounding a
   * snapped coordinate afterwards is what puts a layer half a pixel off the
   * line the guide has just promised it is on.
   */
  snapped: { x: boolean; y: boolean };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Set when the candidate is a line rather than a box — a ruler guide.
   *
   * A guide lines things up on its own axis and says nothing about the other
   * one. Without this it is a zero-sized box sitting at the drag's own starting
   * corner, which reads as an alignment the moment the gesture begins: a
   * vertical guide would pin the drag *vertically* for the first few pixels.
   */
  axis?: 'x' | 'y';
}

function edgesOf(box: Box, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [box.x, box.x + box.w / 2, box.x + box.w] : [box.y, box.y + box.h / 2, box.y + box.h];
}

/** The box's near and far edge on one axis, and its middle on the other. */
const near = (box: Box, axis: 'x' | 'y') => (axis === 'x' ? box.x : box.y);
const far = (box: Box, axis: 'x' | 'y') => (axis === 'x' ? box.x + box.w : box.y + box.h);
const middle = (box: Box, axis: 'x' | 'y') =>
  axis === 'x' ? box.y + box.h / 2 : box.x + box.w / 2;

/** The other axis, and the box field that measures across it. */
const other = (axis: 'x' | 'y') => (axis === 'x' ? 'y' : 'x') as 'x' | 'y';
const across = (axis: 'x' | 'y') => (axis === 'x' ? 'h' : 'w') as 'h' | 'w';

/**
 * Snaps a dragged box to nearby siblings.
 *
 * `threshold` is in world units, so callers divide their pixel tolerance by the
 * zoom — the snap should feel the same distance on screen at any magnification.
 *
 * The result is not rounded. A centre lands on a half pixel as often as not,
 * and rounding here would quietly undo the alignment the guide is drawing.
 */
export function snap(moving: Box, candidates: Box[], threshold: number): SnapResult {
  const placed: Box = { ...moving };
  // the coordinate each axis lined up with, so the guide can be drawn through
  // everything else on it; `hit` is the plainer question of whether anything
  // took at all, which spacing answers too
  const took: { x: number | null; y: number | null } = { x: null, y: null };
  const hit = { x: false, y: false };

  // Alignment first, on both axes, each against the box as it was picked up —
  // the two axes are independent, so neither should see the other's result.
  for (const axis of ['x', 'y'] as const) {
    let best: { delta: number; at: number } | null = null;
    for (const box of candidates) {
      if (box.axis && box.axis !== axis) continue;
      for (const target of edgesOf(box, axis)) {
        for (const edge of edgesOf(moving, axis)) {
          const delta = target - edge;
          if (Math.abs(delta) > threshold) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta) - EPSILON) best = { delta, at: target };
        }
      }
    }
    if (!best) continue;
    if (axis === 'x') placed.x += best.delta;
    else placed.y += best.delta;
    took[axis] = best.at;
    hit[axis] = true;
  }

  const guides: SnapGuide[] = [];

  // An alignment and a spacing on the same axis both set the same coordinate,
  // so only one of them can win; the alignment is the tighter claim, and
  // spacing gets whichever axis it leaves free.
  for (const axis of ['x', 'y'] as const) {
    if (took[axis] !== null) continue;
    const spaced = spacingSnap(placed, candidates, axis, threshold);
    if (!spaced) continue;
    if (axis === 'x') placed.x += spaced.delta;
    else placed.y += spaced.delta;
    hit[axis] = true;
    guides.push(...spaced.guides);
  }

  // Drawn last, off the settled box: a guide measured before the other axis
  // moved is a guide drawn where the layer no longer is.
  for (const axis of ['x', 'y'] as const) {
    const at = took[axis];
    if (at !== null) guides.push(alignGuide(placed, candidates, axis, at));
  }

  return { x: placed.x, y: placed.y, guides, snapped: hit };
}

/**
 * One line through everything that shares this alignment.
 *
 * Three cards on a left edge are one line through all three rather than a line
 * between the dragged one and whichever card the search happened to settle on.
 */
function alignGuide(box: Box, candidates: Box[], axis: 'x' | 'y', at: number): AlignGuide {
  const cross = other(axis);
  const size = across(axis);
  let from = box[cross];
  let to = box[cross] + box[size];
  for (const candidate of candidates) {
    if (candidate.axis && candidate.axis !== axis) continue;
    if (!edgesOf(candidate, axis).some((edge) => Math.abs(edge - at) < EPSILON)) continue;
    from = Math.min(from, candidate[cross]);
    to = Math.max(to, candidate[cross] + candidate[size]);
  }
  return { kind: 'align', axis, at, from, to };
}

/** The spaces between a row of boxes, left to right, skipping any overlap. */
function gapsAlong(row: Box[], axis: 'x' | 'y'): { from: number; to: number; size: number }[] {
  const sorted = [...row].sort((a, b) => near(a, axis) - near(b, axis));
  const gaps: { from: number; to: number; size: number }[] = [];
  if (!sorted.length) return gaps;
  // the running far edge, so a box swallowed by a wider one does not invent a
  // gap that is not there
  let reach = far(sorted[0], axis);
  for (let i = 1; i < sorted.length; i++) {
    const to = near(sorted[i], axis);
    if (to - reach > EPSILON) gaps.push({ from: reach, to, size: to - reach });
    reach = Math.max(reach, far(sorted[i], axis));
  }
  return gaps;
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
 *
 * When the space matches, every other space in that row of the same size is
 * measured too: the point of the feedback is the pattern, and one lonely bar
 * does not show that the row is even.
 */
function spacingSnap(
  moving: Box,
  candidates: Box[],
  axis: 'x' | 'y',
  threshold: number,
): { delta: number; guides: GapGuide[] } | null {
  const cross = other(axis);
  const inRow = candidates.filter(
    (c) => !c.axis && near(c, cross) < far(moving, cross) && far(c, cross) > near(moving, cross),
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
    // a box that overlaps a neighbour is not sitting in a gap, and centring it
    // in one it does not fit inside would be a snap nobody asked for
    if (Math.abs(delta) <= threshold && (left + right) / 2 > EPSILON) {
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
    // The space those two already hold, and the one this drag is opening.
    //
    // `side[0]` is the neighbour nearest the drag, so which of the pair comes
    // first along the axis depends on which side of the drag they are on — the
    // gap is between the later one's near edge and the earlier one's far edge
    // either way. Reading it in a fixed order measured across both boxes when
    // the pair sat to the right, and the snap simply never fired on that side.
    const reference =
      Math.max(near(side[0], axis), near(side[1], axis)) - Math.min(far(side[0], axis), far(side[1], axis));
    if (reference <= EPSILON) continue;
    const own = sign > 0 ? near(moving, axis) - far(side[0], axis) : near(side[0], axis) - far(moving, axis);
    const delta = (reference - own) * sign;
    if (Math.abs(delta) > threshold) continue;
    const made =
      sign > 0
        ? bar(far(side[0], axis), near(moving, axis) + delta)
        : bar(far(moving, axis) + delta, near(side[0], axis));
    // every space in the row this one now matches, the reference included
    const matching = gapsAlong(inRow, axis)
      .filter((gap) => Math.abs(gap.size - reference) < EPSILON)
      .map((gap) => bar(gap.from, gap.to));
    return { delta, guides: [...matching, made] };
  }

  return null;
}

/**
 * The candidate edge nearest `value` on one axis, for snapping a resize.
 *
 * A drag moves a whole box and can be snapped by shifting it; a resize moves one
 * edge, and the other three have to stay where they are — so this answers about
 * a single coordinate rather than about a box. `from`/`to` span everything that
 * shares the edge, the same way a move's guide does.
 */
export function nearestEdge(
  value: number,
  candidates: Box[],
  axis: 'x' | 'y',
  threshold: number,
): { at: number; from: number; to: number } | null {
  let best: { at: number; delta: number } | null = null;
  for (const box of candidates) {
    if (box.axis && box.axis !== axis) continue;
    for (const target of edgesOf(box, axis)) {
      const delta = Math.abs(target - value);
      if (delta > threshold) continue;
      if (!best || delta < best.delta - EPSILON) best = { at: target, delta };
    }
  }
  if (!best) return null;
  const cross = other(axis);
  const size = across(axis);
  let from = Infinity;
  let to = -Infinity;
  for (const box of candidates) {
    if (box.axis && box.axis !== axis) continue;
    if (!edgesOf(box, axis).some((edge) => Math.abs(edge - best!.at) < EPSILON)) continue;
    from = Math.min(from, box[cross]);
    to = Math.max(to, box[cross] + box[size]);
  }
  return { at: best.at, from, to };
}

/** Boxes worth snapping to: siblings at the same level, plus the parent's frame. */
export function snapCandidates(doc: Doc, movingIds: string[], parentId: string): Box[] {
  const parent = doc[parentId];
  if (!parent) return [];

  const boxes: Box[] = (parent.children ?? [])
    .filter((id) => !movingIds.includes(id))
    .map((id) => doc[id])
    .filter((n): n is SceneNode => !!n && n.visible && !isInFlow(n, doc))
    .map(nodeBox);

  // the container itself, so you can centre against it
  if (parent.type !== 'page') boxes.push({ x: 0, y: 0, w: parent.w, h: parent.h });
  return boxes;
}

/**
 * A node's box as the canvas sees it.
 *
 * A turned layer is snapped against the box it actually occupies, not against
 * the unturned one — that box is drawn nowhere, and lining a layer up with it
 * lines it up with nothing.
 */
export function nodeBox(node: SceneNode): Box {
  const box = { x: node.x, y: node.y, w: node.w, h: node.h };
  if (!node.rotation) return box;
  const rad = (node.rotation * Math.PI) / 180;
  const w = Math.abs(node.w * Math.cos(rad)) + Math.abs(node.h * Math.sin(rad));
  const h = Math.abs(node.w * Math.sin(rad)) + Math.abs(node.h * Math.cos(rad));
  return { x: node.x + (node.w - w) / 2, y: node.y + (node.h - h) / 2, w, h };
}

/**
 * Lifts guides out of the parent's coordinates and into the world's.
 *
 * The snap runs where the node's x/y live, which is inside its parent; the
 * overlay draws in world coordinates. Without this step every guide for a layer
 * inside a frame is drawn one frame-origin away from the layer it belongs to.
 */
export function inWorld(guides: SnapGuide[], origin: { x: number; y: number }): SnapGuide[] {
  if (!origin.x && !origin.y) return guides;
  return guides.map((guide) => {
    // a guide's `at` is on its own axis and its span is across the other one;
    // a gap's are the other way round, because a gap *is* the span
    const along = guide.axis === 'x' ? origin.x : origin.y;
    const cross = guide.axis === 'x' ? origin.y : origin.x;
    return guide.kind === 'align'
      ? { ...guide, at: guide.at + along, from: guide.from + cross, to: guide.to + cross }
      : { ...guide, from: guide.from + along, to: guide.to + along, at: guide.at + cross };
  });
}
