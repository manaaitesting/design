import { expect, test } from '@playwright/test';
import {
  DEFAULT_DURATION,
  animatable,
  whyNot,
  asPatch,
  targetOf,
  valueIn,
  animatedNodes,
  designValue,
  docAt,
  formatTime,
  mixColor,
  motionCss,
  motionOf,
  newKeyframe,
  newMotion,
  newTrack,
  parseColor,
  playheadAt,
  propertiesIn,
  sampleAt,
  sortKeys,
  tracksOf,
  trackFor,
  valueAt,
} from '../src/document/motion';
import { easeAt } from '../src/document/prototype';
import { makeNode } from '../src/document/defaults';
import { newEffect } from '../src/document/effects';
import { toHtml, toReact } from '../src/export/toCode';
import type { Doc, MotionSpec, SceneNode } from '../src/document/types';

/**
 * The timeline, asked without a browser in the room.
 *
 * Two halves have to agree here: `valueAt` says what a track reads at a
 * moment, and `motionCss` says the same thing to the browser as keyframes. A
 * test that only checked one of them would let them drift, so the compiled CSS
 * is asserted against the same numbers the sampler gives.
 */

function scene(): { doc: Doc; board: SceneNode; box: SceneNode } {
  const board = makeNode('board', 'frame', 'root', { name: 'Board', x: 0, y: 0, w: 400, h: 300 });
  const box = makeNode('box', 'rect', 'board', { name: 'Box', x: 10, y: 20, w: 100, h: 100 });
  board.children = ['box'];
  const doc: Doc = { board, box };
  return { doc, board, box };
}

/** A layer-blur entry, as `newEffect` would make one. */
function newBlurEffect() {
  return newEffect('layer-blur');
}

function timeline(tracks: MotionSpec['tracks'], patch: Partial<MotionSpec> = {}): MotionSpec {
  return { ...newMotion(patch), tracks };
}

