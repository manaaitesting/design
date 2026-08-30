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
  alignAnchors,
  applyMirror,
  bendSegment,
  cubicAt,
  cutAt,
  editablePaths,
  insertAnchor,
  joinAnchors,
  mirrorOf,
  nearestOnSubpaths,
  outlinePaths,
  pathFromSubpaths,
  regionBounds,
  regionOf,
  subpathBounds,
  removeAnchors,
  segmentPoints,
  variableWidthPath,
  type Anchor,
} from '../src/document/geometry';
import { maskStyles } from '../src/document/mask';
import {
  dropRegion,
  interiorPoint,
  mergeRegions,
  regionAt,
  vectorRegions,
} from '../src/document/regions';
import { clip, inside, signedArea, strokeRegion, type Region } from '../src/document/clipper';
import { placedRegion } from '../src/document/geometry';
import { resolveToken, tokenVars, modeVars } from '../src/document/variables';
import { makeNode } from '../src/document/defaults';
import { shapePaint } from '../src/document/css';
import { newEffect } from '../src/document/effects';
import { toHtml, toReact } from '../src/export/toCode';
import { SHADER_BY_ID } from '../src/webgl/shaders';
import type { Doc, SceneNode, Token, VectorPath } from '../src/document/types';

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
    const line = strokeRegion([[[0, 0], [100, 0]]], 10, false, { cap: 'round' });
    const ideal = 1000 + Math.PI * 25; // a 100×10 body with a half-disc each end
    // the caps are polygons, so the area lands just under the true circle — a
    // fraction of a percent, and the same trade every renderer makes
    expect(area(line)).toBeGreaterThan(ideal * 0.99);
    expect(area(line)).toBeLessThanOrEqual(ideal);
  });

  test('a butt cap stops at the end of the line and a square cap runs past it', () => {
    const butt = strokeRegion([[[0, 0], [100, 0]]], 10, false, { cap: 'butt' });
    expect(area(butt)).toBeCloseTo(1000, 2);
    expect(regionBounds(butt)?.maxX).toBeCloseTo(100, 4);

    const square = strokeRegion([[[0, 0], [100, 0]]], 10, false, { cap: 'square' });
    // half a width of overhang at each end, which is what the canvas draws
    expect(area(square)).toBeCloseTo(1100, 2);
    expect(regionBounds(square)?.maxX).toBeCloseTo(105, 4);
  });

  test('a mitred corner keeps its spike until the miter angle gives up on it', () => {
    const elbow: Region = [[[0, 0], [100, 0], [100, 100]]];
    const miter = strokeRegion(elbow, 10, false, { cap: 'butt', join: 'miter' });
    // the spike fills the corner square the two arms leave open
    expect(inside([104, -4], miter)).toBe(true);
    expect(area(miter)).toBeCloseTo(2000, 2);

    const bevel = strokeRegion(elbow, 10, false, { cap: 'butt', join: 'bevel' });
    expect(inside([104, -4], bevel)).toBe(false);
    expect(area(bevel)).toBeCloseTo(1987.5, 2);

    // a 90° corner is well inside the default 28.96°, so raising the angle past
    // it is what makes the mitre give up and bevel instead
    const given = strokeRegion(elbow, 10, false, { cap: 'butt', join: 'miter', miterAngle: 120 });
    expect(area(given)).toBeCloseTo(area(bevel), 4);
  });

  test('a dashed stroke outlines into one shape per dash', () => {
    const dashes = strokeRegion([[[0, 0], [100, 0]]], 10, false, { cap: 'butt', dash: 10, gap: 10 });
    // 10 on, 10 off along 100: five marks, and the last one ends on the point
    expect(dashes).toHaveLength(5);
    expect(area(dashes)).toBeCloseTo(500, 2);
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

/**
 * A shader is a paint, not a node type.
 *
 * Any layer may carry one, so the two questions worth asking directly are
 * whether the surface lands *inside* the shape's clip — a shader on the box
 * rather than on the star is the bug this prevents — and whether it survives
 * both exports. The pixels themselves are checked in the editor suite; these
 * are the structural claims underneath them.
 */
test.describe('shader paints', () => {
  const shader = { id: 'aurora', params: { speed: 0.4 } };

  test('a shape with a shader gets a clipped fill layer even with no background', () => {
    const star = node({ id: 's', type: 'star', w: 100, h: 100, fill: null, shader });
    const paint = shapePaint(star);
    expect(paint?.shader).toEqual(shader);
    // the clip is what confines the surface to the star instead of to its box
    expect(String(paint?.fill?.clipPath)).toContain('path(');
    expect(paint?.fill?.background).toBeUndefined();
  });

  test('an open path has no inside, so it takes no shader either', () => {
    const line = node({ id: 'l', type: 'line', w: 100, h: 0, shader });
    expect(shapePaint(line)?.shader).toBeNull();
  });

  test('React export nests the surface inside the shape’s clipped layer', () => {
    const doc: Doc = {
      root: node({ id: 'root', type: 'frame', parent: null, children: ['s'] }),
      s: node({ id: 's', type: 'star', parent: 'root', w: 100, h: 100, shader }),
    };
    const { markup } = toReact('root', doc);
    expect(markup).toContain('<Shader id="aurora"');
    expect(markup).toMatch(/clipPath[^\n]*\n?[^\n]*<Shader/);
    // the GLSL travels with the component
    expect(markup).toContain('FRAGMENTS');
  });

  test('a shader fill on a box exports as a surface under the image paints', () => {
    const doc: Doc = {
      root: node({ id: 'root', type: 'frame', parent: null, children: [], w: 200, h: 200, shader }),
    };
    const html = toHtml('root', doc);
    expect(html).toContain('data-shader="aurora"');
    expect(html).not.toContain('export as React for the GLSL');
  });

  test('HTML export carries the programs and a loop to run them', () => {
    const doc: Doc = {
      root: node({ id: 'root', type: 'shader', parent: null, children: [], w: 200, h: 200, shader }),
    };
    const html = toHtml('root', doc);
    expect(html).toContain('data-shader="aurora"');
    expect(html).toContain('#version 300 es');
    expect(html).toContain('requestAnimationFrame');
    expect(html).toContain('u_time');
  });

  test('an untouched parameter exports at its default, not at zero', () => {
    const doc: Doc = {
      root: node({ id: 'root', type: 'shader', parent: null, children: [], shader: { id: 'aurora', params: {} } }),
    };
    const params = JSON.parse(
      /data-params="([^"]*)"/.exec(toHtml('root', doc))![1].replace(/&quot;/g, '"'),
    );
    const def = SHADER_BY_ID.get('aurora')!;
    expect(Object.keys(params).sort()).toEqual(def.params.map((p) => p.key).sort());
  });

  test('the exported root stays the containing block its children resolve against', () => {
    // Dropping `position` entirely made the root `static`, so every absolutely
    // placed layer inside it escaped to the page — the frame rendered as an
    // empty coloured box with its contents piled in the corner.
    const doc: Doc = {
      root: node({ id: 'root', type: 'frame', parent: null, children: ['c'], w: 600, h: 400 }),
      c: node({ id: 'c', type: 'rect', parent: 'root', x: 40, y: 40, w: 100, h: 100 }),
    };
    expect(toHtml('root', doc)).toContain('position: relative');
    expect(toReact('root', doc).css).toContain('position: relative');
  });

  test('a shader effect exports too, rather than leaving an empty layer', () => {
    const doc: Doc = {
      root: node({
        id: 'root',
        type: 'frame',
        parent: null,
        children: [],
        effects: [{ ...newEffect('shader'), shader }],
      }),
    };
    expect(toHtml('root', doc)).toContain('data-shader="aurora"');
    expect(toReact('root', doc).markup).toContain('<Shader id="aurora"');
  });
});

