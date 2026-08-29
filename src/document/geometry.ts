/**
 * Path geometry.
 *
 * Everything that draws a curve — the pen, the shape tools, boolean groups,
 * masks and the exporter — builds its `d` here, so a path cannot render one way
 * on the canvas and another in the export. Coordinates are always local to the
 * node's own box: 0,0 is its top-left corner and `w`/`h` its size, which is what
 * lets a vector be resized by scaling numbers rather than re-fitting curves.
 */

import type { SceneNode, VectorPath } from './types';
import type { Point, Region, Ring } from './clipper';

/**
 * One point on a path.
 *
 * `in` and `out` are the cubic control points, stored as offsets from the
 * anchor rather than absolutes: a dragged anchor carries its handles with it,
 * and mirroring a smooth point is `out = -in` instead of arithmetic against a
 * position that has already moved.
 */
export interface Anchor {
  x: number;
  y: number;
  in?: [number, number] | null;
  out?: [number, number] | null;
  /**
   * Corner radius at this point — Figma's per-point rounding, the `⌐` field in
   * the Vector panel. It only applies where a corner meets two straight
   * segments, because rounding a join that is already a curve has no meaning.
   */
  r?: number;
  /**
   * Stroke width at this point — Figma's variable width. Absent everywhere is
   * the ordinary case, and the stroke is drawn by the stroke settings alone.
   */
  width?: number;
  /**
   * How the two handles are tied together, the three buttons in Figma's Vector
   * panel. Absent means "work it out from the handles", which is what a path
   * that arrived from an import or an older document wants.
   */
  mirror?: HandleMirror;
}

/** No mirroring, mirror the angle only, or mirror angle and length together. */
export type HandleMirror = 'none' | 'angle' | 'full';

/** True when neither side of the anchor is curved — a hard corner. */
export function isCorner(anchor: Anchor): boolean {
  return !anchor.in && !anchor.out;
}

/**
 * The anchors of a vector, whatever shape the document stores them in.
 *
 * Documents written before handles existed hold a flat `[x, y][]`; they are
 * read as corner anchors, so an old path opens as exactly the polyline it was
 * and gains handles the moment someone drags one.
 */
export function anchorsOf(node: Pick<SceneNode, 'anchors' | 'points'>): Anchor[] {
  if (node.anchors?.length) return node.anchors;
  return (node.points ?? []).map(([x, y]) => ({ x, y }));
}

export function cloneAnchor(anchor: Anchor): Anchor {
  return {
    x: anchor.x,
    y: anchor.y,
    in: anchor.in ? [anchor.in[0], anchor.in[1]] : null,
    out: anchor.out ? [anchor.out[0], anchor.out[1]] : null,
    ...(anchor.r ? { r: anchor.r } : null),
    ...(anchor.width !== undefined ? { width: anchor.width } : null),
    ...(anchor.mirror ? { mirror: anchor.mirror } : null),
  };
}

/**
 * Which of the three mirror states an anchor is in.
 *
 * Stated wins; otherwise it is read off the handles, because that is the only
 * honest answer for a point nobody has pressed a button on: equal lengths were
 * mirrored, unequal ones were not.
 */
export function mirrorOf(anchor: Anchor): HandleMirror {
  if (anchor.mirror) return anchor.mirror;
  if (!anchor.in || !anchor.out) return 'none';
  const a = Math.hypot(anchor.in[0], anchor.in[1]);
  const b = Math.hypot(anchor.out[0], anchor.out[1]);
  const opposed = anchor.in[0] * anchor.out[0] + anchor.in[1] * anchor.out[1] < 0;
  if (!opposed) return 'none';
  return Math.abs(a - b) < 0.01 ? 'full' : 'angle';
}

/** Conforms an anchor's handles to a mirror state, the way the buttons do. */
export function applyMirror(anchor: Anchor, mode: HandleMirror): Anchor {
  const next = cloneAnchor(anchor);
  next.mirror = mode;
  if (mode === 'none') return next;
  // the leading handle is whichever one exists; `out` wins when both do
  const lead = (next.out ?? next.in) as Vec | null | undefined;
  const side = next.out ? 'out' : 'in';
  const opposite = side === 'out' ? 'in' : 'out';
  if (!lead) return next;
  const reach = Math.hypot(lead[0], lead[1]);
  if (!reach) return next;
  const existing = next[opposite] as Vec | null | undefined;
  const length = mode === 'full' ? reach : existing ? Math.hypot(existing[0], existing[1]) : reach;
  next[opposite] = [(-lead[0] / reach) * length, (-lead[1] / reach) * length];
  return next;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Catmull-Rom handles for an anchor that has none.
 *
 * This is what the `smooth` slider does: it rounds the joins of a path drawn as
 * straight segments without asking the author to place control points. An
 * anchor that carries its own handles ignores it — an explicit curve always
 * wins over a derived one.
 */
function derived(
  anchors: Anchor[],
  index: number,
  closed: boolean,
  tension: number,
): { in: [number, number]; out: [number, number] } {
  const count = anchors.length;
  const at = (i: number): Anchor => {
    if (closed) return anchors[(i + count) % count];
    return anchors[Math.max(0, Math.min(count - 1, i))];
  };
  const prev = at(index - 1);
  const next = at(index + 1);
  const dx = (next.x - prev.x) * tension;
  const dy = (next.y - prev.y) * tension;
  return { in: [-dx, -dy], out: [dx, dy] };
}

/**
 * The anchors a path is actually drawn through.
 *
 * The `smooth` slider is a *derived* curve: it fills in handles for the corners
 * that have none and leaves every explicit handle alone. Point editing resolves
 * through here before it touches a handle, so a segment that looked curved on
 * the canvas is the segment you bend — the slider gets baked into the two
 * points you edit rather than fighting them.
 */
export function resolveSmoothing(anchors: Anchor[], closed: boolean, smooth = 0): Anchor[] {
  const tension = Math.min(Math.max(smooth, 0), 1) / 6;
  if (!tension || anchors.length < 2) return anchors;
  return anchors.map((anchor, index) => {
    if (!isCorner(anchor)) return anchor;
    const handles = derived(anchors, index, closed, tension);
    return { ...anchor, in: handles.in, out: handles.out };
  });
}

/**
 * Builds the `d` attribute for a run of anchors.
 *
 * A segment is a straight line only when both of the control points it sits
 * between are absent — the moment either end is curved it becomes a cubic, so
 * one smooth anchor in a polyline bends only the two segments that touch it.
 */
export function pathFromAnchors(anchors: Anchor[], closed: boolean, smooth = 0): string {
  if (anchors.length === 0) return '';
  if (anchors.length === 1) return `M ${round(anchors[0].x)} ${round(anchors[0].y)}`;

  const resolved = resolveSmoothing(anchors, closed, smooth);

  const count = resolved.length;
  const corner = (i: number) => cornerCut(resolved, i, closed);

  // A rounded point is drawn as two moves: stop short of it, then arc across to
  // where the next segment begins. `cornerCut` works out both, and returns null
  // for every point that is not a rounded corner — which is nearly all of them.
  const start = corner(0);
  let d = start
    ? `M ${round(start.after[0])} ${round(start.after[1])}`
    : `M ${round(resolved[0].x)} ${round(resolved[0].y)}`;

  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const from = resolved[i];
    const to = resolved[(i + 1) % count];
    const cut = corner((i + 1) % count);
    const end: [number, number] = cut ? cut.before : [to.x, to.y];

    if (!from.out && !to.in) {
      d += ` L ${round(end[0])} ${round(end[1])}`;
    } else {
      const c1 = [from.x + (from.out?.[0] ?? 0), from.y + (from.out?.[1] ?? 0)];
      const c2 = [to.x + (to.in?.[0] ?? 0), to.y + (to.in?.[1] ?? 0)];
      d += ` C ${round(c1[0])} ${round(c1[1])}, ${round(c2[0])} ${round(c2[1])}, ${round(end[0])} ${round(end[1])}`;
    }
    if (cut) {
      d += ` A ${round(cut.radius)} ${round(cut.radius)} 0 0 ${cut.sweep} ${round(cut.after[0])} ${round(cut.after[1])}`;
    }
  }
  return closed ? `${d} Z` : d;
}

