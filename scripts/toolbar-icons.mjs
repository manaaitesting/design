/* Generates Figma-style filled icon paths.

   Every icon is a polyline (or several) turned into a filled band: each
   segment becomes a capsule and each vertex a disc, all wound the same way so
   `fill-rule: nonzero` unions them. That gives the crisp, even outline Figma
   draws, with no stroke rendering and no evenodd bookkeeping. */

const N = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** One capsule: along the +normal side, round the cap, back along -normal. */
function capsule([x1, y1], [x2, y2], w) {
  const h = w / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return '';
  const nx = (-dy / len) * h;
  const ny = (dx / len) * h;
  return (
    `M${N(x1 + nx)} ${N(y1 + ny)}L${N(x2 + nx)} ${N(y2 + ny)}` +
    `A${N(h)} ${N(h)} 0 0 0 ${N(x2 - nx)} ${N(y2 - ny)}` +
    `L${N(x1 - nx)} ${N(y1 - ny)}` +
    `A${N(h)} ${N(h)} 0 0 0 ${N(x1 + nx)} ${N(y1 + ny)}Z`
  );
}

/** A round join, wound to match the capsules so the union is seamless. */
function disc([cx, cy], r) {
  return (
    `M${N(cx - r)} ${N(cy)}` +
    `A${N(r)} ${N(r)} 0 1 0 ${N(cx + r)} ${N(cy)}` +
    `A${N(r)} ${N(r)} 0 1 0 ${N(cx - r)} ${N(cy)}Z`
  );
}

/** Stroke a polyline: capsules plus a disc at every join. */
function band(points, { closed = false, w = 1.6 } = {}) {
  let d = '';
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) d += capsule(points[i], points[(i + 1) % points.length], w);
  const from = closed ? 0 : 1;
  const to = closed ? points.length : points.length - 1;
  for (let i = from; i < to; i++) d += disc(points[i], w / 2);
  return d;
}

// ── point generators ────────────────────────────────────────────────────
const circlePts = (cx, cy, r, steps = 40) =>
  Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

function roundRectPts(x, y, w, h, r, per = 6) {
  const pts = [];
  const corners = [
    [x + w - r, y + r, -90, 0],
    [x + w - r, y + h - r, 0, 90],
    [x + r, y + h - r, 90, 180],
    [x + r, y + r, 180, 270],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = ((a0 + ((a1 - a0) * i) / per) * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

const polyPts = (cx, cy, r, n, rot = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

const starPts = (cx, cy, ro, ri, n = 5, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = ((rot + (180 / n) * i) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

/** Circular-ish arc from a to b, bulging by `k` at the midpoint. */
function arcPts([ax, ay], [bx, by], k, steps = 14) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const bulge = k * 4 * t * (1 - t);
    return [ax + dx * t + nx * bulge, ay + dy * t + ny * bulge];
  });
}

const wavePts = (x0, x1, y, amp, steps = 40) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 2) * amp];
  });

// ── the icons, on Figma's 24px grid ─────────────────────────────────────
const W = 1.6;
const L = (a, b) => band([a, b], { w: W });
const P = (pts, closed = true) => band(pts, { closed, w: W });