/**
 * Point editing.
 *
 * Every one of these is a question with a right answer that is invisible on the
 * canvas until it is wrong: a point inserted a hair off the curve looks fine
 * and moves the shape, a heal that forgets the handles leaves a dent, a cut
 * that loses a control point straightens a segment nobody touched.
 */
test.describe('point editing', () => {
  const curve = (): VectorPath[] => [
    {
      closed: false,
      anchors: [
        { x: 0, y: 0, out: [30, 0] },
        { x: 90, y: 0, in: [-30, 0] },
      ],
    },
  ];

  test('inserting a point on a curve does not move the curve', () => {
    const paths = curve();
    const hit = nearestOnSubpaths(paths, { x: 45, y: 0 })!;
    const { paths: next, at } = insertAnchor(paths, hit);
    expect(next[0].anchors).toHaveLength(3);
    expect(at.index).toBe(1);
    // the two halves still pass through the same place the whole did
    const before = cubicAt(segmentPoints(paths[0].anchors, 0), 0.5);
    const middle = next[0].anchors[1];
    expect(middle.x).toBeCloseTo(before[0], 4);
    expect(middle.y).toBeCloseTo(before[1], 4);
  });

  test('inserting on a straight segment keeps it a polyline', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    ];
    const hit = nearestOnSubpaths(paths, { x: 40, y: 0 })!;
    const { paths: next } = insertAnchor(paths, hit);
    expect(next[0].anchors[1]).toMatchObject({ x: 40, y: 0 });
    expect(pathFromSubpaths(next)).toBe('M 0 0 L 40 0 L 100 0');
  });

  test('bending a segment moves the curve under the pointer', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    ];
    const hit = nearestOnSubpaths(paths, { x: 50, y: 0 })!;
    const bent = bendSegment(paths, hit, 0, 40);
    const at = cubicAt(segmentPoints(bent[0].anchors, 0), hit.t);
    expect(at[1]).toBeCloseTo(40, 3);
  });

  test('deleting a smooth point heals the curve rather than denting it', () => {
    const paths: VectorPath[] = [
      {
        closed: false,
        anchors: [
          { x: 0, y: 0, out: [20, 0] },
          { x: 50, y: 30, in: [-15, 0], out: [15, 0] },
          { x: 100, y: 0, in: [-20, 0] },
        ],
      },
    ];
    const kept = removeAnchors(paths, [1]);
    expect(kept[0].anchors).toHaveLength(2);
    // the survivors reach further, so the span that doubled still bulges
    expect(kept[0].anchors[0].out![0]).toBeCloseTo(30, 3);
    expect(kept[0].anchors[1].in![0]).toBeCloseTo(-30, 3);
  });

  test('a polyline point deletes to a straight line, because there was no curve', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }] },
    ];
    expect(pathFromSubpaths(removeAnchors(paths, [1]))).toBe('M 0 0 L 100 0');
  });

  test('joining the two ends of one path closes it', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] },
    ];
    const joined = joinAnchors(paths, { sub: 0, index: 0 }, { sub: 0, index: 2 })!;
    expect(joined[0].closed).toBe(true);
  });

  test('joining two paths turns them the right way round first', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { closed: false, anchors: [{ x: 30, y: 0 }, { x: 20, y: 0 }] },
    ];
    // the ends that meet are the second point of each, so the second path flips
    const joined = joinAnchors(paths, { sub: 0, index: 1 }, { sub: 1, index: 1 })!;
    expect(joined).toHaveLength(1);
    expect(joined[0].anchors.map((a) => a.x)).toEqual([0, 10, 20, 30]);
  });

  test('cutting a closed ring opens it at the cut', () => {
    const paths: VectorPath[] = [
      {
        closed: true,
        anchors: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ];
    const hit = nearestOnSubpaths(paths, { x: 50, y: 0 })!;
    const cut = cutAt(paths, hit);
    expect(cut).toHaveLength(1);
    expect(cut[0].closed).toBe(false);
    // the ring is now a run that starts and ends where the knife went in
    expect(cut[0].anchors[0]).toMatchObject({ x: 50, y: 0 });
    expect(cut[0].anchors.at(-1)).toMatchObject({ x: 50, y: 0 });
  });

  test('cutting an open path leaves two', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    ];
    const cut = cutAt(paths, nearestOnSubpaths(paths, { x: 60, y: 0 })!);
    expect(cut).toHaveLength(2);
    expect(cut[0].anchors.at(-1)).toMatchObject({ x: 60, y: 0 });
    expect(cut[1].anchors[0]).toMatchObject({ x: 60, y: 0 });
  });

  test('a point radius rounds the corner it sits on', () => {
    const square: Anchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0, r: 20 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const d = pathFromAnchors(square, true);
    // the corner is trimmed both sides and arced across, not drawn as a point
    expect(d).toContain('A 20 20');
    expect(d).not.toContain('L 100 0');
  });

  test('a radius bigger than the corner can take is clamped, not inverted', () => {
    const d = pathFromAnchors(
      [{ x: 0, y: 0 }, { x: 20, y: 0, r: 500 }, { x: 20, y: 20 }],
      true,
    );
    expect(d).toContain('A 10 10');
  });

  test('the three mirror states are read off the handles when none is stated', () => {
    expect(mirrorOf({ x: 0, y: 0, in: [-10, 0], out: [10, 0] })).toBe('full');
    expect(mirrorOf({ x: 0, y: 0, in: [-10, 0], out: [30, 0] })).toBe('angle');
    expect(mirrorOf({ x: 0, y: 0, out: [10, 0] })).toBe('none');
  });

  test('mirroring the angle keeps the opposite handle its own length', () => {
    const anchor = applyMirror({ x: 0, y: 0, in: [0, -30], out: [10, 0] }, 'angle');
    expect(anchor.in![0]).toBeCloseTo(-30, 4);
    expect(anchor.in![1]).toBeCloseTo(0, 4);
    expect(Math.hypot(anchor.in![0], anchor.in![1])).toBeCloseTo(30, 4);
  });

  test('aligning points moves only the ones selected', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 20, y: 90 }] },
    ];
    const aligned = alignAnchors(paths, [0, 1], 'left');
    expect(aligned[0].anchors.map((a) => a.x)).toEqual([0, 0, 20]);
  });

  test('a point with its own width draws the stroke as a band', () => {
    const paths: VectorPath[] = [
      { closed: false, anchors: [{ x: 0, y: 0, width: 2 }, { x: 100, y: 0, width: 20 }] },
    ];
    const band = variableWidthPath(paths, 4)!;
    expect(band).toBeTruthy();
    // a taper is a filled outline: it starts thin and ends thick
    const ys = [...band.matchAll(/-?\d+(?:\.\d+)?\s(-?\d+(?:\.\d+)?)/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...ys)).toBeGreaterThan(9);
    expect(Math.min(...ys)).toBeLessThan(-9);
  });

  test('a path with no varied points strokes normally', () => {
    expect(variableWidthPath([{ closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], 4)).toBeNull();
  });

  test('a tapered stroke exports as the band it draws, not as a stroked line', () => {
    const doc: Doc = {
      root: node({ id: 'root', type: 'page', children: ['t'] }),
      t: node({
        id: 't',
        type: 'vector',
        parent: 'root',
        w: 200,
        h: 1,
        anchors: [
          { x: 0, y: 0, width: 2 },
          { x: 200, y: 0, width: 30 },
        ],
        closed: false,
        border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
      }),
    };
    const jsx = toReact('t', doc).markup;
    expect(jsx).toContain('fillRule="evenodd"');
    expect(jsx).toContain('fill="#111111"');
    // the ordinary stroke attributes are not there, because it is not one
    expect(jsx).not.toContain('strokeLinecap');
  });

  test('a rounded rectangle opens with its corners, not squared off', () => {
    const paths = outlinePaths(node({ id: 'r', type: 'rect', w: 100, h: 60, radius: 12 }));
    expect(paths[0].anchors.map((a) => a.r)).toEqual([12, 12, 12, 12]);
    // and they are still corners when drawn, rather than a number nobody reads
    expect(pathFromAnchors(paths[0].anchors, true)).toContain('A 12 12');
  });

  test('a rounded rectangle flattens rounded, so a boolean sees the shape', () => {
    const box = node({ id: 'r', type: 'rect', w: 100, h: 100, radius: 50 });
    const ring = regionOf(box)[0];
    // every point of a fully rounded 100×100 box is 50 from the centre
    for (const [x, y] of ring) expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(50, 0);
  });

  test('a pie slice outlines as a pie, not as the whole ellipse', () => {
    const pie = node({ id: 'e', type: 'ellipse', w: 100, h: 100, arcStart: 0, arcEnd: 0.25 });
    const paths = outlinePaths(pie);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    // it comes back through the centre, which is what makes it a slice
    expect(paths[0].anchors.at(-1)).toMatchObject({ x: 50, y: 50 });
    const box = regionBounds(regionOf(pie))!;
    expect(box.minX).toBeCloseTo(50, 0);
    expect(box.maxX).toBeCloseTo(100, 0);
    expect(box.minY).toBeCloseTo(0, 0);
    expect(box.maxY).toBeCloseTo(50, 0);
  });

  test('a donut outlines as two rings', () => {
    const paths = outlinePaths(
      node({ id: 'e', type: 'ellipse', w: 100, h: 100, innerRadius: 0.5 }),
    );
    expect(paths).toHaveLength(2);
    expect(paths.every((sub) => sub.closed)).toBe(true);
    const inner = anchorBounds(paths[1].anchors)!;
    expect(inner.maxX - inner.minX).toBeCloseTo(50, 3);
  });

  test('a rectangle can be opened for editing without becoming a vector', () => {
    const box = node({ id: 'r', type: 'rect', w: 40, h: 20 });
    const paths = editablePaths(box);
    expect(box.type).toBe('rect');
    expect(paths[0].anchors).toHaveLength(4);
    expect(paths[0].closed).toBe(true);
  });
});