/**
 * Where a rounded corner starts, ends, and which way it turns.
 *
 * Figma rounds a point by trimming both segments back and fitting a circle in
 * the gap, and the radius is clamped to whatever the shorter of the two
 * segments can actually give — asking for 40 on a 10px corner rounds it as far
 * as it goes rather than turning the shape inside out.
 */
function cornerCut(
  anchors: Anchor[],
  index: number,
  closed: boolean,
): {
  before: [number, number];
  after: [number, number];
  center: [number, number];
  radius: number;
  sweep: 0 | 1;
} | null {
  const anchor = anchors[index];
  const count = anchors.length;
  if (!anchor.r || !isCorner(anchor)) return null;
  if (!closed && (index === 0 || index === count - 1)) return null;

  const prev = anchors[(index - 1 + count) % count];
  const next = anchors[(index + 1) % count];
  // only a join between two straight runs can be rounded this way
  if (prev.out || next.in) return null;

  const toPrev = [prev.x - anchor.x, prev.y - anchor.y];
  const toNext = [next.x - anchor.x, next.y - anchor.y];
  const lenPrev = Math.hypot(toPrev[0], toPrev[1]);
  const lenNext = Math.hypot(toNext[0], toNext[1]);
  if (!lenPrev || !lenNext) return null;

  const ux = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
  const vx = [toNext[0] / lenNext, toNext[1] / lenNext];
  const cos = Math.max(-0.9999, Math.min(0.9999, ux[0] * vx[0] + ux[1] * vx[1]));
  const half = Math.acos(cos) / 2;
  const tan = Math.tan(half);
  if (!tan || !Number.isFinite(tan)) return null;

  // the trim never eats more than half of either neighbouring segment
  const limit = Math.min(lenPrev, lenNext) / 2;
  const trim = Math.min(anchor.r / tan, limit);
  const radius = trim * tan;
  if (radius < 0.01) return null;

  // the centre sits along the bisector, one hypotenuse out from the corner
  const bisector = [ux[0] + vx[0], ux[1] + vx[1]];
  const span = Math.hypot(bisector[0], bisector[1]);
  if (!span) return null;
  const reach = radius / Math.sin(half);

  const cross = ux[0] * vx[1] - ux[1] * vx[0];
  return {
    before: [anchor.x + ux[0] * trim, anchor.y + ux[1] * trim],
    after: [anchor.x + vx[0] * trim, anchor.y + vx[1] * trim],
    center: [anchor.x + (bisector[0] / span) * reach, anchor.y + (bisector[1] / span) * reach],
    radius,
    sweep: cross > 0 ? 0 : 1,
  };
}

/** Legacy entry point: a flat point list, drawn as corner anchors. */
export function pathFromPoints(points: [number, number][], closed: boolean, smooth = 0): string {
  return pathFromAnchors(
    points.map(([x, y]) => ({ x, y })),
    closed,
    smooth,
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The box a path actually occupies, control points included.
 *
 * Handles are counted rather than solved for: the convex hull of a cubic
 * contains the curve, so a box built from the hull never crops the shape. It
 * can be a little generous on a strongly curved segment, which is the trade
 * every editor makes here — a clipped path is a bug, a roomy box is not.
 */
export function anchorBounds(anchors: Anchor[]): Bounds | null {
  if (!anchors.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const anchor of anchors) {
    take(anchor.x, anchor.y);
    if (anchor.in) take(anchor.x + anchor.in[0], anchor.y + anchor.in[1]);
    if (anchor.out) take(anchor.x + anchor.out[0], anchor.y + anchor.out[1]);
  }
  return { minX, minY, maxX, maxY };
}

/** Scales anchors and their handles from one box to another. */
export function scaleAnchors(anchors: Anchor[], sx: number, sy: number): Anchor[] {
  return anchors.map((anchor) => ({
    x: anchor.x * sx,
    y: anchor.y * sy,
    in: anchor.in ? ([anchor.in[0] * sx, anchor.in[1] * sy] as [number, number]) : null,
    out: anchor.out ? ([anchor.out[0] * sx, anchor.out[1] * sy] as [number, number]) : null,
  }));
}

// ── Parametric shapes ─────────────────────────────────────────────────────
//
// A polygon, a star and an arc are not point lists in Figma — they are a shape
// plus a couple of numbers, so that changing the count re-draws them instead of
// asking you to move every vertex. They stay parametric here for the same
// reason, and only become anchors when someone asks for that explicitly.

const TAU = Math.PI * 2;

/** A regular polygon inscribed in the box, first vertex at the top. */
export function polygonPath(w: number, h: number, sides: number): string {
  const count = Math.max(3, Math.round(sides));
  const rx = w / 2;
  const ry = h / 2;
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i / count) * TAU;
    points.push(`${round(rx + rx * Math.cos(angle))} ${round(ry + ry * Math.sin(angle))}`);
  }
  return `M ${points.join(' L ')} Z`;
}

/** A star: `points` outer vertices, alternating with inner ones at `ratio`. */
export function starPath(w: number, h: number, points: number, ratio: number): string {
  const count = Math.max(3, Math.round(points));
  const inner = Math.min(Math.max(ratio, 0.01), 1);
  const rx = w / 2;
  const ry = h / 2;
  const out: string[] = [];
  for (let i = 0; i < count * 2; i++) {
    const angle = -Math.PI / 2 + (i / (count * 2)) * TAU;
    const scale = i % 2 === 0 ? 1 : inner;
    out.push(`${round(rx + rx * scale * Math.cos(angle))} ${round(ry + ry * scale * Math.sin(angle))}`);
  }
  return `M ${out.join(' L ')} Z`;
}

/** Ellipse arc/donut. Angles are turns (0–1) clockwise from twelve o'clock. */
export function ellipsePath(
  w: number,
  h: number,
  start = 0,
  end = 1,
  innerRatio = 0,
): string {
  const rx = w / 2;
  const ry = h / 2;
  const inner = Math.min(Math.max(innerRatio, 0), 0.99);
  const sweep = end - start;
  const full = Math.abs(sweep) >= 1 - 1e-6;

  const at = (turn: number, scale: number) => {
    const angle = -Math.PI / 2 + turn * TAU;
    return [round(rx + rx * scale * Math.cos(angle)), round(ry + ry * scale * Math.sin(angle))];
  };

  if (full) {
    // A full ring cannot be one arc — SVG needs two half sweeps, and the hole
    // is a second ring wound the other way so `evenodd` punches it out.
    const ring = (scale: number, reverse: boolean) => {
      const [ax, ay] = at(0, scale);
      const [bx, by] = at(0.5, scale);
      const flag = reverse ? 0 : 1;
      return `M ${ax} ${ay} A ${round(rx * scale)} ${round(ry * scale)} 0 0 ${flag} ${bx} ${by} A ${round(rx * scale)} ${round(ry * scale)} 0 0 ${flag} ${ax} ${ay} Z`;
    };
    return inner ? `${ring(1, false)} ${ring(inner, true)}` : ring(1, false);
  }

  const large = Math.abs(sweep) > 0.5 ? 1 : 0;
  const dir = sweep >= 0 ? 1 : 0;
  const [sx, sy] = at(start, 1);
  const [ex, ey] = at(end, 1);

  if (!inner) {
    // a pie slice: out to the rim, round, and back to the centre
    return `M ${round(rx)} ${round(ry)} L ${sx} ${sy} A ${round(rx)} ${round(ry)} 0 ${large} ${dir} ${ex} ${ey} Z`;
  }
  const [isx, isy] = at(start, inner);
  const [iex, iey] = at(end, inner);
  return (
    `M ${sx} ${sy} A ${round(rx)} ${round(ry)} 0 ${large} ${dir} ${ex} ${ey} ` +
    `L ${iex} ${iey} A ${round(rx * inner)} ${round(ry * inner)} 0 ${large} ${dir ? 0 : 1} ${isx} ${isy} Z`
  );
}