test.describe('the model', () => {
  test('a track holds its first and last value outside the keys', () => {
    const track = newTrack('box', 'x', [newKeyframe(200, 0), newKeyframe(600, 100)]);
    expect(valueAt(track, 0)).toBe(0);
    expect(valueAt(track, 200)).toBe(0);
    expect(valueAt(track, 600)).toBe(100);
    expect(valueAt(track, 5000)).toBe(100);
  });

  test('between two keys it interpolates on the first key\'s curve', () => {
    const linear = newTrack('box', 'x', [
      newKeyframe(0, 0, { easing: 'linear' }),
      newKeyframe(1000, 100),
    ]);
    expect(valueAt(linear, 500)).toBeCloseTo(50, 5);

    // ease-in leaves slowly, so halfway through the time is less than halfway
    // through the distance — and by exactly what the curve says
    const eased = newTrack('box', 'x', [
      newKeyframe(0, 0, { easing: 'ease-in' }),
      newKeyframe(1000, 100),
    ]);
    const half = valueAt(eased, 500) as number;
    expect(half).toBeLessThan(50);
    expect(half).toBeCloseTo(easeAt({ easing: 'ease-in', duration: 1000 }, 0.5) * 100, 3);
  });

  test('a key with no key after it ends the track', () => {
    const track = newTrack('box', 'opacity', [newKeyframe(0, 1)]);
    expect(valueAt(track, 0)).toBe(1);
    expect(valueAt(track, 999)).toBe(1);
    expect(valueAt(newTrack('box', 'opacity', []), 0)).toBeUndefined();
  });

  test('three keys pick the segment the time falls in', () => {
    const track = newTrack('box', 'y', [
      newKeyframe(0, 0, { easing: 'linear' }),
      newKeyframe(400, 40, { easing: 'linear' }),
      newKeyframe(800, 0, { easing: 'linear' }),
    ]);
    expect(valueAt(track, 200)).toBeCloseTo(20, 5);
    expect(valueAt(track, 400)).toBeCloseTo(40, 5);
    expect(valueAt(track, 600)).toBeCloseTo(20, 5);
  });

  test('keys are kept in time order however they arrive', () => {
    const keys = sortKeys([newKeyframe(900, 3), newKeyframe(100, 1), newKeyframe(500, 2)]);
    expect(keys.map((key) => key.value)).toEqual([1, 2, 3]);
  });

  test('a colour track mixes down the channels', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    // a gradient is not a colour, and nothing pretends it is
    expect(parseColor('linear-gradient(#fff, #000)')).toBeNull();

    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColor('#000000', '#ffffff', 0)).toBe('#000000');
    // an unparseable end steps rather than blending
    expect(mixColor('linear-gradient(#fff, #000)', '#ffffff', 0.4)).toBe('linear-gradient(#fff, #000)');

    const track = newTrack('box', 'fill', [
      newKeyframe(0, '#000000', { easing: 'linear' }),
      newKeyframe(1000, '#ffffff'),
    ]);
    expect(valueAt(track, 500)).toBe('#808080');
  });

  test('the whole timeline reads as patches onto the layers it drives', () => {
    const spec = timeline([
      newTrack('box', 'x', [newKeyframe(0, 0, { easing: 'linear' }), newKeyframe(1000, 200)]),
      newTrack('box', 'opacity', [newKeyframe(0, 1, { easing: 'linear' }), newKeyframe(1000, 0)]),
    ]);
    const at = sampleAt(spec, 500);
    expect(at.box.x).toBeCloseTo(100, 5);
    expect(at.box.opacity).toBeCloseTo(0.5, 5);

    const { doc } = scene();
    const scrubbed = docAt(doc, spec, 500);
    expect(scrubbed.box.x).toBeCloseTo(100, 5);
    // the document itself is untouched: a scrub is a way of looking
    expect(doc.box.x).toBe(10);
  });

  test('the playhead loops, or stops at the end when it does not', () => {
    const looping = timeline([], { duration: 1000, loop: true });
    expect(playheadAt(looping, 800, 400)).toBe(200);
    const once = timeline([], { duration: 1000, loop: false });
    expect(playheadAt(once, 800, 400)).toBe(1000);
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(1250)).toBe('0:01.25');
    expect(formatTime(61_000)).toBe('1:01.00');
  });

  test('the panel reads the layer, the properties and the tracks', () => {
    const { doc, box } = scene();
    expect(designValue(box, 'x')).toBe(10);
    expect(designValue(box, 'opacity')).toBe(1);
    expect(propertiesIn({ x: 4, fill: '#fff', name: 'nope' })).toEqual(['x', 'fill']);

    const spec = timeline([
      newTrack('box', 'opacity', [newKeyframe(0, 1)]),
      newTrack('box', 'x', [newKeyframe(0, 0)]),
    ]);
    // the panel lists properties in its own order, not in the order they were added
    expect(tracksOf(spec, 'box').map((track) => track.property)).toEqual(['x', 'opacity']);
    expect(trackFor(spec, 'box', 'x')).toBeDefined();
    expect(trackFor(spec, 'box', 'h')).toBeUndefined();
    expect(animatedNodes(spec, doc, 'board')).toEqual(['box']);
    expect(motionOf({ ...doc.board, motion: spec })).toBe(spec);
    expect(motionOf(doc.board)).toBeNull();
    expect(newMotion().duration).toBe(DEFAULT_DURATION);
  });
});

