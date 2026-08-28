/**
 * A boolean group's real outline.
 *
 * The canvas paints a boolean with nested CSS clips, which is exact, live and
 * costs nothing — but a clip is not a shape, and three things need the shape
 * itself: stroking the combination, flattening it to an editable path, and
 * anything downstream that has to know where the edge actually is.
 *
 * So the outline is computed here, through the geometry kernel, and cached: the
 * inputs are a handful of numbers per child, and a design that is not being
 * dragged asks the same question with the same answer on every paint.
 */

import { clipAll, type ClipOp, type Region } from './clipper';
import { pathFromRegion, placedRegion } from './geometry';
import type { BooleanOp, SceneNode } from './types';

const KERNEL_OP: Record<BooleanOp, ClipOp> = {
  union: 'union',
  subtract: 'difference',
  intersect: 'intersect',
  exclude: 'xor',
};

/** What the children contribute, in the order they contribute it. */
function signatureOf(node: SceneNode, children: SceneNode[]): string {
  return [
    node.op ?? 'union',
    ...children.map((child) =>
      [
        child.id,
        child.type,
        child.x,
        child.y,
        child.w,
        child.h,
        child.rotation,
        child.flipH ? 1 : 0,
        child.flipV ? 1 : 0,
        child.radius,
        child.radii?.join('/') ?? '',
        child.sides ?? '',
        child.innerRatio ?? '',
        child.innerRadius ?? '',
        child.arcStart ?? '',
        child.arcEnd ?? '',
        child.paths?.length ?? child.anchors?.length ?? child.points?.length ?? 0,
        child.smooth ?? '',
      ].join(':'),
    ),
  ].join('|');
}

/** Bounded so a long editing session cannot grow it without limit. */
const cache = new Map<string, Region>();
const CACHE_LIMIT = 240;

export function booleanRegion(node: SceneNode, children: SceneNode[]): Region {
  const parts = children.filter((child) => child?.visible);
  if (parts.length === 0) return [];
  if (parts.length === 1) return placedRegion(parts[0]);

  const key = `${node.id}|${signatureOf(node, parts)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const region = clipAll(parts.map(placedRegion), KERNEL_OP[node.op ?? 'union']);
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, region);
  return region;
}

/** The same outline as an SVG path, for stroking it. */
export function booleanOutlinePath(node: SceneNode, children: SceneNode[]): string {
  return pathFromRegion(booleanRegion(node, children));
}