/** A rounded rectangle, as a path — what a mask and a boolean need. */
export function rectPath(w: number, h: number, radii: [number, number, number, number]): string {
  const limit = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.min(Math.max(r, 0), limit));
  return (
    `M ${round(tl)} 0 L ${round(w - tr)} 0 A ${round(tr)} ${round(tr)} 0 0 1 ${round(w)} ${round(tr)} ` +
    `L ${round(w)} ${round(h - br)} A ${round(br)} ${round(br)} 0 0 1 ${round(w - br)} ${round(h)} ` +
    `L ${round(bl)} ${round(h)} A ${round(bl)} ${round(bl)} 0 0 1 0 ${round(h - bl)} ` +
    `L 0 ${round(tl)} A ${round(tl)} ${round(tl)} 0 0 1 ${round(tl)} 0 Z`
  );
}

/** A straight line across the box — the line tool's whole geometry. */
export function linePath(w: number, h: number): string {
  return `M 0 0 L ${round(w)} ${round(h)}`;
}

/** A line with a head, sized from the stroke so it stays in proportion. */
export function arrowPath(w: number, h: number, weight: number): string {
  const length = Math.hypot(w, h) || 1;
  const head = Math.min(Math.max(weight * 3.2, 6), length * 0.4);
  const ux = w / length;
  const uy = h / length;
  const tipX = w;
  const tipY = h;
  const baseX = tipX - ux * head;
  const baseY = tipY - uy * head;
  // the barbs sit on the normal, half a head-width to each side
  const nx = -uy * head * 0.42;
  const ny = ux * head * 0.42;
  return (
    `M 0 0 L ${round(baseX)} ${round(baseY)} ` +
    `M ${round(baseX + nx)} ${round(baseY + ny)} L ${round(tipX)} ${round(tipY)} L ${round(baseX - nx)} ${round(baseY - ny)}`
  );
}

/** The per-corner radii of a node, as four numbers. */
export function radiiOf(node: Pick<SceneNode, 'radius' | 'radii'>): [number, number, number, number] {
  if (node.radii) return node.radii;
  const r = node.radius ?? 0;
  return [r, r, r, r];
}

/**
 * The path a node draws, in its own coordinate space.
 *
 * Returns null for the types that are boxes rather than outlines — a frame or
 * an image is painted by CSS, and asking it for a path would mean inventing
 * one. Callers that need geometry for every type (masks, booleans) fall back to
 * the node's rounded box.
 */
export function shapePath(node: SceneNode): string | null {
  const w = Math.max(node.w, 0);
  const h = Math.max(node.h, 0);
  switch (node.type) {
    case 'vector':
      return pathFromSubpaths(subpathsOf(node), node.smooth ?? 0);
    case 'polygon':
      return polygonPath(w, h, node.sides ?? 3);
    case 'star':
      return starPath(w, h, node.sides ?? 5, node.innerRatio ?? 0.4);
    case 'line':
      return linePath(w, h);
    case 'arrow':
      return arrowPath(w, h, node.border?.width ?? 2);
    case 'ellipse':
      return ellipsePath(w, h, node.arcStart ?? 0, node.arcEnd ?? 1, node.innerRadius ?? 0);
    default:
      return null;
  }
}

/** Every node's geometry, boxes included — what a mask or a boolean clips with. */
export function outlinePath(node: SceneNode): string {
  return shapePath(node) ?? rectPath(Math.max(node.w, 0), Math.max(node.h, 0), radiiOf(node));
}

/** True when this type draws through an SVG path rather than a styled box. */
export function isPathType(type: SceneNode['type']): boolean {
  return (
    type === 'vector' || type === 'polygon' || type === 'star' || type === 'line' || type === 'arrow'
  );
}

/**
 * True when ⏎ or a double click opens this type's points.
 *
 * Exactly the set `outlineShape` can convert, because opening a shape's points
 * is a promise that moving one will work — a frame or an image is a box painted
 * by CSS and has no outline to offer.
 */
export function canEditPoints(type: SceneNode['type']): boolean {
  return isPathType(type) || type === 'rect' || type === 'ellipse';
}

/** True when the node's own fill is painted by a path, not by CSS `background`. */
export function paintsWithPath(node: SceneNode): boolean {
  if (isPathType(node.type)) return true;
  // an ellipse only needs a path once it stops being a plain ellipse
  return (
    node.type === 'ellipse' &&
    ((node.arcStart ?? 0) !== 0 || (node.arcEnd ?? 1) !== 1 || (node.innerRadius ?? 0) !== 0)
  );
}

/** An open path has no inside, so the fill controls have nothing to paint. */
export function isClosedShape(node: SceneNode): boolean {
  if (node.type === 'vector') {
    return node.paths?.length ? node.paths.some((sub) => sub.closed) : !!node.closed;
  }
  return node.type !== 'line' && node.type !== 'arrow';
}

// ── Flattening ────────────────────────────────────────────────────────────

/** Samples a cubic into line segments — the input every boolean op works on. */
function sampleCubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  steps: number,
  out: [number, number][],
): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/**
 * Turns anchors into a polygon.
 *
 * Curve resolution scales with the size of the path so a small icon does not
 * carry a thousand points and a large one does not go faceted.
 */
export function flattenAnchors(anchors: Anchor[], closed: boolean, smooth = 0): [number, number][] {
  if (anchors.length < 2) return anchors.map((a) => [a.x, a.y] as [number, number]);
  const resolved = resolveSmoothing(anchors, closed, smooth);

  const count = resolved.length;
  const corner = (i: number) => cornerCut(resolved, i, closed);
  const start = corner(0);
  const out: [number, number][] = [start ? start.after : [resolved[0].x, resolved[0].y]];

  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const from = resolved[i];
    const to = resolved[(i + 1) % count];
    // a rounded corner only ever sits between two straight runs, so a cubic
    // segment never has a trimmed end — the two cases cannot overlap
    const cut = corner((i + 1) % count);
    const end: [number, number] = cut ? cut.before : [to.x, to.y];

    if (!from.out && !to.in) {
      out.push(end);
    } else {
      const span = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.min(64, Math.max(6, Math.ceil(span / 4)));
      sampleCubic(
        [from.x, from.y],
        [from.x + (from.out?.[0] ?? 0), from.y + (from.out?.[1] ?? 0)],
        [to.x + (to.in?.[0] ?? 0), to.y + (to.in?.[1] ?? 0)],
        [to.x, to.y],
        steps,
        out,
      );
    }
    if (cut) sampleArc(cut, out);
  }
  if (closed && out.length > 1) out.pop();
  return out;
}