const ICONS = {
  // tools
  move: P([[7.2, 3.4], [7.2, 17.2], [10.7, 13.7], [12.9, 18.9], [15.2, 17.8], [13.1, 12.9], [17.6, 12.5]]),
  frame:
    L([8.6, 3], [8.6, 21]) + L([15.4, 3], [15.4, 21]) +
    L([3, 8.6], [21, 8.6]) + L([3, 15.4], [21, 15.4]),
  rect: P(roundRectPts(4.6, 4.6, 14.8, 14.8, 1.8)),
  pen:
    P([...arcPts([19.2, 4.8], [6.4, 17.6], 3.2), ...arcPts([6.4, 17.6], [19.2, 4.8], 3.2).slice(1, -1)]) +
    P(circlePts(12, 12, 2.1, 28)),
  text: L([7, 5.6], [17, 5.6]) + L([12, 5.6], [12, 18.4]) + L([9.4, 18.4], [14.6, 18.4]),
  shape: P(polyPts(12, 12.4, 8.2, 5)),
  actions:
    disc([7.6, 7.6], 1.5) + disc([16.4, 7.6], 1.5) + disc([7.6, 16.4], 1.5) +
    L([16.4, 13.6], [16.4, 19.2]) + L([13.6, 16.4], [19.2, 16.4]),

  // move menu
  hand:
    P([[7.4, 11.6], [7.4, 6.8]], false) + P([[10.3, 10.9], [10.3, 5.6]], false) +
    P([[13.2, 10.9], [13.2, 6.4]], false) + P([[16.1, 12], [16.1, 8.6]], false) +
    P([[7.4, 11.6], [5.6, 13], [5.4, 14.4], [8, 18.2], [10.4, 20.2], [13.6, 20.4], [16.1, 18.4], [16.1, 12]], false),
  scale:
    P(roundRectPts(4, 11.4, 8.6, 8.6, 1.4)) +
    L([12.6, 11.4], [19.4, 4.6]) + P([[13.8, 4.6], [19.4, 4.6], [19.4, 10.2]], false),

  // frame menu
  section: P(roundRectPts(4, 6.6, 16, 12.8, 2)) + L([4, 10.4], [20, 10.4]),
  slice: L([4.6, 19.4], [19.4, 4.6]) + P([[13.4, 4.6], [19.4, 4.6], [19.4, 10.6]], false),

  // shapes menu
  line: L([4.8, 19.2], [19.2, 4.8]),
  arrow: L([4.8, 19.2], [19.2, 4.8]) + P([[12.6, 4.8], [19.2, 4.8], [19.2, 11.4]], false),
  ellipse: P(circlePts(12, 12, 7.6)),
  polygon: P([[12, 4.2], [20.2, 19.6], [3.8, 19.6]]),
  star: P(starPts(12, 12.4, 8, 3.4)),
  image:
    P(roundRectPts(4, 5.4, 16, 13.2, 2)) + disc([8.7, 10.1], 1.15) +
    P([[4.6, 17], [9.8, 12.2], [13.4, 15.4], [15.8, 13.2], [19.4, 16.4]], false),

  // pen menu
  pencil:
    P([[15.6, 3.8], [20.2, 8.4], [8.6, 20], [4, 20.4], [4.4, 15.8]]) +
    L([13.6, 5.8], [18.2, 10.4]),

  // text menu
  textPath:
    L([7.4, 4.6], [16.6, 4.6]) + L([12, 4.6], [12, 14.2]) +
    P(arcPts([3.6, 17.4], [20.4, 17.4], 2.6), false),

  // right-hand group
  annotate:
    P(wavePts(3.6, 13.6, 15.4, 2.6), false) +
    P([[15.4, 11.6], [19.4, 7.6], [16.6, 4.8], [12.6, 8.8], [11.8, 12.4]]),
  inspect:
    P(roundRectPts(4, 5, 16, 14, 2)) + L([9.6, 5], [9.6, 19]) +
    L([12.4, 10.2], [17, 10.2]) + L([12.4, 13.8], [15.4, 13.8]),
  plugin: P(polyPts(12, 12, 8.6, 4)) + P(polyPts(12, 12, 4, 4)),
  code: P([[9.4, 6.6], [4.2, 12], [9.4, 17.4]], false) + P([[14.6, 6.6], [19.8, 12], [14.6, 17.4]], false),
};

const body = Object.entries(ICONS)
  .map(([k, d]) => `  ${k}: '${d}',`)
  .join('\n');

// ── write the generated block back into the test page ───────────────────
import { readFileSync, writeFileSync } from 'node:fs';

const page = 'toolbar.html';
const html = readFileSync(page, 'utf8');
const open = '/* ICONS:START — regenerate with `node scripts/toolbar-icons.mjs` */';
const close = '/* ICONS:END */';
const from = html.indexOf(open);
const to = html.indexOf(close);
if (from === -1 || to === -1) throw new Error(`${page}: ICONS markers not found`);

const block = `const D = {\n${body}\n};\n`;
writeFileSync(page, html.slice(0, from) + open + '\n' + block + html.slice(to));
console.log(`${page}: ${Object.keys(ICONS).length} icons written at ${W}px weight`);