/**
 * Regions.
 *
 * A closed outline is one shape but not necessarily one area, and everything
 * the paint bucket and the shape builder do rests on being able to say which
 * areas a path encloses. Getting that wrong is invisible until someone clicks
 * a lens and the whole shape fills.
 */
test.describe('vector regions', () => {
  const ring = (x: number, y = 0, size = 100): VectorPath => ({
    closed: true,
    anchors: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  });

  test('one ring encloses one region', () => {
    expect(vectorRegions([ring(0)])).toHaveLength(1);
  });

  test('two overlapping rings enclose three regions', () => {
    const found = vectorRegions([ring(0), ring(50)]);
    expect(found).toHaveLength(3);
    // the lens they share is the smallest, and it is last
    const lens = found.at(-1)!;
    const box = regionBounds(lens.region)!;
    expect(box.minX).toBeCloseTo(50, 3);
    expect(box.maxX).toBeCloseTo(100, 3);
  });

  test('rings that never meet stay two regions', () => {
    expect(vectorRegions([ring(0), ring(300)])).toHaveLength(2);
  });

  test('a click finds the region it landed in, smallest first', () => {
    const found = vectorRegions([ring(0), ring(50)]);
    // inside the overlap, which is the lens rather than either whole square
    const at = regionAt(found, [75, 50]);
    const box = regionBounds(found[at].region)!;
    expect(box.minX).toBeCloseTo(50, 3);
    expect(box.maxX).toBeCloseTo(100, 3);
    // and off the shape entirely
    expect(regionAt(found, [500, 500])).toBe(-1);
  });

  test('a seed lands inside the region it was taken from, crescents included', () => {
    // a square with a bite out of one side: its centroid is still inside, so
    // use a ring whose middle is genuinely outside it
    const crescent: VectorPath = {
      closed: true,
      anchors: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 60, y: 100 },
        { x: 60, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    const [region] = vectorRegions([crescent]);
    expect(inside(interiorPoint(region.region), region.region)).toBe(true);
  });

  test('the shape builder merges the regions it is given and keeps the rest', () => {
    const found = vectorRegions([ring(0), ring(50)]);
    // merge the two outer slivers, leaving the lens alone
    const lens = found.findIndex((entry) => regionBounds(entry.region)!.minX >= 50 - 1e-6 &&
      regionBounds(entry.region)!.maxX <= 100 + 1e-6);
    const outers = found.map((_, i) => i).filter((i) => i !== lens);
    const built = mergeRegions(found, outers);
    // one merged outline plus the region nobody picked
    expect(built.length).toBeGreaterThanOrEqual(2);
    const box = subpathBounds(built)!;
    expect(box.minX).toBeCloseTo(0, 3);
    expect(box.maxX).toBeCloseTo(150, 3);
  });

  test('dropping a region takes it out of the shape', () => {
    const found = vectorRegions([ring(0), ring(300)]);
    const kept = dropRegion(found, 0);
    const box = subpathBounds(kept)!;
    // only the far square is left
    expect(box.minX).toBeCloseTo(300, 3);
  });

  test('a path with no closed ring encloses nothing', () => {
    expect(vectorRegions([{ closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }])).toEqual([]);
  });
});