/** Walks a rounded corner as line segments — what a boolean can work with. */
function sampleArc(
  cut: { before: [number, number]; after: [number, number]; center: [number, number]; radius: number },
  out: [number, number][],
): void {
  const [cx, cy] = cut.center;
  const from = Math.atan2(cut.before[1] - cy, cut.before[0] - cx);
  const to = Math.atan2(cut.after[1] - cy, cut.after[0] - cx);
  // the short way round: a corner arc is never more than half a turn
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const steps = Math.max(3, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * 6));
  for (let i = 1; i <= steps; i++) {
    const angle = from + (sweep * i) / steps;
    out.push([cx + Math.cos(angle) * cut.radius, cy + Math.sin(angle) * cut.radius]);
  }
}

// ── Path arithmetic ───────────────────────────────────────────────────────

/** Which winding rule a node's own outline is drawn with. */
export function fillRuleOf(node: SceneNode): 'nonzero' | 'evenodd' {
  if (node.type === 'ellipse' && (node.innerRadius ?? 0) > 0) return 'evenodd';
  // a path with several rings has holes in it, and even-odd is what punches them
  if (node.type === 'vector' && (node.paths?.length ?? 0) > 1) return 'evenodd';
  return 'nonzero';
}

/**
 * Offsets a path.
 *
 * Only the commands this module emits are handled — `M`, `L`, `C`, `A` and `Z`,
 * all absolute — because every path that reaches here was built by one of the
 * generators above. An unknown command is passed through untouched rather than
 * silently mangled.
 */
export function translatePath(d: string, dx: number, dy: number): string {
  if (!dx && !dy) return d;
  const tokens = d.match(/[MLCAZmlcazHVhv]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return d;

  const out: string[] = [];
  let command = '';
  let index = 0;
  const num = () => parseFloat(tokens[index++]);
  const push = (...values: (string | number)[]) => out.push(...values.map(String));

  while (index < tokens.length) {
    const token = tokens[index];
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index++;
      if (command === 'Z' || command === 'z') push('Z');
      continue;
    }
    switch (command) {
      case 'M':
      case 'L':
        push(command, num() + dx, num() + dy);
        break;
      case 'H':
        push('H', num() + dx);
        break;
      case 'V':
        push('V', num() + dy);
        break;
      case 'C':
        push('C', num() + dx, num() + dy, num() + dx, num() + dy, num() + dx, num() + dy);
        break;
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        push('A', rx, ry, rot, large, sweep, num() + dx, num() + dy);
        break;
      }
      default:
        // relative commands and anything unrecognised: leave the numbers alone
        push(tokens[index++]);
        break;
    }
  }
  return out.join(' ');
}

/** True when a layer sits at an angle, or mirrored, in its parent. */
export function isPlaced(node: SceneNode): boolean {
  return !!node.rotation || !!node.flipH || !!node.flipV;
}

/**
 * A child's outline in its parent's coordinates.
 *
 * The cheap path — a translate of the node's own outline — is right for the
 * overwhelming majority of layers. A rotated or mirrored one is turned properly
 * instead, which costs a flatten and is the only way a mask or a boolean can be
 * honest about a layer that is not axis-aligned.
 */
export function placedPath(node: SceneNode): string {
  if (isPlaced(node)) return pathFromRegion(placedRegion(node));
  return translatePath(outlinePath(node), node.x, node.y);
}

/** One nested clip in a boolean group's rendering. */
export interface BooleanClip {
  d: string;
  rule: 'nonzero' | 'evenodd';
}

/** A rectangle big enough to stand in for "everywhere", for complementing. */
const EVERYWHERE = 'M -100000 -100000 L 100000 -100000 L 100000 100000 L -100000 100000 Z';

/**
 * The clips that draw a boolean result, outermost first.
 *
 * The four operations are all set algebra, and CSS can express all of it:
 *
 * - `union` is one path under the non-zero rule — overlaps simply fill.
 * - `exclude` is the same path under even-odd, which is what XOR means.
 * - `intersect` is a clip inside a clip inside a clip.
 * - `subtract` is the first child clipped by the *complement* of each of the
 *   others, and a complement is "everywhere, plus the shape, even-odd".
 *
 * Nothing is baked: the children keep their geometry and the result is
 * re-derived on every paint, which is what makes the group live.
 */
export function booleanClips(node: SceneNode, children: SceneNode[]): BooleanClip[] {
  if (!children.length) return [];
  const paths = children.map((child) => ({
    d: placedPath(child),
    // a rotated child is flattened into its placed outline, which has no holes
    // of its own left to punch
    rule: isPlaced(child) ? ('evenodd' as const) : fillRuleOf(child),
  }));

  switch (node.op ?? 'union') {
    case 'exclude':
      return [{ d: paths.map((p) => p.d).join(' '), rule: 'evenodd' }];
    case 'intersect':
      return paths;
    case 'subtract':
      return [
        paths[0],
        ...paths.slice(1).map((part) => ({
          d: `${EVERYWHERE} ${part.d}`,
          rule: 'evenodd' as const,
        })),
      ];
    case 'union':
    default:
      // even-odd would punch holes where two children overlap; non-zero is the
      // rule that makes overlapping subpaths read as one region
      return [{ d: paths.map((p) => p.d).join(' '), rule: 'nonzero' }];
  }
}

/** Cubic approximation of a quarter ellipse — the standard circle constant. */
const KAPPA = 0.5522847498;

/**
 * A shape's outline as editable anchors.
 *
 * This is the one-way door behind "Outline shape": a polygon knows it has five
 * sides and re-draws itself when that changes, while a vector only knows where
 * its points are. Corner radii are not carried across — a rounded rectangle's
 * corners are four arcs, and turning them into handles would produce a path
 * nobody can edit sensibly.
 */
export function outlineAnchors(node: SceneNode): Anchor[] {
  const w = Math.max(node.w, 0);
  const h = Math.max(node.h, 0);

  switch (node.type) {
    case 'vector':
      return anchorsOf(node).map(cloneAnchor);
    case 'line':
    case 'arrow':
      return [
        { x: 0, y: 0 },
        { x: w, y: h },
      ];
    case 'polygon': {
      const count = Math.max(3, Math.round(node.sides ?? 3));
      return Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + (i / count) * TAU;
        return { x: (w / 2) * (1 + Math.cos(angle)), y: (h / 2) * (1 + Math.sin(angle)) };
      });
    }
    case 'star': {
      const count = Math.max(3, Math.round(node.sides ?? 5));
      const inner = Math.min(Math.max(node.innerRatio ?? 0.4, 0.01), 1);
      return Array.from({ length: count * 2 }, (_, i) => {
        const angle = -Math.PI / 2 + (i / (count * 2)) * TAU;
        const scale = i % 2 === 0 ? 1 : inner;
        return {
          x: (w / 2) * (1 + scale * Math.cos(angle)),
          y: (h / 2) * (1 + scale * Math.sin(angle)),
        };
      });
    }
    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      const cx = rx * KAPPA;
      const cy = ry * KAPPA;
      return [
        { x: rx, y: 0, in: [-cx, 0], out: [cx, 0] },
        { x: w, y: ry, in: [0, -cy], out: [0, cy] },
        { x: rx, y: h, in: [cx, 0], out: [-cx, 0] },
        { x: 0, y: ry, in: [0, cy], out: [0, -cy] },
      ];
    }
    default: {
      // A rounded box keeps its corners: the radii become per-point ones, which
      // is the same shape drawn a different way. Without this, opening a
      // rounded rectangle's points would square it off the moment you moved
      // one — a conversion nobody asked for.
      const [tl, tr, br, bl] = radiiOf(node);
      return [
        { x: 0, y: 0, r: tl || undefined },
        { x: w, y: 0, r: tr || undefined },
        { x: w, y: h, r: br || undefined },
        { x: 0, y: h, r: bl || undefined },
      ];
    }
  }
}

