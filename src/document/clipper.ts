/**
 * Polygon booleans.
 *
 * Four things in this editor need real geometry rather than a clipping trick:
 * flattening a boolean group to one editable path, outlining a stroke, drawing
 * a boolean's outline anywhere but inside it, and combining shapes that have
 * been rotated. They all reduce to the same question — given two regions, what
 * is their union, intersection, difference or symmetric difference — and this
 * is the one place that question is answered.
 *
 * The method is deliberately the simple one:
 *
 *   1. cut every segment at every crossing, so no two segments cross any more;
 *   2. throw away duplicates, so a shared edge is considered once;
 *   3. ask of each surviving piece whether its midpoint is inside the other
 *      region — which is now a question with one answer, because the piece is
 *      wholly inside or wholly outside;
 *   4. keep the pieces the operation calls for, and stitch them into rings.
 *
 * A sweep-line algorithm would be faster asymptotically. It is also where this
 * kind of code goes wrong, and the inputs here are icons and shapes — a few
 * hundred segments after flattening, not a coastline. Correctness is worth more
 * than the exponent, and this version is short enough to read in one sitting.
 *
 * Everything is even-odd: a region is a set of rings, and a point is inside it
 * when a ray from it crosses an odd number of edges. That matches how the rest
 * of the app renders paths, and it means a hole needs no special marking.
 */

export type Point = [number, number];
/** One closed ring. The closing edge is implicit. */
export type Ring = Point[];
/** A region: rings under the even-odd rule, holes included. */
export type Region = Ring[];

export type ClipOp = 'union' | 'intersect' | 'difference' | 'xor';

/** Below this, two coordinates are the same point. */
const EPS = 1e-7;
/** How far apart endpoints may be and still be joined when stitching. */
const WELD = 1e-4;

interface Segment {
  a: Point;
  b: Point;
  /** which input region it came from */
  from: 0 | 1;
}

const near = (p: Point, q: Point, tolerance = EPS): boolean =>
  Math.abs(p[0] - q[0]) <= tolerance && Math.abs(p[1] - q[1]) <= tolerance;

function segmentsOf(region: Region, from: 0 | 1): Segment[] {
  const out: Segment[] = [];
  for (const ring of region) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!near(a, b)) out.push({ a, b, from });
    }
  }
  return out;
}

/**
 * Where two segments cross, as parameters along the first.
 *
 * Collinear overlap returns the endpoints of the shared span, because those are
 * the places the pieces have to be cut for step 2 to be able to spot the
 * duplicate.
 */
function crossings(s: Segment, t: Segment): number[] {
  const [ax, ay] = s.a;
  const [bx, by] = s.b;
  const [cx, cy] = t.a;
  const [dx, dy] = t.b;

  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denominator = rx * sy - ry * sx;
  const qpx = cx - ax;
  const qpy = cy - ay;

  if (Math.abs(denominator) < EPS) {
    // parallel; collinear only if the offset lies along the direction too
    if (Math.abs(qpx * ry - qpy * rx) > EPS) return [];
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared < EPS) return [];
    const t0 = (qpx * rx + qpy * ry) / lengthSquared;
    const t1 = t0 + (sx * rx + sy * ry) / lengthSquared;
    return [Math.min(t0, t1), Math.max(t0, t1)].filter((value) => value > EPS && value < 1 - EPS);
  }

  const tOnS = (qpx * sy - qpy * sx) / denominator;
  const tOnT = (qpx * ry - qpy * rx) / denominator;
  if (tOnT < -EPS || tOnT > 1 + EPS) return [];
  if (tOnS <= EPS || tOnS >= 1 - EPS) return [];
  return [tOnS];
}

/** Cuts every segment wherever another one meets it. */
function split(segments: Segment[]): Segment[] {
  const out: Segment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const cuts: number[] = [];
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      cuts.push(...crossings(segment, segments[j]));
    }
    if (!cuts.length) {
      out.push(segment);
      continue;
    }
    cuts.sort((a, b) => a - b);

    let previous = 0;
    const at = (value: number): Point => [
      segment.a[0] + (segment.b[0] - segment.a[0]) * value,
      segment.a[1] + (segment.b[1] - segment.a[1]) * value,
    ];
    for (const cut of cuts) {
      if (cut - previous < EPS) continue;
      out.push({ a: at(previous), b: at(cut), from: segment.from });
      previous = cut;
    }
    if (1 - previous > EPS) out.push({ a: at(previous), b: segment.b, from: segment.from });
  }
  return out;
}