test.describe('compiled to CSS', () => {
  test('one @keyframes per track, at the percentages the times work out to', () => {
    const { doc } = scene();
    const track = newTrack('box', 'x', [
      newKeyframe(0, 0, { easing: 'linear' }),
      newKeyframe(500, 100, { easing: 'linear' }),
      newKeyframe(1000, 0),
    ]);
    const css = motionCss(timeline([track], { duration: 1000 }), doc, { scope: '[data-canvas-root]' });

    expect(css).toContain(`@keyframes pl-motion-${track.id}`);
    expect(css).toContain('0% {');
    expect(css).toContain('50% {');
    expect(css).toContain('100% {');
    expect(css).toContain('left: 0px');
    expect(css).toContain('left: 100px');
    // the rule that drives the layer, addressed the way the canvas addresses it
    expect(css).toContain('[data-canvas-root] div[data-node-id="box"]');
    expect(css).toContain(`animation-name: pl-motion-${track.id};`);
    expect(css).toContain('animation-duration: 1000ms;');
    expect(css).toContain('animation-fill-mode: both;');
  });

  test('every property lands on the CSS the canvas already styles with', () => {
    const { doc } = scene();
    const spec = timeline([
      newTrack('box', 'x', [newKeyframe(0, 5)]),
      newTrack('box', 'y', [newKeyframe(0, 6)]),
      newTrack('box', 'w', [newKeyframe(0, 7)]),
      newTrack('box', 'h', [newKeyframe(0, 8)]),
      newTrack('box', 'rotation', [newKeyframe(0, 45)]),
      newTrack('box', 'opacity', [newKeyframe(0, 0.5)]),
      newTrack('box', 'radius', [newKeyframe(0, 9)]),
      newTrack('box', 'fill', [newKeyframe(0, '#123456')]),
    ]);
    const css = motionCss(spec, doc, { scope: '#stage' });
    for (const declaration of [
      'left: 5px',
      'top: 6px',
      'width: 7px',
      'height: 8px',
      'transform: rotate(45deg)',
      'opacity: 0.5',
      'border-radius: 9px',
      'background-color: #123456',
    ]) {
      expect(css).toContain(declaration);
    }
    // eight tracks, one animation each, all on the one layer
    expect(css.match(/@keyframes /g)).toHaveLength(8);
    expect(css.match(/#stage div\[data-node-id="box"\]/g)).toHaveLength(1);
    expect(css.match(/animation-name: [^;]+;/)![0].split(',')).toHaveLength(8);
  });

  test("a shape's colour is animated on the layer that paints it", () => {
    const { doc } = scene();
    // a star paints through a clipped layer inside its box, so animating the
    // box's background would colour a rectangle nobody can see
    doc.star = makeNode('star', 'star', 'board', { name: 'Star', x: 0, y: 0, w: 50, h: 50, fill: '#ff0000' });
    doc.board = { ...doc.board, children: [...doc.board.children, 'star'] };
    expect(targetOf(doc.star, 'fill')).toBe('paint');
    expect(targetOf(doc.star, 'x')).toBe('box');
    expect(targetOf(doc.box, 'fill')).toBe('box');

    const css = motionCss(
      timeline([
        newTrack('star', 'fill', [newKeyframe(0, '#ff0000'), newKeyframe(500, '#00ff00')]),
        newTrack('star', 'x', [newKeyframe(0, 0), newKeyframe(500, 40)]),
      ]),
      doc,
      { scope: '#stage' },
    );
    // the fill lands on the clipped layer, the position on the box
    expect(css).toContain('#stage div[data-node-id="star"] [data-paint="star"] {');
    expect(css).toMatch(/#stage div\[data-node-id="star"\] \{/);
  });

  test('a fill CSS cannot tween is refused rather than animated silently', () => {
    const { doc, box } = scene();
    expect(animatable(box, 'fill')).toBe(true);
    expect(animatable(box, 'x')).toBe(true);

    // a gradient has no interpolation in CSS
    expect(animatable({ ...box, fill: 'linear-gradient(#fff, #000)' }, 'fill')).toBe(false);
    // nor does a stack of paints, which composes into layers over the colour
    expect(
      animatable(
        {
          ...box,
          fills: [
            { id: 'a', value: '#fff', opacity: 1, visible: true },
            { id: 'b', value: '#000', opacity: 1, visible: true },
          ],
        },
        'fill',
      ),
    ).toBe(false);
    // a boolean group paints through nested clips, with no one element to name
    expect(animatable({ ...box, type: 'boolean' }, 'fill')).toBe(false);
  });

  test('a property that cannot be animated says why, and not why some other one cannot', () => {
    const { box } = scene();
    // the reason a chip is grey is one of five, and they used to share one
    // sentence — the fill's — however the chip came to be grey
    expect(whyNot(box, 'x')).toBeNull();
    expect(whyNot(box, 'strokeWidth')).toMatch(/no stroke/);
    const stroked = { ...box, border: { width: 2, color: '#f00', style: 'solid', position: 'inside' } } as const;
    expect(whyNot({ ...stroked, type: 'boolean' }, 'strokeColor')).toMatch(/SVG/);
    expect(
      whyNot(
        {
          ...box,
          border: { width: 2, color: '#f00', style: 'solid', position: 'inside', sides: [1, 1, 1, 1] },
        },
        'strokeWidth',
      ),
    ).toMatch(/individual stroke sides/);
    expect(whyNot({ ...box, effects: [{ id: 'e', type: 'drop-shadow' }] as never }, 'blur')).toMatch(
      /layer blur in Effects/,
    );
    expect(whyNot({ ...box, fill: 'linear-gradient(#fff, #000)' }, 'fill')).toMatch(/gradients/);
    expect(whyNot({ ...box, type: 'boolean' }, 'fill')).toMatch(/nested clips/);
  });

  test('a stroke animates as whatever CSS the layer draws it with', () => {
    const { doc } = scene();
    doc.box = {
      ...doc.box,
      border: { width: 2, color: '#ff0000', style: 'solid', position: 'inside' },
    };
    expect(designValue(doc.box, 'strokeWidth')).toBe(2);
    expect(designValue(doc.box, 'strokeColor')).toBe('#ff0000');

    const css = motionCss(
      timeline([
        newTrack('box', 'strokeWidth', [newKeyframe(0, 2), newKeyframe(500, 10)]),
        newTrack('box', 'strokeColor', [newKeyframe(0, '#ff0000'), newKeyframe(500, '#0000ff')]),
      ]),
      doc,
      { scope: '#s' },
    );
    // an inside stroke on a box is a ring inside `box-shadow`, and that is
    // exactly what the keyframes carry — not a border the canvas never drew
    expect(css).toContain('box-shadow: inset 0 0 0 2px #ff0000');
    expect(css).toContain('box-shadow: inset 0 0 0 10px #0000ff');

    // The weight and the colour are two tracks and one `box-shadow`, so they
    // compile to ONE animation carrying both. Two would not combine: CSS gives
    // the property to the last animation that names it, and the other track
    // would silently do nothing.
    expect(css.match(/@keyframes /g)).toHaveLength(1);

    // four real sides are the other shape a stroke takes: there the weight is
    // not one number any more, so the panel offers the colour and not the
    // width — the same trade Figma's individual strokes make
    const sided = {
      ...doc.box,
      border: { ...doc.box.border!, sides: [1, 1, 1, 1] as [number, number, number, number] },
    };
    expect(animatable(sided, 'strokeWidth')).toBe(false);
    expect(animatable(sided, 'strokeColor')).toBe(true);
    const sidedCss = motionCss(
      timeline([newTrack('box', 'strokeColor', [newKeyframe(0, '#ff0000'), newKeyframe(500, '#0000ff')])]),
      { ...doc, box: sided },
      { scope: '#s' },
    );
    expect(sidedCss).toContain('border-color: #0000ff');
    expect(sidedCss).toContain('border-top-width: 1px');
  });

  test('a blur animates wherever the layer keeps it', () => {
    const { doc } = scene();
    // the older shape: a `filters` block with no effects list
    const withFilters = {
      ...doc,
      box: {
        ...doc.box,
        filters: { blur: 0, backdropBlur: 0, brightness: 1, contrast: 1, saturate: 1, grayscale: 0, hueRotate: 0 },
      },
    };
    expect(designValue(withFilters.box, 'blur')).toBe(0);
    const css = motionCss(
      timeline([newTrack('box', 'blur', [newKeyframe(0, 0), newKeyframe(500, 12)])]),
      withFilters,
      { scope: '#s' },
    );
    expect(css).toContain('filter: blur(12px)');
    // and the keyframe that has none says so, rather than leaving CSS to
    // invent a starting point out of the element
    expect(css).toContain('filter: none');

    // a layer with an effects list is described by that list alone
    const listed = {
      ...doc.box,
      effects: [{ ...newBlurEffect(), blur: 4 }],
    };
    expect(designValue(listed, 'blur')).toBe(4);
    expect(animatable(listed, 'blur')).toBe(true);
    expect(animatable({ ...doc.box, effects: [{ ...newBlurEffect(), type: 'drop-shadow' as const }] }, 'blur')).toBe(false);
    expect(motionCss(
      timeline([newTrack('box', 'blur', [newKeyframe(0, 4), newKeyframe(500, 20)])]),
      { ...doc, box: listed },
      { scope: '#s' },
    )).toContain('filter: blur(20px)');
  });

  test('the nested three are read and written through the layer', () => {
    const { doc } = scene();
    const bordered = {
      ...doc.box,
      border: { width: 3, color: '#123456', style: 'solid' as const, position: 'center' as const },
    };
    // a patch of a stroke is the whole spec with one field changed
    expect(asPatch('strokeWidth', 8, bordered).border).toEqual({ ...bordered.border, width: 8 });
    expect(asPatch('strokeColor', '#fff', bordered).border!.color).toBe('#fff');
    // and with no layer to write through, nothing is written
    expect(asPatch('strokeWidth', 8)).toEqual({});
    // a recording reads them back out of the patch it just saw
    expect(valueIn({ border: { ...bordered.border, width: 8 } }, 'strokeWidth')).toBe(8);
    expect(propertiesIn({ border: { ...bordered.border, width: 8 } })).toEqual([
      'strokeWidth',
      'strokeColor',
    ]);
    // a layer with no stroke has nothing to animate, and the panel says so
    expect(animatable(doc.box, 'strokeWidth')).toBe(false);
    expect(animatable(bordered, 'strokeWidth')).toBe(true);
  });

  test('a rotating layer keeps the flips it was already wearing', () => {
    const { doc } = scene();
    doc.box = { ...doc.box, flipH: true, flipV: true };
    const css = motionCss(timeline([newTrack('box', 'rotation', [newKeyframe(0, 90)])]), doc, {
      scope: '#stage',
    });
    expect(css).toContain('transform: rotate(90deg) scaleX(-1) scaleY(-1)');
  });

  test('each keyframe carries its own curve into the block it starts', () => {
    const { doc } = scene();
    const spec = timeline([
      newTrack('box', 'x', [
        newKeyframe(0, 0, { easing: 'ease-in-back' }),
        newKeyframe(500, 100, { easing: 'bouncy' }),
        newKeyframe(1000, 0, { easing: 'linear' }),
      ]),
    ]);
    const css = motionCss(spec, doc, { scope: '#stage' });
    expect(css).toContain('animation-timing-function: cubic-bezier(0.36, 0, 0.66, -0.56)');
    // a spring is not a curve CSS has, so it is sampled — and over the segment
    // it actually crosses rather than over the whole timeline
    expect(css).toContain('animation-timing-function: linear(');
    // the last key has nothing after it, so it declares no curve
    expect(css.match(/animation-timing-function: /g)).toHaveLength(3);
  });

  test('a track keyed only in the middle holds its ends, as the sampler does', () => {
    const { doc } = scene();
    // the layer's own x is 10; the track says 80 from 400ms and 20 at 800ms
    const track = newTrack('box', 'x', [
      newKeyframe(400, 80, { easing: 'linear' }),
      newKeyframe(800, 20),
    ]);
    const spec = timeline([track], { duration: 1000 });
    const css = motionCss(spec, doc, { scope: '#s' });

    // CSS would otherwise synthesise 0% and 100% from the element's own style
    // and tween 10px into 80px, which is not what the timeline says at all
    expect(css).toContain('0% {\n    left: 80px;');
    expect(css).toContain('100% {\n    left: 20px;');
    expect(valueAt(track, 0)).toBe(80);
    expect(valueAt(track, 1000)).toBe(20);

    // and a track that already covers both ends gains no extra stops
    const full = timeline(
      [newTrack('box', 'y', [newKeyframe(0, 0), newKeyframe(1000, 50)])],
      { duration: 1000 },
    );
    expect(motionCss(full, doc, { scope: '#s' }).match(/% \{/g)).toHaveLength(2);
  });

  test('a single key holds for the whole timeline', () => {
    const { doc } = scene();
    const spec = timeline([newTrack('box', 'opacity', [newKeyframe(500, 0.25)])], { duration: 1000 });
    const css = motionCss(spec, doc, { scope: '#s' });
    expect(css.match(/opacity: 0\.25/g)).toHaveLength(3);
    expect(valueAt(spec.tracks[0], 0)).toBe(0.25);
    expect(valueAt(spec.tracks[0], 1000)).toBe(0.25);
  });

  test('scrubbing is a negative delay on a paused animation', () => {
    const { doc } = scene();
    const spec = timeline([newTrack('box', 'x', [newKeyframe(0, 0), newKeyframe(1000, 100)])]);

    const scrubbed = motionCss(spec, doc, { scope: '#stage', at: 350 });
    expect(scrubbed).toContain('animation-delay: -350ms;');
    expect(scrubbed).toContain('animation-play-state: paused;');

    const running = motionCss(spec, doc, { scope: '#stage', at: 0, playing: true });
    expect(running).toContain('animation-play-state: running;');
    expect(running).toContain('animation-delay: 0ms;');
  });

  test('loop is the timeline\'s while it plays, unless the caller overrides it', () => {
    const { doc } = scene();
    const tracks = [newTrack('box', 'x', [newKeyframe(0, 0)])];
    const playing = { scope: '#s', playing: true };
    expect(motionCss(timeline(tracks, { loop: true }), doc, playing)).toContain(
      'animation-iteration-count: infinite;',
    );
    expect(motionCss(timeline(tracks, { loop: false }), doc, playing)).toContain(
      'animation-iteration-count: 1;',
    );
    expect(motionCss(timeline(tracks, { loop: false }), doc, { ...playing, loop: true })).toContain(
      'animation-iteration-count: infinite;',
    );
  });

  test('a scrub does not loop, so the end of the timeline reads as its last key', () => {
    const { doc } = scene();
    const spec = timeline(
      [newTrack('box', 'x', [newKeyframe(0, 0), newKeyframe(1000, 200)])],
      { duration: 1000, loop: true },
    );
    // paused at the very end: one iteration, held by `fill-mode: both`, which
    // is the last keyframe rather than the first frame of the next lap
    const css = motionCss(spec, doc, { scope: '#s', at: 1000 });
    expect(css).toContain('animation-iteration-count: 1;');
    expect(css).toContain('animation-delay: -1000ms;');
    expect(valueAt(spec.tracks[0], 1000)).toBe(200);
  });

  test('nothing to say, nothing emitted', () => {
    const { doc } = scene();
    expect(motionCss(null, doc, { scope: '#s' })).toBe('');
    expect(motionCss(timeline([]), doc, { scope: '#s' })).toBe('');
    // a track whose layer has gone is skipped rather than emitted against nothing
    expect(motionCss(timeline([newTrack('ghost', 'x', [newKeyframe(0, 1)])]), doc, { scope: '#s' })).toBe('');
  });

  test('the compiled percentages agree with what the sampler says', () => {
    const { doc } = scene();
    const spec = timeline(
      [newTrack('box', 'x', [newKeyframe(0, 0, { easing: 'linear' }), newKeyframe(800, 80)])],
      { duration: 1000 },
    );
    const css = motionCss(spec, doc, { scope: '#s' });
    // 800ms of a 1000ms timeline is 80% of the way along it
    expect(css).toContain('80% {');
    expect(valueAt(spec.tracks[0], 800)).toBe(80);
  });
});

test.describe('carried out by the export', () => {
  const animated = (): { doc: Doc; spec: MotionSpec } => {
    const { doc } = scene();
    const spec = timeline(
      [
        newTrack('box', 'x', [newKeyframe(0, 0, { easing: 'linear' }), newKeyframe(1000, 200)]),
        newTrack('box', 'opacity', [newKeyframe(0, 0, { easing: 'linear' }), newKeyframe(1000, 1)]),
      ],
      { duration: 1200, loop: true },
    );
    doc.board = { ...doc.board, motion: spec };
    return { doc, spec };
  };

  test('React comes out animating, with no runtime behind it', () => {
    const { doc, spec } = animated();
    const { css, markup } = toReact('board', doc);
    expect(css).toContain(`@keyframes pl-motion-${spec.tracks[0].id}`);
    // addressed by the class the export gave the layer, not by a node id
    expect(css).toMatch(/\.box-[a-z0-9]+ \{\n  animation-name/);
    expect(css).toContain('animation-duration: 1200ms, 1200ms;');
    expect(css).toContain('animation-play-state: running;');
    // and it is a stylesheet, not a script
    expect(markup).not.toContain('requestAnimationFrame');
  });

  test('HTML marks the layers the timeline drives and names them in the head', () => {
    const { doc } = animated();
    const html = toHtml('board', doc);
    expect(html).toContain('data-motion="box"');
    expect(html).toContain('[data-motion="box"] {');
    expect(html).toContain('@keyframes pl-motion-');
    expect(html).toContain('animation-play-state: running;');
  });

  test('the exported page really animates, in a real browser', async ({ page }) => {
    const { doc } = animated();
    await page.setContent(toHtml('board', doc));

    const el = page.locator('[data-motion="box"]');
    await expect(el).toBeVisible();

    // the browser is running the animations the export declared — two of them,
    // one per track, with nothing else on the page to run them
    const running = await el.evaluate((node) => node.getAnimations().map((a) => a.playState));
    expect(running).toEqual(['running', 'running']);

    // and it is actually moving: two readings, a moment apart, differ
    const first = await el.evaluate((node) => getComputedStyle(node).left);
    await page.waitForTimeout(250);
    const second = await el.evaluate((node) => getComputedStyle(node).left);
    expect(first).not.toBe(second);
  });

  test('a board with animated boards inside it exports all of their timelines', () => {
    const { doc } = scene();
    // a second board nested in the first, with a timeline of its own
    doc.inner = makeNode('inner', 'frame', 'board', { name: 'Inner', x: 20, y: 20, w: 100, h: 80 });
    doc.chip = makeNode('chip', 'rect', 'inner', { name: 'Chip', x: 0, y: 0, w: 20, h: 20 });
    doc.inner = { ...doc.inner, children: ['chip'] };
    doc.board = { ...doc.board, children: [...doc.board.children, 'inner'] };
    doc.inner = {
      ...doc.inner,
      motion: timeline([newTrack('chip', 'opacity', [newKeyframe(0, 0), newKeyframe(400, 1)])], {
        duration: 800,
      }),
    };

    const { css } = toReact('board', doc);
    expect(css).toContain('@keyframes pl-motion-');
    expect(css).toContain('animation-duration: 800ms;');
    expect(toHtml('board', doc)).toContain('data-motion="chip"');
  });

  test('a frame with no timeline exports exactly as it did before', () => {
    const { doc } = scene();
    expect(toReact('board', doc).css).not.toContain('@keyframes pl-motion');
    expect(toHtml('board', doc)).not.toContain('data-motion=');
  });
});
