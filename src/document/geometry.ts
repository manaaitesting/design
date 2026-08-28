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
}

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
  };
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
 * Builds the `d` attribute for a run of anchors.
 *
 * A segment is a straight line only when both of the control points it sits
 * between are absent — the moment either end is curved it becomes a cubic, so
 * one smooth anchor in a polyline bends only the two segments that touch it.
 */
export function pathFromAnchors(anchors: Anchor[], closed: boolean, smooth = 0): string {
  if (anchors.length === 0) return '';
  if (anchors.length === 1) return `M ${round(anchors[0].x)} ${round(anchors[0].y)}`;

  const tension = Math.min(Math.max(smooth, 0), 1) / 6;
  const resolved = anchors.map((anchor, index) => {
    if (!tension || !isCorner(anchor)) return anchor;
    const handles = derived(anchors, index, closed, tension);
    return { ...anchor, in: handles.in, out: handles.out };
  });

  let d = `M ${round(resolved[0].x)} ${round(resolved[0].y)}`;
  const last = closed ? resolved.length : resolved.length - 1;
  for (let i = 0; i < last; i++) {
    const from = resolved[i];
    const to = resolved[(i + 1) % resolved.length];
    if (!from.out && !to.in) {
      d += ` L ${round(to.x)} ${round(to.y)}`;
    } else {
      const c1 = [from.x + (from.out?.[0] ?? 0), from.y + (from.out?.[1] ?? 0)];
      const c2 = [to.x + (to.in?.[0] ?? 0), to.y + (to.in?.[1] ?? 0)];
      d += ` C ${round(c1[0])} ${round(c1[1])}, ${round(c2[0])} ${round(c2[1])}, ${round(to.x)} ${round(to.y)}`;
    }
  }
  return closed ? `${d} Z` : d;
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
  const tension = Math.min(Math.max(smooth, 0), 1) / 6;
  const resolved = anchors.map((anchor, index) => {
    if (!tension || !isCorner(anchor)) return anchor;
    const handles = derived(anchors, index, closed, tension);
    return { ...anchor, in: handles.in, out: handles.out };
  });

  const out: [number, number][] = [[resolved[0].x, resolved[0].y]];
  const last = closed ? resolved.length : resolved.length - 1;
  for (let i = 0; i < last; i++) {
    const from = resolved[i];
    const to = resolved[(i + 1) % resolved.length];
    if (!from.out && !to.in) {
      out.push([to.x, to.y]);
      continue;
    }
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
  if (closed && out.length > 1) out.pop();
  return out;
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
    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
  }
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

  if (node.type === 'vector') {
    return subpathsOf(node)
      .map((sub) => shift(flattenAnchors(sub.anchors, sub.closed, node.smooth ?? 0)))
      .filter((ring) => ring.length > 2);
  }
  const anchors = outlineAnchors(node);
  const ring = shift(flattenAnchors(anchors, true, 0));
  if (ring.length < 3) return [];

  // an ellipse with a hole punched in it is two rings, not one
  const inner = node.type === 'ellipse' ? (node.innerRadius ?? 0) : 0;
  if (inner > 0) {
    const rx = node.w / 2;
    const ry = node.h / 2;
    const hole: Ring = [];
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      hole.push([
        rx + rx * inner * Math.cos(angle) + offset.x,
        ry + ry * inner * Math.sin(angle) + offset.y,
      ]);
    }
    return [ring, hole];
  }
  return [ring];
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