/**
 * A quarter-turn of an ellipse, as a cubic — the standard arc-to-bezier form.
 *
 * `4/3 · tan(θ/4)` is the handle length that puts the curve's midpoint on the
 * arc, which is where the circle constant comes from in the first place: at a
 * right angle it *is* KAPPA.
 */
function arcAnchors(
  w: number,
  h: number,
  from: number,
  to: number,
  scale: number,
): Anchor[] {
  const rx = (w / 2) * scale;
  const ry = (h / 2) * scale;
  const cx = w / 2;
  const cy = h / 2;
  const a0 = -Math.PI / 2 + from * TAU;
  const sweep = (to - from) * TAU;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / steps;
  const k = (4 / 3) * Math.tan(step / 4);

  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = a0 + step * i;
    // the tangent, scaled to the handle length one step of the sweep needs
    const tx = -rx * Math.sin(angle) * k;
    const ty = ry * Math.cos(angle) * k;
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      in: i === 0 ? null : ([-tx, -ty] as [number, number]),
      out: i === steps ? null : ([tx, ty] as [number, number]),
    };
  });
}

/** A whole ellipse as four anchors, at a fraction of its radii. */
function ellipseRing(w: number, h: number, scale: number): Anchor[] {
  const rx = (w / 2) * scale;
  const ry = (h / 2) * scale;
  const cx = w / 2;
  const cy = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { x: cx, y: cy - ry, in: [-kx, 0], out: [kx, 0] },
    { x: cx + rx, y: cy, in: [0, -ky], out: [0, ky] },
    { x: cx, y: cy + ry, in: [kx, 0], out: [-kx, 0] },
    { x: cx - rx, y: cy, in: [0, ky], out: [0, -ky] },
  ];
}

/**
 * A shape's outline as editable subpaths — the one honest answer.
 *
 * A single anchor list cannot describe every shape: a donut is two rings and a
 * pie slice is an arc plus two straight sides. Everything that needs a shape's
 * real geometry — point editing, the boolean kernel, "Outline shape" — reads it
 * from here, so those three can no longer disagree about what a pie is.
 */
export function outlinePaths(node: SceneNode): VectorPath[] {
  if (node.type === 'vector') return subpathsOf(node);

  const w = Math.max(node.w, 0);
  const h = Math.max(node.h, 0);

  if (node.type === 'ellipse') {
    const start = node.arcStart ?? 0;
    const end = node.arcEnd ?? 1;
    const inner = Math.min(Math.max(node.innerRadius ?? 0, 0), 0.99);
    const full = Math.abs(end - start) >= 1 - 1e-6;

    if (full && inner > 0) {
      // a ring is two rings; even-odd is what leaves the middle empty
      return [
        { anchors: ellipseRing(w, h, 1), closed: true },
        { anchors: ellipseRing(w, h, inner), closed: true },
      ];
    }
    if (!full) {
      const outer = arcAnchors(w, h, start, end, 1);
      // a pie comes back through the centre; a segment of a ring comes back
      // along the inner arc
      const back = inner > 0 ? arcAnchors(w, h, end, start, inner) : [{ x: w / 2, y: h / 2 }];
      return [{ anchors: [...outer, ...back], closed: true }];
    }
  }

  const anchors = outlineAnchors(node);
  if (anchors.length < 2) return [];
  return [{ anchors, closed: isClosedShape(node) }];
}

// ── Subpaths ──────────────────────────────────────────────────────────────

/**
 * Every run of anchors in a vector.
 *
 * A path with a hole in it is two rings, so the geometry cannot always be one
 * anchor list. Reading through here means the rest of the app does not have to
 * know which of the two shapes a given layer is stored in.
 */
export function subpathsOf(node: Pick<SceneNode, 'paths' | 'anchors' | 'points' | 'closed'>): VectorPath[] {
  if (node.paths?.length) return node.paths;
  return [{ anchors: anchorsOf(node), closed: !!node.closed }];
}

export function pathFromSubpaths(paths: VectorPath[], smooth = 0): string {
  return paths
    .map((sub) => pathFromAnchors(sub.anchors, sub.closed, smooth))
    .filter(Boolean)
    .join(' ');
}

