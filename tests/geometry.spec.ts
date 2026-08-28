import { expect, test } from '@playwright/test';
import {
  anchorBounds,
  arrowPath,
  booleanClips,
  ellipsePath,
  flattenAnchors,
  linePath,
  outlineAnchors,
  pathFromAnchors,
  polygonPath,
  rectPath,
  starPath,
  translatePath,
} from '../src/document/geometry';
import { maskStyles } from '../src/document/mask';
import { clip, inside, signedArea, strokeRegion, type Region } from '../src/document/clipper';
import { placedRegion } from '../src/document/geometry';
import { resolveToken, tokenVars, modeVars } from '../src/document/variables';
import { makeNode } from '../src/document/defaults';
import type { Doc, SceneNode, Token } from '../src/document/types';

/**
 * Geometry has no pixels to look at.
 *
 * The rest of the suite drives the real canvas because that is where its bugs
 * live. These are the exception: a boolean that clips the wrong region or a
 * path that translates its arc radii is invisible until someone draws exactly
 * the shape that exposes it, so they are checked directly instead.
 */

const node = (patch: Partial<SceneNode> & { id: string }): SceneNode =>
  makeNode(patch.id, patch.type ?? 'rect', patch.parent ?? 'root', patch);

test.describe('paths', () => {
  test('a run of corners is straight lines', () => {
    expect(pathFromAnchors([{ x: 0, y: 0 }, { x: 10, y: 10 }], false)).toBe('M 0 0 L 10 10');
  });

  test('a handle turns the segment it touches into a cubic', () => {
    const d = pathFromAnchors([{ x: 0, y: 0, out: [5, 0] }, { x: 10, y: 10, in: [-5, 0] }], false);
    expect(d).toContain('C 5 0, 5 10, 10 10');
  });

  test('closing appends Z', () => {
    const d = pathFromAnchors([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true);
    expect(d.endsWith('Z')).toBe(true);
  });

  test('bounds include the control points, so a curve is never cropped', () => {
    const box = anchorBounds([{ x: 0, y: 0, out: [30, 0] }, { x: 10, y: 10 }]);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 10 });
  });

  test('flattening samples a curve into many points', () => {
    const flat = flattenAnchors([{ x: 0, y: 0, out: [20, 0] }, { x: 40, y: 40, in: [-20, 0] }], false);
    expect(flat.length).toBeGreaterThan(5);
  });
});

test.describe('translate', () => {
  test('moves line and move commands', () => {
    expect(translatePath('M 0 0 L 10 10', 5, 3)).toBe('M 5 3 L 15 13');
  });

  test('moves an arc endpoint but not its radii', () => {
    expect(translatePath('M 5 0 A 5 5 0 0 1 10 5 Z', 100, 0)).toBe('M 105 0 A 5 5 0 0 1 110 5 Z');
  });

  test('moves all three points of a cubic', () => {
    expect(translatePath('M 0 0 C 1 1, 2 2, 3 3', 1, 1)).toBe('M 1 1 C 2 2 3 3 4 4');
  });
});

test.describe('parametric shapes', () => {
  test('a triangle has three vertices', () => {
    expect((polygonPath(100, 100, 3).match(/L/g) ?? []).length).toBe(2);
  });

  test('a five-pointed star has ten', () => {
    expect((starPath(100, 100, 5, 0.4).match(/L/g) ?? []).length).toBe(9);
  });

  test('a full ellipse is two half arcs', () => {
    expect((ellipsePath(100, 100).match(/A/g) ?? []).length).toBe(2);
  });

  test('a donut is two rings', () => {
    expect((ellipsePath(100, 100, 0, 1, 0.5).match(/A/g) ?? []).length).toBe(4);
  });

  test('a pie slice closes through the centre', () => {
    expect(ellipsePath(100, 100, 0, 0.25).startsWith('M 50 50')).toBe(true);
  });

  test('a line is one segment and an arrow adds a head', () => {
    expect(linePath(10, 4)).toBe('M 0 0 L 10 4');
    expect((arrowPath(50, 0, 2).match(/M/g) ?? []).length).toBe(2);
  });

  test('a rounded rectangle keeps its corners inside the box', () => {
    expect(rectPath(10, 10, [40, 40, 40, 40])).toContain('A 5 5');
  });

  test('outlining an ellipse produces four anchors with handles', () => {
    const anchors = outlineAnchors(node({ id: 'e', type: 'ellipse', w: 100, h: 60 }));
    expect(anchors).toHaveLength(4);
    expect(anchors[0].in).toBeTruthy();
  });
});