/** True when the point is inside the region under the even-odd rule. */
export function inside(point: Point, region: Region): boolean {
  let odd = false;
  const [px, py] = point;
  for (const ring of region) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py) {
        const x = xi + ((py - yi) / (yj - yi)) * (xj - xi);
        if (x > px) odd = !odd;
      }
    }
  }
  return odd;
}

const midpoint = (segment: Segment): Point => [
  (segment.a[0] + segment.b[0]) / 2,
  (segment.a[1] + segment.b[1]) / 2,
];

/** A key that is the same for a segment and its reverse. */
function undirectedKey(segment: Segment): string {
  const round = (value: number) => Math.round(value / WELD);
  const a = `${round(segment.a[0])},${round(segment.a[1])}`;
  const b = `${round(segment.b[0])},${round(segment.b[1])}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Stitches loose segments into closed rings.
 *
 * Direction is not trusted — a difference reverses some edges and a shared edge
 * may arrive either way round — so segments are joined undirected, flipping as
 * needed. Where more than two edges meet, the one that turns hardest to the
 * left is taken, which is the rule that traces a face rather than cutting
 * across it.
 */
function stitch(segments: Segment[]): Region {
  const round = (value: number) => Math.round(value / WELD);
  const keyOf = (point: Point) => `${round(point[0])},${round(point[1])}`;

  const byPoint = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const key = keyOf(point);
      const list = byPoint.get(key);
      if (list) list.push(index);
      else byPoint.set(key, [index]);
    }
  });

  const used = new Array<boolean>(segments.length).fill(false);
  const rings: Region = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;

    const first = segments[start].a;
    const ring: Ring = [first];
    let at = segments[start].b;
    let direction: Point = [at[0] - first[0], at[1] - first[1]];

    // walk until we come back to where we started, or run out of edges
    for (let guard = 0; guard < segments.length + 2; guard++) {
      ring.push(at);
      if (near(at, first, WELD)) break;

      const candidates = (byPoint.get(keyOf(at)) ?? []).filter((index) => !used[index]);
      if (!candidates.length) break;

      let best = -1;
      let bestTurn = -Infinity;
      let bestNext: Point = at;
      for (const index of candidates) {
        const segment = segments[index];
        const other = near(segment.a, at, WELD) ? segment.b : segment.a;
        const next: Point = [other[0] - at[0], other[1] - at[1]];
        // the most anticlockwise continuation, measured against where we came
        // from — atan2 of the cross and dot products is the signed turn
        const turn = Math.atan2(
          direction[0] * next[1] - direction[1] * next[0],
          direction[0] * next[0] + direction[1] * next[1],
        );
        if (turn > bestTurn) {
          bestTurn = turn;
          best = index;
          bestNext = other;
        }
      }
      if (best < 0) break;
      used[best] = true;
      direction = [bestNext[0] - at[0], bestNext[1] - at[1]];
      at = bestNext;
    }

    // a ring needs three corners; anything less is a dangling edge
    if (ring.length > 3) {
      if (near(ring[ring.length - 1], ring[0], WELD)) ring.pop();
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * The boolean of two regions.
 *
 * Both are read under the even-odd rule and the result is returned the same
 * way, so it can be handed straight to a renderer without a winding pass.
 */
export function clip(a: Region, b: Region, op: ClipOp): Region {
  const pieces = split([...segmentsOf(a, 0), ...segmentsOf(b, 1)]);

  // A shared edge arrives twice; one copy is enough, and which operation is
  // being run decides whether it draws — see the side test below.
  const unique = new Map<string, Segment>();
  for (const piece of pieces) {
    const key = undirectedKey(piece);
    if (!unique.has(key)) unique.set(key, piece);
  }

  const kept: Segment[] = [];
  for (const piece of unique.values()) {
    if (onBoundary(piece, a, b, op)) kept.push(piece);
  }
  return stitch(kept);
}

/** Whether a point is in the result of the operation. */
function inResult(point: Point, a: Region, b: Region, op: ClipOp): boolean {
  const inA = inside(point, a);
  const inB = inside(point, b);
  switch (op) {
    case 'union':
      return inA || inB;
    case 'intersect':
      return inA && inB;
    case 'difference':
      return inA && !inB;
    case 'xor':
    default:
      return inA !== inB;
  }
}

/**
 * Does this piece lie on the edge of the result?
 *
 * One test, for all four operations, and it is the definition rather than a
 * rule of thumb: step a hair to each side of the piece, and keep it exactly
 * when one side is in the result and the other is not. Shared edges, edges that
 * turned out to be interior, and edges of a shape that was cut away all fall
 * out of this correctly, which four separate cases did not.
 */
function onBoundary(piece: Segment, a: Region, b: Region, op: ClipOp): boolean {
  const dx = piece.b[0] - piece.a[0];
  const dy = piece.b[1] - piece.a[1];
  const length = Math.hypot(dx, dy);
  if (length < EPS) return false;

  // far enough out to clear rounding, never so far as to leave a thin sliver
  const step = Math.min(0.01, length / 3);
  const nx = (-dy / length) * step;
  const ny = (dx / length) * step;
  const middle = midpoint(piece);

  const left: Point = [middle[0] + nx, middle[1] + ny];
  const right: Point = [middle[0] - nx, middle[1] - ny];
  return inResult(left, a, b, op) !== inResult(right, a, b, op);
}

/** Folds several regions together with one operation. */
export function clipAll(regions: Region[], op: ClipOp): Region {
  if (!regions.length) return [];
  return regions.slice(1).reduce((acc, region) => clip(acc, region, op), regions[0]);
}

/** The signed area of a ring — negative when it winds the other way. */
export function signedArea(ring: Ring): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return total / 2;
}

// ── Offsetting ────────────────────────────────────────────────────────────

/**
 * A circle as a polygon — the round pen a stroke is drawn with.
 *
 * The step count follows the radius, so a hairline does not carry sixty-four
 * points and a thick stroke does not go visibly faceted.
 */
function disc(centre: Point, radius: number, steps = discSteps(radius)): Ring {
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
  }
  return ring;
}

function discSteps(radius: number): number {
  return Math.max(12, Math.min(64, Math.ceil(radius * 3)));
}

/**
 * The pen a stroke is swept with — the parts of a `BorderSpec` that change the
 * shape rather than the paint. The defaults are the canvas's own (`Shape.tsx`
 * spells the same two), so a border with nothing set outlines into the shape it
 * was already drawing.
 */
export interface StrokePen {
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  /** degrees; below it a mitre gives up and bevels, as in Figma */
  miterAngle?: number;
  dash?: number;
  gap?: number;
}

/** Drops the repeated points a flattened curve leaves behind. */
function cleaned(ring: Ring): Ring {
  const out: Ring = [];
  for (const point of ring) {
    if (!out.length || !near(out[out.length - 1], point, WELD)) out.push(point);
  }
  return out;
}

/**
 * Cuts a polyline into its dashes.
 *
 * The pattern starts on a dash at the path's first point, which is where SVG's
 * `stroke-dasharray` starts it too — so what the outliner produces is the set
 * of marks the canvas was already drawing.
 */
function dashRuns(points: Point[], dash: number, gap: number): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [points[0]];
  let on = true;
  let left = dash;

  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let remaining = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (remaining > left) {
      const t = left / remaining;
      const cut: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (on) {
        run.push(cut);
        if (run.length > 1) runs.push(run);
        run = [];
      } else {
        run = [cut];
      }
      on = !on;
      a = cut;
      remaining -= left;
      left = on ? dash : gap;
    }
    left -= remaining;
    if (on) run.push(b);
  }
  if (on && run.length > 1) runs.push(run);
  return runs;
}

/** The piece that finishes an open end at `p`, running away along `d`. */
function capPiece(p: Point, d: Point, half: number, cap: StrokePen['cap'] = 'butt'): Region | null {
  if (cap === 'butt') return null;
  if (cap === 'round') return [disc(p, half)];
  const nx = -d[1] * half;
  const ny = d[0] * half;
  return [
    [
      [p[0] + nx, p[1] + ny],
      [p[0] + nx + d[0] * half, p[1] + ny + d[1] * half],
      [p[0] - nx + d[0] * half, p[1] - ny + d[1] * half],
      [p[0] - nx, p[1] - ny],
    ],
  ];
}

/**
 * The piece that fills the notch at a corner, given the unit directions of the
 * segment arriving at `b` and the one leaving it.
 *
 * Both sides of the joint get the same treatment: on the inside of the turn the
 * wedge falls within the two rectangles anyway, so the union absorbs it and the
 * code does not have to work out which way the path bends.
 */
function joinPiece(b: Point, into: Point, out: Point, half: number, pen: StrokePen): Region | null {
  const join = pen.join ?? 'miter';
  if (join === 'round') return [disc(b, half)];

  const n1: Point = [-into[1], into[0]];
  const n2: Point = [-out[1], out[0]];
  const sum: Point = [n1[0] + n2[0], n1[1] + n2[1]];
  const spread = Math.hypot(sum[0], sum[1]);
  // a straight run through the joint, or a fold back on itself: no notch to fill
  if (spread < EPS) return null;

  const wedges: Region = [];
  for (const sign of [1, -1]) {
    const p1: Point = [b[0] + n1[0] * half * sign, b[1] + n1[1] * half * sign];
    const p2: Point = [b[0] + n2[0] * half * sign, b[1] + n2[1] * half * sign];
    // the mitre reaches half/sin(φ/2) from the corner; past the miter angle
    // Figma bevels instead, and that is what `strokeMiterlimit` does on canvas
    const reach = 2 / spread;
    if (join === 'miter' && reach <= 1 / Math.sin((((pen.miterAngle ?? 28.96) * Math.PI) / 180) / 2)) {
      const away = (half * reach * sign) / spread;
      const tip: Point = [b[0] + sum[0] * away, b[1] + sum[1] * away];
      wedges.push([b, p1, tip, p2]);
    } else {
      wedges.push([b, p1, p2]);
    }
  }
  return wedges;
}

/**
 * The region a stroke covers — Figma's "outline stroke".
 *
 * A stroked line is the sum of a rectangle per segment plus whatever the pen
 * leaves at the joints and the ends, which is exactly the Minkowski sum of the
 * path with that pen. Unioning those pieces is what turns a stroke into a shape
 * you can fill, and it is why this needed the kernel above rather than another
 * mask. The pen matters because the canvas already honours it: outlining with a
 * round pen regardless would round off a mitred corner the moment ⇧⌘O ran.
 */
export function strokeRegion(
  rings: Ring[],
  width: number,
  closed: boolean,
  pen: StrokePen = {},
): Region {
  const half = Math.max(width, 0.01) / 2;
  const pieces: Region[] = [];
  const dash = pen.dash && pen.dash > 0 ? pen.dash : 0;
  const gap = dash ? (pen.gap && pen.gap > 0 ? pen.gap : dash) : 0;

  for (const source of rings) {
    const ring = cleaned(source);
    // a flattened closed ring often repeats its first point at the end, and
    // that closing edge of no length would knock the joints out of step
    if (closed && ring.length > 2 && near(ring[0], ring[ring.length - 1], WELD)) ring.pop();
    if (ring.length < 2) continue;
    // a dashed stroke is a set of separate marks, each with two ends of its
    // own, so a closed ring is walked from its first point right round to it
    const whole = closed && dash ? [...ring, ring[0]] : ring;
    const runs = dash ? dashRuns(whole, dash, gap) : [ring];
    const rounds = !dash && closed;

    for (const run of runs) {
      const last = rounds ? run.length : run.length - 1;
      const units: Point[] = [];
      for (let i = 0; i < last; i++) {
        const a = run[i];
        const b = run[(i + 1) % run.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.hypot(dx, dy);
        if (length < EPS) continue;
        const unit: Point = [dx / length, dy / length];
        units.push(unit);
        const nx = unit[1] * -half;
        const ny = unit[0] * half;
        pieces.push([
          [
            [a[0] + nx, a[1] + ny],
            [b[0] + nx, b[1] + ny],
            [b[0] - nx, b[1] - ny],
            [a[0] - nx, a[1] - ny],
          ],
        ]);
      }
      if (!units.length) continue;

      for (let i = 1; i < units.length; i++) {
        const piece = joinPiece(run[i], units[i - 1], units[i], half, pen);
        if (piece) pieces.push(piece);
      }
      if (rounds) {
        const piece = joinPiece(run[0], units[units.length - 1], units[0], half, pen);
        if (piece) pieces.push(piece);
      } else {
        const head = units[0];
        const tail = units[units.length - 1];
        const start = capPiece(run[0], [-head[0], -head[1]], half, pen.cap);
        const end = capPiece(run[run.length - 1], tail, half, pen.cap);
        if (start) pieces.push(start);
        if (end) pieces.push(end);
      }
    }
  }

  return clipAll(pieces, 'union');
}