/** The box every subpath fits inside. */
export function subpathBounds(paths: VectorPath[]): Bounds | null {
  const boxes = paths.map((sub) => anchorBounds(sub.anchors)).filter(Boolean) as Bounds[];
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

// ── Regions ───────────────────────────────────────────────────────────────

/**
 * A node's outline as flat polygons, ready for the boolean kernel.
 *
 * Curves are sampled, because a boolean between two curves has no closed form
 * worth the trouble — every geometry kernel in a design tool flattens first.
 * The result is in the node's own coordinate space unless an offset is given.
 */
export function regionOf(node: SceneNode, offset: { x: number; y: number } = { x: 0, y: 0 }): Region {
  const shift = (points: [number, number][]): Ring =>
    points.map(([x, y]) => [x + offset.x, y + offset.y] as Point);

  const smooth = node.type === 'vector' ? (node.smooth ?? 0) : 0;
  return outlinePaths(node)
    .map((sub) => shift(flattenAnchors(sub.anchors, sub.closed, smooth)))
    .filter((ring) => ring.length > 2);
}

/** A region as an SVG path — one closed subpath per ring. */
export function pathFromRegion(region: Region): string {
  return region
    .filter((ring) => ring.length > 2)
    .map(
      (ring) =>
        `M ${ring.map(([x, y]) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`).join(' L ')} Z`,
    )
    .join(' ');
}

/** A region as editable subpaths — every point a corner, because it is one. */
export function subpathsFromRegion(region: Region): VectorPath[] {
  return region
    .filter((ring) => ring.length > 2)
    .map((ring) => ({ anchors: ring.map(([x, y]) => ({ x, y })), closed: true }));
}

/** The box a region occupies. */
export function regionBounds(region: Region): Bounds | null {
  const points = region.flat();
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxX: Math.max(...points.map((p) => p[0])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

export function shiftRegion(region: Region, dx: number, dy: number): Region {
  return region.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as Point));
}

/**
 * A child's outline in its parent's space, rotation and flips included.
 *
 * Masks and boolean groups compose in the parent's coordinates, so a rotated
 * child has to be turned before it is combined — otherwise it clips by the box
 * it would have had if you had never rotated it.
 */
export function placedRegion(node: SceneNode): Region {
  const local = regionOf(node);
  if (!local.length) return local;

  const cx = node.w / 2;
  const cy = node.h / 2;
  const angle = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = node.flipH ? -1 : 1;
  const sy = node.flipV ? -1 : 1;
  const still = !angle && sx === 1 && sy === 1;

  return local.map((ring) =>
    ring.map(([x, y]) => {
      if (still) return [x + node.x, y + node.y] as Point;
      // the same order CSS applies them in: flip, then rotate, about the centre
      const fx = (x - cx) * sx;
      const fy = (y - cy) * sy;
      return [
        node.x + cx + fx * cos - fy * sin,
        node.y + cy + fx * sin + fy * cos,
      ] as Point;
    }),
  );
}

// ── Point editing ─────────────────────────────────────────────────────────
//
// The arithmetic behind vector edit mode. It lives here rather than in the
// component because inserting a point, bending a segment and joining two ends
// are geometry questions with one right answer — the component only decides
// which pointer gesture asks them.

/** A control point, in the node's own space. */
export type Vec = [number, number];

/** One anchor's address inside a set of subpaths. */
export interface AnchorRef {
  sub: number;
  index: number;
}

/** The four control points of the segment leaving `anchors[index]`. */
export function segmentPoints(anchors: Anchor[], index: number): [Vec, Vec, Vec, Vec] {
  const from = anchors[index];
  const to = anchors[(index + 1) % anchors.length];
  return [
    [from.x, from.y],
    [from.x + (from.out?.[0] ?? 0), from.y + (from.out?.[1] ?? 0)],
    [to.x + (to.in?.[0] ?? 0), to.y + (to.in?.[1] ?? 0)],
    [to.x, to.y],
  ];
}

/** A point on a cubic. */
export function cubicAt(seg: [Vec, Vec, Vec, Vec], t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * seg[0][0] + b * seg[1][0] + c * seg[2][0] + d * seg[3][0],
    a * seg[0][1] + b * seg[1][1] + c * seg[2][1] + d * seg[3][1],
  ];
}

/**
 * de Casteljau: a cubic as its two halves.
 *
 * This is what lets a new point land *on* the curve rather than near it —
 * splitting produces two segments whose union is the original, so the shape
 * does not twitch when you add a point to it.
 */
export function splitCubic(
  seg: [Vec, Vec, Vec, Vec],
  t: number,
): { left: [Vec, Vec, Vec, Vec]; right: [Vec, Vec, Vec, Vec] } {
  const lerp = (a: Vec, b: Vec): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const ab = lerp(seg[0], seg[1]);
  const bc = lerp(seg[1], seg[2]);
  const cd = lerp(seg[2], seg[3]);
  const abc = lerp(ab, bc);
  const bcd = lerp(bc, cd);
  const mid = lerp(abc, bcd);
  return { left: [seg[0], ab, abc, mid], right: [mid, bcd, cd, seg[3]] };
}

/** Where a pointer landed on a path. */
export interface SegmentHit extends AnchorRef {
  /** how far along the segment leaving `index`, 0–1 */
  t: number;
  /** the point on the curve itself, in the node's space */
  x: number;
  y: number;
  distance: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Nearest point on one cubic — exact for a straight segment, sampled otherwise. */
function nearestOnCubic(
  seg: [Vec, Vec, Vec, Vec],
  point: { x: number; y: number },
): { t: number; x: number; y: number; distance: number } {
  const straight =
    seg[1][0] === seg[0][0] &&
    seg[1][1] === seg[0][1] &&
    seg[2][0] === seg[3][0] &&
    seg[2][1] === seg[3][1];

  if (straight) {
    const dx = seg[3][0] - seg[0][0];
    const dy = seg[3][1] - seg[0][1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? clamp01(((point.x - seg[0][0]) * dx + (point.y - seg[0][1]) * dy) / lengthSquared)
      : 0;
    const x = seg[0][0] + t * dx;
    const y = seg[0][1] + t * dy;
    return { t, x, y, distance: Math.hypot(point.x - x, point.y - y) };
  }

  // A cubic has no closed-form nearest point, so: sample, then bisect around
  // the best sample. Four passes is well inside a pixel at any usable zoom.
  const STEPS = 32;
  const distanceAt = (t: number) => {
    const [x, y] = cubicAt(seg, t);
    return Math.hypot(point.x - x, point.y - y);
  };
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const d = distanceAt(t);
    if (d < bestDistance) {
      bestDistance = d;
      best = t;
    }
  }
  let span = 1 / STEPS;
  for (let pass = 0; pass < 5; pass++) {
    for (const t of [best - span, best + span]) {
      if (t < 0 || t > 1) continue;
      const d = distanceAt(t);
      if (d < bestDistance) {
        bestDistance = d;
        best = t;
      }
    }
    span /= 2;
  }
  const [x, y] = cubicAt(seg, best);
  return { t: best, x, y, distance: bestDistance };
}

/** The segment a point is closest to, across every subpath. */
export function nearestOnSubpaths(
  paths: VectorPath[],
  point: { x: number; y: number },
  smooth = 0,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  paths.forEach((path, sub) => {
    const anchors = resolveSmoothing(path.anchors, path.closed, smooth);
    const count = anchors.length;
    if (count < 2) return;
    const last = path.closed ? count : count - 1;
    for (let index = 0; index < last; index++) {
      const near = nearestOnCubic(segmentPoints(anchors, index), point);
      if (!best || near.distance < best.distance) best = { sub, index, ...near };
    }
  });
  return best;
}

/** Deep copy — every edit below works on one of these, never on the document. */
export function clonePaths(paths: VectorPath[]): VectorPath[] {
  return paths.map((path) => ({ closed: path.closed, anchors: path.anchors.map(cloneAnchor) }));
}

/**
 * Rewrites one subpath, with the smooth slider baked into it first.
 *
 * Anything that touches handles goes through here. Once a point carries its own
 * handles the slider no longer applies to it, so baking is what stops an edit
 * from silently straightening the segments either side of the one you meant.
 */
function editSubpath(
  paths: VectorPath[],
  sub: number,
  smooth: number,
  fn: (anchors: Anchor[], path: VectorPath) => Anchor[],
): VectorPath[] {
  const next = clonePaths(paths);
  const path = next[sub];
  if (!path) return next;
  const anchors = smooth
    ? resolveSmoothing(path.anchors, path.closed, smooth).map(cloneAnchor)
    : path.anchors;
  next[sub] = { closed: path.closed, anchors: fn(anchors, path) };
  return next;
}

const offset = (from: Vec, to: Vec): Vec => [to[0] - from[0], to[1] - from[1]];

/**
 * Drops a point onto a segment without moving the curve.
 *
 * A straight segment gains a corner — a polyline stays a polyline. A curved one
 * is split properly, so the two halves trace exactly what the one used to.
 */
export function insertAnchor(
  paths: VectorPath[],
  hit: SegmentHit,
  smooth = 0,
): { paths: VectorPath[]; at: AnchorRef } {
  const source = paths[hit.sub];
  if (!source) return { paths: clonePaths(paths), at: { sub: hit.sub, index: hit.index } };

  const next = editSubpath(paths, hit.sub, smooth, (anchors) => {
    const to = (hit.index + 1) % anchors.length;
    const straight = !anchors[hit.index].out && !anchors[to].in;
    if (straight) {
      anchors.splice(hit.index + 1, 0, { x: hit.x, y: hit.y, in: null, out: null });
      return anchors;
    }
    const { left, right } = splitCubic(segmentPoints(anchors, hit.index), hit.t);
    const mid = left[3];
    anchors[hit.index] = { ...anchors[hit.index], out: offset(left[0], left[1]) };
    anchors[to] = { ...anchors[to], in: offset(right[3], right[2]) };
    anchors.splice(hit.index + 1, 0, {
      x: mid[0],
      y: mid[1],
      in: offset(mid, left[2]),
      out: offset(mid, right[1]),
    });
    return anchors;
  });
  return { paths: next, at: { sub: hit.sub, index: hit.index + 1 } };
}

/**
 * Figma's bend: drags the curve itself, and the handles follow.
 *
 * Displacing B(t) by D is one equation in two unknowns — the two control points
 * can absorb it in infinitely many ways. Taking the least-norm solution spreads
 * the correction across both in proportion to how much each one influences that
 * point, which is what makes the curve move under the pointer instead of
 * kicking away from it.
 */
export function bendSegment(
  paths: VectorPath[],
  hit: SegmentHit,
  dx: number,
  dy: number,
  smooth = 0,
): VectorPath[] {
  // the ends of a segment cannot be moved by its handles at all, so a grab
  // right on an anchor is treated as a grab a little way along
  const t = Math.max(0.1, Math.min(0.9, hit.t));
  const u = 1 - t;
  const a = 3 * u * u * t;
  const b = 3 * u * t * t;
  const scale = a * a + b * b;

  return editSubpath(paths, hit.sub, smooth, (anchors) => {
    const to = (hit.index + 1) % anchors.length;
    const from = anchors[hit.index];
    const end = anchors[to];
    const out = from.out ?? [0, 0];
    const into = end.in ?? [0, 0];
    anchors[hit.index] = {
      ...from,
      out: [out[0] + (dx * a) / scale, out[1] + (dy * a) / scale],
    };
    anchors[to] = {
      ...end,
      in: [into[0] + (dx * b) / scale, into[1] + (dy * b) / scale],
    };
    return anchors;
  });
}

/** A path walked the other way — handles swap sides with it. */
export function reverseAnchors(anchors: Anchor[]): Anchor[] {
  return anchors
    .slice()
    .reverse()
    .map((anchor) => ({
      x: anchor.x,
      y: anchor.y,
      in: anchor.out ? ([anchor.out[0], anchor.out[1]] as Vec) : null,
      out: anchor.in ? ([anchor.in[0], anchor.in[1]] as Vec) : null,
    }));
}

/** True when this anchor is a loose end — the only kind that can be joined. */
export function isEndpoint(path: VectorPath, index: number): boolean {
  return !path.closed && (index === 0 || index === path.anchors.length - 1);
}

/**
 * Joins two loose ends, the way ⌘J does.
 *
 * Two ends of the same subpath close it. Two ends of different subpaths become
 * one run of points, each side turned around as needed so the ends meet — which
 * is why joining a path to itself and joining two paths are one operation.
 */
export function joinAnchors(
  paths: VectorPath[],
  a: AnchorRef,
  b: AnchorRef,
): VectorPath[] | null {
  const first = paths[a.sub];
  const second = paths[b.sub];
  if (!first || !second) return null;
  if (!isEndpoint(first, a.index) || !isEndpoint(second, b.index)) return null;

  if (a.sub === b.sub) {
    if (a.index === b.index || first.anchors.length < 3) return null;
    const next = clonePaths(paths);
    next[a.sub] = { closed: true, anchors: next[a.sub].anchors };
    return next;
  }

  const head = a.index === 0 ? reverseAnchors(first.anchors) : first.anchors.map(cloneAnchor);
  const tail =
    b.index === 0 ? second.anchors.map(cloneAnchor) : reverseAnchors(second.anchors);
  const merged: VectorPath = { closed: false, anchors: [...head, ...tail] };

  const rest = paths
    .map((path, sub) => (sub === a.sub || sub === b.sub ? null : path))
    .filter(Boolean) as VectorPath[];
  return [...clonePaths(rest), merged];
}

/** A neighbour's handle once the point beyond it goes away. */
function grow(handle: Vec | null | undefined, toward: Vec): Vec {
  const base: Vec = handle ? [handle[0], handle[1]] : [toward[0] * 0.5, toward[1] * 0.5];
  return [base[0] * 1.5, base[1] * 1.5];
}

/**
 * Deletes anchors, healing the curve behind them.
 *
 * Figma does not leave a dent where a point used to be: the neighbours lengthen
 * their handles to cover the span that just doubled. A polyline still collapses
 * to a straight line, because there was no curve to keep.
 */
export function removeAnchors(paths: VectorPath[], indices: number[]): VectorPath[] {
  const doomed = new Set(indices);
  const out: VectorPath[] = [];
  let base = 0;

  for (const path of paths) {
    const start = base;
    base += path.anchors.length;
    const anchors = path.anchors.map(cloneAnchor);
    const count = anchors.length;
    const gone = anchors.map((_, i) => doomed.has(start + i));

    anchors.forEach((anchor, i) => {
      if (!gone[i] || isCorner(anchor)) return;
      const before = i > 0 ? i - 1 : path.closed ? count - 1 : -1;
      const after = i < count - 1 ? i + 1 : path.closed ? 0 : -1;
      if (before < 0 || after < 0 || gone[before] || gone[after]) return;
      const prev = anchors[before];
      const next = anchors[after];
      prev.out = grow(prev.out, [anchor.x - prev.x, anchor.y - prev.y]);
      next.in = grow(next.in, [anchor.x - next.x, anchor.y - next.y]);
    });

    const kept = anchors.filter((_, i) => !gone[i]);
    // a subpath needs two points to be a subpath
    if (kept.length > 1) out.push({ closed: path.closed, anchors: kept });
  }
  return out;
}

/** An anchor's position in the running order across every subpath. */
export function runningIndex(paths: VectorPath[], sub: number, index: number): number {
  let total = 0;
  for (let i = 0; i < sub; i++) total += paths[i].anchors.length;
  return total + index;
}

/** The inverse of `runningIndex`. */
export function anchorAt(paths: VectorPath[], running: number): AnchorRef | null {
  let total = 0;
  for (let sub = 0; sub < paths.length; sub++) {
    const count = paths[sub].anchors.length;
    if (running < total + count) return { sub, index: running - total };
    total += count;
  }
  return null;
}

/**
 * The geometry of any shape, as something point editing can work on.
 *
 * A vector answers with its own subpaths; everything else answers with the
 * outline it would have if you converted it. Nothing is written by asking —
 * that is what lets ⏎ open a rectangle's points without destroying the fact
 * that it is a rectangle until you actually move one.
 */
export function editablePaths(node: SceneNode): VectorPath[] {
  return outlinePaths(node);
}

/**
 * Cuts a path in two, wherever the pointer landed on it.
 *
 * A closed ring becomes one open run that starts and ends at the cut. An open
 * run becomes two, both of which keep the curve they had — the point is
 * duplicated and the split halves of the cubic go one to each side, so nothing
 * moves when a path comes apart.
 */
export function cutAt(paths: VectorPath[], hit: SegmentHit, smooth = 0): VectorPath[] {
  const source = paths[hit.sub];
  if (!source) return clonePaths(paths);

  const anchors = (smooth ? resolveSmoothing(source.anchors, source.closed, smooth) : source.anchors)
    .map(cloneAnchor);
  const count = anchors.length;
  const to = (hit.index + 1) % count;
  const straight = !anchors[hit.index].out && !anchors[to].in;

  let head: Anchor;
  let tail: Anchor;
  if (straight) {
    head = { x: hit.x, y: hit.y, in: null, out: null };
    tail = { x: hit.x, y: hit.y, in: null, out: null };
  } else {
    const { left, right } = splitCubic(segmentPoints(anchors, hit.index), hit.t);
    const mid = left[3];
    anchors[hit.index] = { ...anchors[hit.index], out: offset(left[0], left[1]) };
    anchors[to] = { ...anchors[to], in: offset(right[3], right[2]) };
    head = { x: mid[0], y: mid[1], in: offset(mid, left[2]), out: null };
    tail = { x: mid[0], y: mid[1], in: null, out: offset(mid, right[1]) };
  }

  const rest = paths.filter((_, sub) => sub !== hit.sub).map((path) => ({
    closed: path.closed,
    anchors: path.anchors.map(cloneAnchor),
  }));

  if (source.closed) {
    // one loop, opened: it now runs from the cut, all the way round, back to it
    const after = anchors.slice(hit.index + 1);
    const before = anchors.slice(0, hit.index + 1);
    return [...rest, { closed: false, anchors: [tail, ...after, ...before, head] }];
  }

  const first = { closed: false, anchors: [...anchors.slice(0, hit.index + 1), head] };
  const second = { closed: false, anchors: [tail, ...anchors.slice(hit.index + 1)] };
  return [...rest, ...[first, second].filter((path) => path.anchors.length > 1)];
}

/** Drops the segment leaving `hit.index` — the eraser, applied to an edge. */
export function eraseSegment(paths: VectorPath[], hit: SegmentHit): VectorPath[] {
  const source = paths[hit.sub];
  if (!source) return clonePaths(paths);
  const rest = clonePaths(paths.filter((_, sub) => sub !== hit.sub));
  const anchors = source.anchors.map(cloneAnchor);

  if (source.closed) {
    // erasing one edge of a ring opens it, starting just past the gap
    const opened = [...anchors.slice(hit.index + 1), ...anchors.slice(0, hit.index + 1)];
    if (opened.length < 2) return rest;
    return [...rest, { closed: false, anchors: opened }];
  }
  const first = { closed: false, anchors: anchors.slice(0, hit.index + 1) };
  const second = { closed: false, anchors: anchors.slice(hit.index + 1) };
  return [...rest, ...[first, second].filter((path) => path.anchors.length > 1)];
}

/** Winding test — which ring a paint-bucket click landed inside. */
export function containsPoint(path: VectorPath, point: { x: number; y: number }, smooth = 0): boolean {
  const ring = flattenAnchors(path.anchors, true, smooth);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > point.y !== yj > point.y;
    if (straddles && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The stroke of a path whose points carry their own widths.
 *
 * Figma's variable width is not a stroke at all once it varies — it is a filled
 * band, because SVG has one width per path and no way to taper it. The band is
 * built by walking the flattened curve, stepping out along each normal by half
 * the width interpolated between the two points the sample sits between, and
 * coming back down the other side.
 */
export function variableWidthPath(
  paths: VectorPath[],
  base: number,
  smooth = 0,
): string | null {
  const region = variableWidthRegion(paths, base, smooth);
  return region ? pathFromRegion(region) : null;
}

/**
 * The same band, as rings rather than as a `d`.
 *
 * "Outline stroke" needs polygons to hand the boolean kernel, and the canvas
 * needs a path — one construction serves both, so a tapered line outlines to
 * exactly the shape that was on screen.
 */
export function variableWidthRegion(
  paths: VectorPath[],
  base: number,
  smooth = 0,
): Region | null {
  const widths = paths.flatMap((path) => path.anchors.map((a) => a.width));
  if (!widths.some((width) => width !== undefined)) return null;

  const rings: Ring[] = [];
  for (const path of paths) {
    const anchors = resolveSmoothing(path.anchors, path.closed, smooth);
    const count = anchors.length;
    if (count < 2) continue;
    const last = path.closed ? count : count - 1;

    const samples: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i < last; i++) {
      const seg = segmentPoints(anchors, i);
      const from = anchors[i].width ?? base;
      const to = anchors[(i + 1) % count].width ?? base;
      const steps = Math.max(8, Math.ceil(Math.hypot(seg[3][0] - seg[0][0], seg[3][1] - seg[0][1]) / 4));
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        const [x, y] = cubicAt(seg, t);
        samples.push({ x, y, w: from + (to - from) * t });
      }
    }
    if (!path.closed) {
      const seg = segmentPoints(anchors, last - 1);
      samples.push({ x: seg[3][0], y: seg[3][1], w: anchors[count - 1].width ?? base });
    }
    if (samples.length < 2) continue;

    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < samples.length; i++) {
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const half = Math.max(samples[i].w, 0) / 2;
      left.push([samples[i].x + nx * half, samples[i].y + ny * half]);
      right.push([samples[i].x - nx * half, samples[i].y - ny * half]);
    }
    if (path.closed) {
      // a closed run is two rings; even-odd is what leaves the middle empty
      rings.push(left as Ring, right.slice().reverse() as Ring);
    } else {
      rings.push([...left, ...right.slice().reverse()] as Ring);
    }
  }
  return rings.length ? rings : null;
}

/** Every anchor's box — what the Vector panel's align buttons measure. */
export function selectionBounds(paths: VectorPath[], indices: number[]): Bounds | null {
  const picked: Anchor[] = [];
  paths.forEach((path, sub) =>
    path.anchors.forEach((anchor, index) => {
      if (indices.includes(runningIndex(paths, sub, index))) picked.push(anchor);
    }),
  );
  if (!picked.length) return null;
  return {
    minX: Math.min(...picked.map((a) => a.x)),
    minY: Math.min(...picked.map((a) => a.y)),
    maxX: Math.max(...picked.map((a) => a.x)),
    maxY: Math.max(...picked.map((a) => a.y)),
  };
}

/** Lines the selected points up, the way the object aligners line up layers. */
export function alignAnchors(
  paths: VectorPath[],
  indices: number[],
  edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom',
): VectorPath[] {
  const box = selectionBounds(paths, indices);
  if (!box) return clonePaths(paths);
  const x =
    edge === 'left' ? box.minX : edge === 'right' ? box.maxX : (box.minX + box.maxX) / 2;
  const y = edge === 'top' ? box.minY : edge === 'bottom' ? box.maxY : (box.minY + box.maxY) / 2;
  const horizontal = edge === 'left' || edge === 'right' || edge === 'hcenter';

  return paths.map((path, sub) => ({
    closed: path.closed,
    anchors: path.anchors.map((anchor, index) => {
      if (!indices.includes(runningIndex(paths, sub, index))) return cloneAnchor(anchor);
      return { ...cloneAnchor(anchor), x: horizontal ? x : anchor.x, y: horizontal ? anchor.y : y };
    }),
  }));
}


/** Cuts a path at one of its own points, rather than partway along a segment. */
export function cutAtAnchor(paths: VectorPath[], ref: AnchorRef): VectorPath[] {
  const source = paths[ref.sub];
  if (!source) return clonePaths(paths);
  const rest = clonePaths(paths.filter((_, sub) => sub !== ref.sub));
  const anchors = source.anchors.map(cloneAnchor);
  const at = anchors[ref.index];
  if (!at) return clonePaths(paths);

  if (source.closed) {
    const head = { ...cloneAnchor(at), in: null };
    const tail = { ...cloneAnchor(at), out: null };
    const after = anchors.slice(ref.index + 1);
    const before = anchors.slice(0, ref.index);
    return [...rest, { closed: false, anchors: [head, ...after, ...before, tail] }];
  }
  if (ref.index === 0 || ref.index === anchors.length - 1) return clonePaths(paths);

  const first = {
    closed: false,
    anchors: [...anchors.slice(0, ref.index), { ...cloneAnchor(at), out: null }],
  };
  const second = {
    closed: false,
    anchors: [{ ...cloneAnchor(at), in: null }, ...anchors.slice(ref.index + 1)],
  };
  return [...rest, first, second];
}