test.describe('boolean groups', () => {
  const a = node({ id: 'a', x: 0, y: 0, w: 50, h: 50 });
  const b = node({ id: 'b', x: 25, y: 25, w: 50, h: 50 });
  const group = node({ id: 'g', type: 'boolean', w: 75, h: 75, children: ['a', 'b'] });

  test('union is one path under the non-zero rule', () => {
    const clips = booleanClips({ ...group, op: 'union' }, [a, b]);
    expect(clips).toHaveLength(1);
    expect(clips[0].rule).toBe('nonzero');
  });

  test('exclude is the same path under even-odd', () => {
    expect(booleanClips({ ...group, op: 'exclude' }, [a, b])[0].rule).toBe('evenodd');
  });

  test('intersect nests one clip per child', () => {
    expect(booleanClips({ ...group, op: 'intersect' }, [a, b])).toHaveLength(2);
  });

  test('subtract complements everything after the first', () => {
    const clips = booleanClips({ ...group, op: 'subtract' }, [a, b]);
    expect(clips[1].rule).toBe('evenodd');
    // "everywhere, minus this shape" — the complement is a huge box plus it
    expect(clips[1].d).toContain('-100000');
  });

  test('children are offset into the group’s own space', () => {
    expect(booleanClips(group, [a, b])[0].d).toContain('M 25 25');
  });
});

test.describe('the boolean kernel', () => {
  const rect = (x: number, y: number, w: number, h: number): Region => [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  ];

  /**
   * Even-odd area. A ring nested inside an odd number of others is a hole, and
   * orientation is not consulted — the kernel stitches rings undirected on
   * purpose, so a signed sum would be meaningless.
   */
  const area = (region: Region): number =>
    region.reduce((sum, ring) => {
      const depth = region.filter((other) => other !== ring && inside(ring[0], [other])).length;
      return sum + (depth % 2 === 0 ? 1 : -1) * Math.abs(signedArea(ring));
    }, 0);

  const A = rect(0, 0, 10, 10);
  const B = rect(5, 5, 10, 10);

  test('overlapping squares', () => {
    expect(area(clip(A, B, 'union'))).toBeCloseTo(175, 2);
    expect(area(clip(A, B, 'intersect'))).toBeCloseTo(25, 2);
    expect(area(clip(A, B, 'difference'))).toBeCloseTo(75, 2);
    expect(area(clip(A, B, 'xor'))).toBeCloseTo(150, 2);
  });

  test('shapes that never meet', () => {
    const far = rect(100, 100, 10, 10);
    expect(clip(A, far, 'union')).toHaveLength(2);
    expect(clip(A, far, 'intersect')).toHaveLength(0);
    expect(area(clip(A, far, 'difference'))).toBeCloseTo(100, 2);
  });

  test('a shape cut out of the middle leaves a hole', () => {
    const hole = clip(A, rect(2, 2, 4, 4), 'difference');
    expect(hole).toHaveLength(2);
    expect(area(hole)).toBeCloseTo(84, 2);
    // and the hole really is empty
    expect(inside([4, 4], hole)).toBe(false);
    expect(inside([1, 1], hole)).toBe(true);
  });

  test('identical shapes', () => {
    const same = rect(0, 0, 10, 10);
    expect(area(clip(A, same, 'union'))).toBeCloseTo(100, 2);
    expect(area(clip(A, same, 'intersect'))).toBeCloseTo(100, 2);
    expect(clip(A, same, 'difference')).toHaveLength(0);
    expect(clip(A, same, 'xor')).toHaveLength(0);
  });

  test('shapes that share an edge but no area', () => {
    const side = rect(10, 0, 10, 10);
    expect(area(clip(A, side, 'union'))).toBeCloseTo(200, 2);
    expect(area(clip(A, side, 'intersect'))).toBeCloseTo(0, 2);
  });

  test('cutting a corner away and putting it back', () => {
    const L = clip(A, rect(5, 5, 10, 10), 'difference');
    expect(area(clip(L, rect(5, 5, 5, 5), 'union'))).toBeCloseTo(100, 2);
  });

  test('it is not rectangle-only', () => {
    const square = rect(0, 0, 10, 10);
    const diamond: Region = [
      [
        [5, -1.5],
        [11.5, 5],
        [5, 11.5],
        [-1.5, 5],
      ],
    ];
    const octagon = clip(square, diamond, 'intersect');
    expect(octagon).toHaveLength(1);
    expect(octagon[0]).toHaveLength(8);
    // the square, less the four corners the diamond cuts off
    expect(area(octagon)).toBeCloseTo(100 - 4 * 6.125, 2);
  });

  test('a stroke becomes the region a round pen sweeps', () => {
    const line = strokeRegion([[[0, 0], [100, 0]]], 10, false);
    const ideal = 1000 + Math.PI * 25; // a 100×10 body with a half-disc each end
    // the caps are polygons, so the area lands just under the true circle — a
    // fraction of a percent, and the same trade every renderer makes
    expect(area(line)).toBeGreaterThan(ideal * 0.99);
    expect(area(line)).toBeLessThanOrEqual(ideal);
  });

  test('stroking a closed path leaves a ring with a hole in it', () => {
    const ring = strokeRegion(
      [[[0, 0], [100, 0], [100, 100], [0, 100]]],
      8,
      true,
    );
    expect(ring.length).toBeGreaterThanOrEqual(2);
    // four sides of 100 at width 8, give or take the corners
    expect(area(ring)).toBeGreaterThan(3000);
    expect(area(ring)).toBeLessThan(3400);
  });
});

