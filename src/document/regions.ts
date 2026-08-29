/**
 * The regions a path encloses.
 *
 * A closed outline is one shape but it is not necessarily one *area*: two rings
 * that overlap enclose three — the part only the first covers, the part only
 * the second covers, and the lens they share. Figma calls those regions, and
 * they are what the paint bucket fills and what the shape builder merges. Until
 * something can name them, neither tool can exist.
 *
 * They are derived, never stored. The arrangement of n rings has one cell per
 * subset of them — everything inside the rings of the subset and outside all
 * the others — so the whole set falls out of the boolean kernel that is already
 * here rather than needing a planar-subdivision engine of its own. That is
 * exact for closed rings, which is the case that matters; a region enclosed by
 * open segments crossing each other is not one of these and is left alone.
 */

import { clip, inside, type Point, type Region } from './clipper';
import { flattenAnchors, pathFromRegion, subpathsFromRegion } from './geometry';
import type { VectorPath } from './types';

/** One enclosed area of a path. */
export interface VectorRegion {
  /** the rings that bound it, in the node's own space */
  region: Region;
  /** the same thing as an outline, ready to clip a fill layer with */
  d: string;
}

/**
 * How many rings are worth enumerating.
 *
 * The work doubles with each one, and a path with more overlapping rings than
 * this is not a thing anyone is picking regions out of by hand — it comes back
 * as a single region so the tools still do something sensible.
 */
const MAX_RINGS = 5;

/** Every area a path's closed rings enclose, largest first. */
export function vectorRegions(paths: VectorPath[], smooth = 0): VectorRegion[] {
  const rings: Region[] = paths
    .filter((path) => path.closed && path.anchors.length > 2)
    .map((path) => [flattenAnchors(path.anchors, true, smooth)]);

  if (!rings.length) return [];
  if (rings.length === 1) return finish([rings[0]]);
  if (rings.length > MAX_RINGS) {
    let all = rings[0];
    for (let i = 1; i < rings.length; i++) all = clip(all, rings[i], 'union');
    return finish([all]);
  }

  const cells: Region[] = [];
  const count = rings.length;
  for (let mask = 1; mask < 1 << count; mask++) {
    // inside every ring the subset names…
    let cell: Region | null = null;
    for (let i = 0; i < count; i++) {
      if (!(mask & (1 << i))) continue;
      cell = cell ? clip(cell, rings[i], 'intersect') : rings[i];
      if (!cell.length) break;
    }
    if (!cell?.length) continue;
    // …and outside every ring it does not
    for (let i = 0; i < count && cell.length; i++) {
      if (mask & (1 << i)) continue;
      cell = clip(cell, rings[i], 'difference');
    }
    if (cell.length) cells.push(cell);
  }
  return finish(cells);
}

/** The box a set of rings occupies. */
function bounds(region: Region) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of region) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * A point that is definitely inside a region — what a paint seed has to be.
 *
 * A centroid is not good enough: a crescent's centroid is outside it. Crossing
 * the region with a horizontal line and taking the middle of a span that is
 * actually inside always lands, whatever shape it is.
 */
export function interiorPoint(region: Region): Point {
  const box = bounds(region);
  const y = (box.minY + box.maxY) / 2;
  const crossings: number[] = [];
  for (const ring of region) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
  }
  crossings.sort((a, b) => a - b);
  // under even-odd the spans between alternate crossings are the inside ones
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const mid = (crossings[i] + crossings[i + 1]) / 2;
    if (inside([mid, y], region)) return [mid, y];
  }
  return [(box.minX + box.maxX) / 2, y];
}

/**
 * Figma's shape builder: the regions you picked, merged into one outline.
 *
 * The regions nobody picked come back untouched as subpaths of their own, so
 * merging two lobes of a shape does not quietly delete the third. The result is
 * flattened — merging regions is a boolean, and a boolean has no curves left to
 * keep, which is the same trade Flatten makes.
 */
export function mergeRegions(regions: VectorRegion[], indices: number[]): VectorPath[] {
  const picked = regions.filter((_, i) => indices.includes(i));
  const rest = regions.filter((_, i) => !indices.includes(i));
  if (picked.length < 2) return regions.flatMap((entry) => subpathsFromRegion(entry.region));

  let merged = picked[0].region;
  for (const entry of picked.slice(1)) merged = clip(merged, entry.region, 'union');
  return [
    ...subpathsFromRegion(merged),
    ...rest.flatMap((entry) => subpathsFromRegion(entry.region)),
  ];
}

/** The same tool's other half: the shape with one region taken out of it. */
export function dropRegion(regions: VectorRegion[], index: number): VectorPath[] {
  return regions
    .filter((_, i) => i !== index)
    .flatMap((entry) => subpathsFromRegion(entry.region));
}

/** Biggest first, so a click in an overlap still lands on the smaller cell. */
function finish(cells: Region[]): VectorRegion[] {
  return cells
    .filter((region) => region.some((ring) => ring.length > 2))
    .map((region) => ({ region, d: pathFromRegion(region) }))
    .sort((a, b) => span(b.region) - span(a.region));
}

/** A cheap size for ordering — the area of the box a cell occupies. */
function span(region: Region): number {
  const box = bounds(region);
  return (box.maxX - box.minX) * (box.maxY - box.minY);
}

/**
 * The region a point is in, or -1.
 *
 * Cells are disjoint, so at most one answers — but a point on a shared edge can
 * read as inside both, and the smallest is the one the pointer meant.
 */
export function regionAt(regions: VectorRegion[], point: Point): number {
  let found = -1;
  for (let i = 0; i < regions.length; i++) {
    if (!inside(point, regions[i].region)) continue;
    // `regions` is largest first, so later is smaller
    found = i;
  }
  return found;
}

/** The regions holding at least one of these seed points. */
export function seededRegions(regions: VectorRegion[], seeds: Point[]): VectorRegion[] {
  const hit = new Set<number>();
  for (const seed of seeds) {
    const at = regionAt(regions, seed);
    if (at >= 0) hit.add(at);
  }
  return [...hit].map((index) => regions[index]);
}

/**
 * The outline of a set of regions, as one path.
 *
 * The cells are disjoint, so even-odd over all their rings is exactly their
 * union — no boolean pass is needed to draw them together, only to merge them
 * into geometry.
 */
export function pathOfRegions(regions: VectorRegion[]): string {
  return regions.map((entry) => entry.d).filter(Boolean).join(' ');
}