test.describe('placing a rotated layer', () => {
  test('a rotated child is turned before it is combined', () => {
    const square = node({ id: 'r', w: 10, h: 10, x: 0, y: 0, rotation: 45 });
    const region = placedRegion(square);
    const xs = region[0].map((point) => point[0]);
    // a square turned 45° is a diamond: wider than the square it came from
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.SQRT2 * 10, 1);
  });

  test('an unrotated child is only moved', () => {
    const square = node({ id: 'r', w: 10, h: 10, x: 5, y: 7 });
    expect(placedRegion(square)[0]).toContainEqual([5, 7]);
  });
});

test.describe('masks', () => {
  const build = (): Doc => {
    const mask = node({ id: 'm', type: 'ellipse', parent: 'f', x: 10, y: 10, w: 80, h: 80, isMask: true });
    const above = node({ id: 'above', parent: 'f', x: 0, y: 0, w: 100, h: 100 });
    const frame = node({ id: 'f', type: 'frame', children: ['m', 'above'], w: 100, h: 100 });
    return { f: frame, m: mask, above };
  };

  test('a mask clips the sibling painted above it', () => {
    const doc = build();
    const { styles, masks } = maskStyles(doc.f, doc);
    expect(masks).toEqual(['m']);
    expect(String(styles.above.clipPath)).toContain('path(');
    // the mask sits 10px into the frame, so the clip is offset by that much
    expect(String(styles.above.clipPath)).toContain('10');
  });

  test('the mask layer itself stops painting', () => {
    const doc = build();
    expect(maskStyles(doc.f, doc).styles.m.opacity).toBe(0);
  });

  test('a layer below the mask is untouched', () => {
    const doc = build();
    // put a layer *before* the mask: it paints underneath, so it is not masked
    doc.f = { ...doc.f, children: ['below', 'm', 'above'] };
    doc.below = node({ id: 'below', parent: 'f', w: 20, h: 20 });
    expect(maskStyles(doc.f, doc).styles.below).toBeUndefined();
  });
});

test.describe('variable modes', () => {
  const tokens: Token[] = [
    { id: 't1', name: 'surface', type: 'color', value: '#FFFFFF', values: { light: '#FFFFFF', dark: '#111111' } },
    { id: 't2', name: 'ink', type: 'color', value: '#111111', alias: 't1' },
    { id: 't3', name: 'radius', type: 'number', value: '12px' },
  ];

  test('a variable resolves to its value in the current mode', () => {
    const byId = new Map(tokens.map((token) => [token.id, token]));
    expect(resolveToken(tokens[0], { default: 'dark' }, byId)).toBe('#111111');
    expect(resolveToken(tokens[0], { default: 'light' }, byId)).toBe('#FFFFFF');
  });

  test('an alias follows the variable it points at', () => {
    const byId = new Map(tokens.map((token) => [token.id, token]));
    expect(resolveToken(tokens[1], { default: 'dark' }, byId)).toBe('#111111');
  });

  test('a number publishes unitless, so the user supplies the unit', () => {
    expect(tokenVars(tokens, { default: 'light' })['--radius']).toBe('12');
  });

  test('a frame with a mode re-declares only that collection’s variables', () => {
    const frame = node({ id: 'f', type: 'frame', modes: { default: 'dark' } });
    const vars = modeVars(frame, tokens, { default: 'light' });
    expect(vars['--surface']).toBe('#111111');
  });

  test('a frame with no mode re-declares nothing', () => {
    expect(modeVars(node({ id: 'f', type: 'frame' }), tokens, { default: 'light' })).toEqual({});
  });
});
