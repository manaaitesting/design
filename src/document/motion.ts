/**
 * Motion — a timeline on a frame, compiled to CSS.
 *
 * A track says how one property of one layer changes over the frame's
 * duration; a keyframe pins that property to a value at a moment and says how
 * the curve leaves it. That is Figma Motion's model.
 *
 * What makes it this canvas's is where the interpolation happens: nowhere in
 * here. `keyframesCss` turns the tracks into real `@keyframes` and the browser
 * does the rest — which is why scrubbing is a negative `animation-delay` on a
 * paused animation rather than a frame loop pushing styles at React, and why
 * an exported component animates with no runtime behind it. The animation is
 * not a preview of the design; it is the design, in the same way `nodeStyle`
 * is.
 *
 * `sampleAt` exists for the other half of that: the panel's readouts and the
 * tests need to ask what a timeline says at 350ms with no DOM in the room.
 * It walks the same tracks with the same easing, so the two agree.
 */

import { easeAt, easingCss } from './prototype';
import { newId } from '../lib/id';
import { needsPaintLayers, nodeStyle, withAlpha } from './css';
import { paintsWithPath } from './geometry';
import type {
  Doc,
  Easing,
  Effect,
  Keyframe,
  MotionProperty,
  MotionSpec,
  MotionTrack,
  SceneNode,
} from './types';

/** A second, which is what Figma opens a new timeline at. */
export const DEFAULT_DURATION = 1000;

/** The shortest and longest timeline the panel will let you build. */
export const MIN_DURATION = 100;
export const MAX_DURATION = 60_000;

export function newMotion(patch: Partial<MotionSpec> = {}): MotionSpec {
  return { duration: DEFAULT_DURATION, loop: true, tracks: [], ...patch };
}

export function motionOf(node: SceneNode | undefined): MotionSpec | null {
  const motion = node?.motion;
  return motion && motion.tracks ? motion : null;
}

/** A timeline with at least one key in it — the only kind worth compiling. */
export function hasMotion(node: SceneNode | undefined): boolean {
  return !!motionOf(node)?.tracks.some((track) => track.keys.length > 0);
}

// ── The properties a track can drive ─────────────────────────────────────

export interface PropertyInfo {
  /** what the panel calls it */
  label: string;
  /** a number, an angle in degrees, or a colour */
  kind: 'number' | 'angle' | 'ratio' | 'color';
  /** what it is called in the field it comes from */
  suffix?: string;
  min?: number;
  max?: number;
}

/**
 * The properties a timeline can animate, in the order the panel lists them.
 *
 * Every one of them is something `nodeStyle` already writes and CSS already
 * interpolates — the constraint that keeps the compiler honest. The last three
 * do not sit on the node as a plain field: a stroke is a `BorderSpec` and a
 * blur is an effect, so they are read and written through the node rather than
 * off it, and the CSS for them is asked of `nodeStyle` rather than spelled out
 * here. A gradient fill has no interpolation in CSS at all, so `fill` steps
 * between gradients and tweens between colours; `valueAt` says the same thing.
 */
export const PROPERTIES: Record<MotionProperty, PropertyInfo> = {
  x: { label: 'X', kind: 'number' },
  y: { label: 'Y', kind: 'number' },
  w: { label: 'Width', kind: 'number', min: 0 },
  h: { label: 'Height', kind: 'number', min: 0 },
  rotation: { label: 'Rotation', kind: 'angle', suffix: '°' },
  opacity: { label: 'Opacity', kind: 'ratio', min: 0, max: 1 },
  radius: { label: 'Corner radius', kind: 'number', min: 0 },
  fill: { label: 'Fill', kind: 'color' },
  strokeWidth: { label: 'Stroke', kind: 'number', min: 0 },
  strokeColor: { label: 'Stroke colour', kind: 'color' },
  blur: { label: 'Blur', kind: 'number', min: 0 },
};

export const PROPERTY_ORDER = Object.keys(PROPERTIES) as MotionProperty[];

/**
 * Where this layer keeps its layer blur, and how much of it there is.
 *
 * A document written before the Effects list keeps it in `filters.blur`, and
 * `effectsOf` reads that back out as an entry — but a layer that *has* an
 * effects list is described by that list alone, so a blur track has to write
 * wherever the layer is actually reading from.
 */
function blurEffect(node: SceneNode): Effect | undefined {
  return node.effects?.find((effect) => effect.type === 'layer-blur');
}

function layerBlur(node: SceneNode): number {
  const effect = blurEffect(node);
  if (effect) return effect.visible === false ? 0 : effect.blur;
  return node.effects?.length ? 0 : (node.filters?.blur ?? 0);
}

/** What the layer holds for this property right now — the value a new key takes. */
export function designValue(node: SceneNode, property: MotionProperty): number | string {
  switch (property) {
    case 'x':
      return node.x;
    case 'y':
      return node.y;
    case 'w':
      return node.w;
    case 'h':
      return node.h;
    case 'rotation':
      return node.rotation ?? 0;
    case 'opacity':
      return node.opacity ?? 1;
    case 'radius':
      return node.radius ?? 0;
    case 'fill':
      return node.fill ?? '#000000';
    case 'strokeWidth':
      return node.border?.width ?? 0;
    case 'strokeColor':
      return node.border?.color ?? '#000000';
    case 'blur':
      return layerBlur(node);
  }
}

/**
 * Whether a property can actually be animated on this layer.
 *
 * `fill` is the only one that has to ask. A layer's colour is usually its
 * `background`, which CSS interpolates — but a paint *stack* composes into
 * gradient layers that paint over that colour, an image paint moves onto an
 * element of its own, and a boolean group paints through nested clips with no
 * single element to name. In each of those the animation would run and nothing
 * would change, which is worse than the panel saying so.
 */
export function animatable(node: SceneNode, property: MotionProperty): boolean {
  if (property === 'strokeWidth' || property === 'strokeColor') {
    // a shape's stroke is an SVG element with its own attributes rather than
    // CSS on the box, and a layer with no stroke has nothing to animate
    if (!node.border || paintsWithPath(node) || node.type === 'boolean') return false;
    // individual strokes replace the one weight with four, in the panel and in
    // the CSS alike — so the one weight is no longer what is being drawn
    return property === 'strokeColor' || !node.border.sides;
  }
  if (property === 'blur') {
    // a layer described by an effects list is described by it alone, so a blur
    // track needs an entry there to write into
    return !node.effects?.length || node.effects.some((effect) => effect.type === 'layer-blur');
  }
  if (property !== 'fill') return true;
  if (node.type === 'boolean' || needsPaintLayers(node)) return false;
  const stack = (node.fills ?? []).filter((paint) => paint.visible !== false && paint.value);
  if (stack.length > 1) return false;
  const value = stack[0]?.value ?? node.fill ?? '';
  return !/gradient\(|^url\(/.test(value);
}

/**
 * Which element a property has to be animated on.
 *
 * Almost everything belongs to the layer's own box. A shape's colour does not:
 * a star, a pen path or an arc paints through a clipped layer *inside* the
 * box, so that is where a fill track lands — `data-paint` on that element is
 * how both the canvas and the export let it be named.
 */
export function targetOf(node: SceneNode, property: MotionProperty): 'box' | 'paint' {
  return property === 'fill' && paintsWithPath(node) ? 'paint' : 'box';
}

/**
 * The patch that writing this value onto the layer would be.
 *
 * The three that live inside something else — a stroke's weight and colour, a
 * blur — need the layer to write through, because a patch of a `BorderSpec` is
 * the whole spec with one field changed. Without one they write nothing rather
 * than writing a half-formed object.
 */
export function asPatch(
  property: MotionProperty,
  value: number | string,
  node?: SceneNode,
): Partial<SceneNode> {
  switch (property) {
    case 'fill':
      return { fill: String(value) };
    case 'strokeColor':
      return node?.border ? { border: { ...node.border, color: String(value) } } : {};
    case 'strokeWidth':
      return node?.border ? { border: { ...node.border, width: Number(value) } } : {};
    case 'blur': {
      if (!node) return {};
      const effect = blurEffect(node);
      if (effect) {
        return {
          effects: node.effects!.map((entry) =>
            entry.id === effect.id ? { ...entry, blur: Number(value) } : entry,
          ),
        };
      }
      if (node.effects?.length) return {};
      return { filters: { ...(node.filters ?? DEFAULT_FILTERS), blur: Number(value) } };
    }
    default:
      return { [property]: Number(value) } as Partial<SceneNode>;
  }
}

/** What a patch says this property is now, or undefined when it says nothing. */
export function valueIn(
  patch: Partial<SceneNode>,
  property: MotionProperty,
): number | string | undefined {
  switch (property) {
    case 'strokeWidth':
      return patch.border?.width;
    case 'strokeColor':
      return patch.border?.color;
    case 'blur':
      return (
        patch.effects?.find((effect) => effect.type === 'layer-blur')?.blur ?? patch.filters?.blur
      );
    default:
      return patch[property] as number | string | undefined;
  }
}

/** The properties a patch touches, so a recording knows what to keyframe. */
export function propertiesIn(patch: Partial<SceneNode>): MotionProperty[] {
  return PROPERTY_ORDER.filter((property) => valueIn(patch, property) !== undefined);
}

/** What `filters` is when a layer has never had any — the identity, plus no blur. */
const DEFAULT_FILTERS = {
  blur: 0,
  backdropBlur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  grayscale: 0,
  hueRotate: 0,
};

// ── Building ─────────────────────────────────────────────────────────────

export function newKeyframe(at: number, value: number | string, patch: Partial<Keyframe> = {}): Keyframe {
  return { id: newId(), at: Math.max(0, Math.round(at)), value, easing: 'ease-out', ...patch };
}

export function newTrack(node: string, property: MotionProperty, keys: Keyframe[] = []): MotionTrack {
  return { id: newId(), node, property, keys: sortKeys(keys) };
}

/** Time order, which everything downstream assumes and nothing else enforces. */
export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.at - b.at);
}

export function trackFor(
  spec: MotionSpec | null,
  node: string,
  property: MotionProperty,
): MotionTrack | undefined {
  return spec?.tracks.find((track) => track.node === node && track.property === property);
}

/** Every track on one layer, in the panel's property order. */
export function tracksOf(spec: MotionSpec | null, node: string): MotionTrack[] {
  const mine = spec?.tracks.filter((track) => track.node === node) ?? [];
  return mine.sort(
    (a, b) => PROPERTY_ORDER.indexOf(a.property) - PROPERTY_ORDER.indexOf(b.property),
  );
}

/**
 * The same timeline, pointing at the copies rather than at the originals.
 *
 * A duplicated board must animate *its* layers. Nothing else in the document
 * refers to a layer by id from inside another layer's own data, which is why
 * this is the one thing a copy has to rewrite — without it a duplicate would
 * quietly drive the layers it was copied from. The tracks and keys are given
 * fresh ids too: their ids become `@keyframes` names, and two timelines in one
 * stylesheet must not share one.
 */
export function remapMotion(spec: MotionSpec | null | undefined, ids: Map<string, string>): MotionSpec | null {
  if (!spec) return null;
  const tracks = spec.tracks
    .filter((track) => ids.has(track.node))
    .map((track) => ({
      ...track,
      id: newId(),
      node: ids.get(track.node)!,
      keys: track.keys.map((key) => ({ ...key, id: newId() })),
    }));
  return { ...spec, tracks };
}

/** Everything inside a frame, in the order the layer tree reads. */
export function layersIn(doc: Doc, frame: string): string[] {
  const order: string[] = [];
  const walk = (id: string): void => {
    for (const child of doc[id]?.children ?? []) {
      order.push(child);
      walk(child);
    }
  };
  walk(frame);
  return order;
}

/**
 * Every timeline inside a subtree, the root's own included.
 *
 * An export is of a subtree, and a subtree can hold more than one board — so
 * asking only the root what it animates loses the timeline on a frame nested
 * inside it, which is exactly the shape a "screens" board has.
 */
export function timelinesIn(doc: Doc, root: string): MotionSpec[] {
  const out: MotionSpec[] = [];
  const walk = (id: string): void => {
    const spec = motionOf(doc[id]);
    if (spec?.tracks.length) out.push(spec);
    for (const child of doc[id]?.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** The layers a timeline touches, in that same order. */
export function animatedNodes(spec: MotionSpec | null, doc: Doc, frame: string): string[] {
  const touched = new Set(spec?.tracks.map((track) => track.node) ?? []);
  // a track whose layer has been deleted is not drawn, but it is not dropped
  // either: the layer may come back with an undo
  return layersIn(doc, frame).filter((id) => touched.has(id));
}

// ── Colour ───────────────────────────────────────────────────────────────

type Rgba = [number, number, number, number];

/**
 * A colour as four numbers, or null when it is something CSS cannot tween —
 * a gradient, a shader preset, `transparent`.
 */
export function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const digits = hex[1];
    const wide = digits.length > 4;
    const size = wide ? 2 : 1;
    const part = (index: number): number => {
      const slice = digits.slice(index * size, index * size + size);
      if (!slice) return index === 3 ? 255 : 0;
      const n = parseInt(wide ? slice : slice + slice, 16);
      return Number.isFinite(n) ? n : 0;
    };
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
      return null;
    }
    const alpha = digits.length === 4 || digits.length === 8 ? part(3) / 255 : 1;
    return [part(0), part(1), part(2), alpha];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
  }
  return null;
}

function formatColor([r, g, b, a]: Rgba): string {
  const channel = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
  if (a >= 1) {
    return `#${[r, g, b].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Number(a.toFixed(3))})`;
}

/**
 * Two colours, mixed.
 *
 * Straight down the RGB channels, which is what CSS does between two colours
 * in the same space — the point is to agree with the browser, not to be
 * prettier than it. Anything unparseable steps at the halfway mark rather than
 * inventing a blend.
 */
export function mixColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 1 ? from : to;
  return formatColor(a.map((channel, i) => channel + (b[i] - channel) * t) as Rgba);
}

// ── Sampling ─────────────────────────────────────────────────────────────

/**
 * What a track reads at `at`.
 *
 * Before the first key and after the last one the value is held, which is both
 * what Figma does and what CSS does with a property that is only named on some
 * of an animation's keyframes — so the panel and the canvas cannot disagree.
 */
export function valueAt(track: MotionTrack, at: number): number | string | undefined {
  const keys = track.keys;
  if (!keys.length) return undefined;
  if (at <= keys[0].at) return keys[0].value;
  const last = keys[keys.length - 1];
  if (at >= last.at) return last.value;

  let index = 0;
  while (index < keys.length - 1 && keys[index + 1].at <= at) index++;
  const from = keys[index];
  const to = keys[index + 1];
  const span = Math.max(1, to.at - from.at);
  const progress = easeAt({ ...from, duration: span }, (at - from.at) / span);

  if (PROPERTIES[track.property].kind === 'color') {
    return mixColor(String(from.value), String(to.value), progress);
  }
  return Number(from.value) + (Number(to.value) - Number(from.value)) * progress;
}

/**
 * The whole timeline at one moment, as patches onto the layers it drives.
 *
 * This is the model's own answer, and it is the one the tests ask for. The
 * canvas asks the browser instead — see `keyframesCss`.
 */
export function sampleAt(spec: MotionSpec | null, at: number): Record<string, Partial<SceneNode>> {
  const out: Record<string, Partial<SceneNode>> = {};
  for (const track of spec?.tracks ?? []) {
    const value = valueAt(track, at);
    if (value === undefined) continue;
    out[track.node] = { ...out[track.node], ...asPatch(track.property, value) };
  }
  return out;
}

/** The document as the timeline has it at `at` — what a scrubbed canvas shows. */
export function docAt(doc: Doc, spec: MotionSpec | null, at: number): Doc {
  const patches = sampleAt(spec, at);
  if (!Object.keys(patches).length) return doc;
  const out: Doc = { ...doc };
  for (const [id, patch] of Object.entries(patches)) {
    if (out[id]) out[id] = { ...out[id], ...patch };
  }
  return out;
}

// ── Compiling to CSS ─────────────────────────────────────────────────────

/**
 * The declaration a property becomes.
 *
 * These are the same properties `nodeStyle` writes, which is what makes the
 * animation land on the design rather than beside it: an animated `left` is
 * the same `left` the layer was positioned with. Rotation is the exception
 * worth naming — it shares `transform` with the flips, so the flips have to be
 * carried along or a rotating layer would un-mirror itself.
 */
function declaration(node: SceneNode, property: MotionProperty, value: number | string): string {
  switch (property) {
    case 'x':
      return `left: ${Number(value)}px`;
    case 'y':
      return `top: ${Number(value)}px`;
    case 'w':
      return `width: ${Number(value)}px`;
    case 'h':
      return `height: ${Number(value)}px`;
    case 'opacity':
      return `opacity: ${Number(value)}`;
    case 'radius':
      return `border-radius: ${Number(value)}px`;
    case 'rotation': {
      const parts = [`rotate(${Number(value)}deg)`];
      if (node.flipH) parts.push('scaleX(-1)');
      if (node.flipV) parts.push('scaleY(-1)');
      return `transform: ${parts.join(' ')}`;
    }
    case 'fill':
      // `nodeStyle` paints through the `background` shorthand, which sets
      // background-color among the rest; animating the longhand overrides
      // exactly that part of it and leaves an image or gradient underneath
      // alone.
      return `background-color: ${withAlpha(String(value), node.fillOpacity ?? 1)}`;
    // the three that are not a field on the node have no one declaration of
    // their own: `writerFor` asks `nodeStyle` what they become
    case 'strokeWidth':
    case 'strokeColor':
    case 'blur':
      return '';
  }
}

/** The CSS a stroke lands on — a ring in `box-shadow`, or real border sides. */
const STROKE_KEYS = [
  'boxShadow',
  'border',
  'borderStyle',
  'borderColor',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const;

/** What a keyframe declares when the property is simply absent from its style. */
const ABSENT: Record<string, string> = { boxShadow: 'none', filter: 'none', border: 'none' };

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const cssValue = (value: string | number): string =>
  typeof value === 'number' ? `${value}px` : String(value);

/**
 * The CSS a property lands on.
 *
 * Tracks that share one have to be compiled together: two animations naming
 * the same property do not combine — the last one named simply wins — so a
 * stroke's weight and its colour, which are two tracks and one `box-shadow`,
 * would silently cancel each other out. This is the map that stops that.
 */
function channelOf(property: MotionProperty): string {
  switch (property) {
    case 'x':
      return 'left';
    case 'y':
      return 'top';
    case 'w':
      return 'width';
    case 'h':
      return 'height';
    case 'rotation':
      return 'transform';
    case 'opacity':
      return 'opacity';
    case 'radius':
      return 'border-radius';
    case 'fill':
      return 'background-color';
    case 'strokeWidth':
    case 'strokeColor':
      return 'stroke';
    case 'blur':
      return 'filter';
  }
}

/**
 * How a channel's value at a moment is written.
 *
 * Most channels are one property and one declaration, and always the same
 * one. A stroke and a blur are not: what CSS they become depends on the layer
 * — a ring inside `box-shadow`, four real border widths, a `filter` chain
 * shared with the effects — so those are asked of `nodeStyle`, with the values
 * of every track in the channel written onto a copy of the layer. That is the
 * same function the canvas painted with, which is what keeps an animated
 * stroke identical to a stroke you typed.
 *
 * Every stop of one animation declares the *same* CSS properties, even where
 * a value would have left one out. A property named on some keyframes and not
 * others is one CSS fills in from the element itself, which is the one way
 * this compiler could come to disagree with `valueAt`.
 */
function writerFor(
  node: SceneNode,
  doc: Doc,
  tracks: MotionTrack[],
  duration: number,
): (ms: number) => string {
  const channel = channelOf(tracks[0].property);
  if (channel !== 'stroke' && channel !== 'filter') {
    return (ms) =>
      tracks
        .map((track) => {
          const value = valueAt(track, ms);
          return value === undefined ? '' : declaration(node, track.property, value);
        })
        .filter(Boolean)
        .join('; ');
  }

  const keys: readonly string[] = channel === 'filter' ? ['filter'] : STROKE_KEYS;
  const styleAt = (ms: number) => {
    let patched = node;
    for (const track of tracks) {
      const value = valueAt(track, ms);
      if (value !== undefined) patched = { ...patched, ...asPatch(track.property, value, patched) };
    }
    return nodeStyle(patched, doc) as Record<string, string | number | undefined>;
  };

  const moments = [0, ...tracks.flatMap((track) => track.keys.map((key) => key.at)), duration];
  const samples = moments.map(styleAt);
  const present = keys.filter((key) => samples.some((style) => style[key] !== undefined));
  return (ms) => {
    const style = styleAt(ms);
    return present
      .map((key) => {
        const held = style[key];
        return `${kebab(key)}: ${held === undefined ? (ABSENT[key] ?? 'initial') : cssValue(held)}`;
      })
      .join('; ');
  };
}

/** The CSS name for a track's `@keyframes`, unique per track and a valid ident. */
export function keyframesName(track: MotionTrack): string {
  return `pl-motion-${track.id}`;
}

function timingFunction(key: Keyframe, until: number): string {
  // sampled springs need the length of the segment they are crossing, which is
  // this key to the next one rather than the whole timeline
  return easingCss({ ...key, duration: Math.max(1, until - key.at) });
}

export interface MotionCssOptions {
  /**
   * What the rules are scoped to — the canvas stage or the player's screen, so
   * one frame's timeline never reaches the other's copy of the same layer.
   */
  scope?: string;
  /**
   * How a layer is addressed, when it is not addressed by node id.
   *
   * The canvas has `data-node-id` on every element and the export has a class
   * per layer, so the same compiler serves both by being told how to name one
   * rather than by knowing where it is going.
   */
  selector?: (id: string) => string;
  /**
   * Where the playhead is, in ms. Compiled as a negative `animation-delay`,
   * which is how you scrub a CSS animation: the animation believes it started
   * that long ago, and paused, it shows exactly that moment.
   */
  at?: number;
  /** paused is a scrub; running is playback, and the browser keeps the time */
  playing?: boolean;
  /** overrides the timeline's own loop setting — the player always loops once */
  loop?: boolean;
}

/**
 * A timeline as CSS: one `@keyframes` per track, and one rule per layer
 * naming the animations that drive it.
 *
 * One animation per *track* rather than one per layer, because a keyframe's
 * easing is a property of that keyframe: CSS puts `animation-timing-function`
 * inside a keyframe block, where it governs the segment that starts there, and
 * two properties keyed at the same moment with different curves cannot share a
 * block. Per-track animations give every key its own curve for free.
 */
export function motionCss(
  spec: MotionSpec | null,
  doc: Doc,
  { scope, selector, at = 0, playing = false, loop }: MotionCssOptions,
): string {
  if (!spec) return '';
  const duration = Math.max(1, spec.duration);
  const live = spec.tracks.filter((track) => track.keys.length > 0 && doc[track.node]);
  if (!live.length) return '';

  const percentOf = (ms: number) =>
    Number(Math.min(100, Math.max(0, (ms / duration) * 100)).toFixed(4));

  const blocks: string[] = [];
  /**
   * Tracks by the element they drive and the CSS they land on.
   *
   * Two things are being grouped at once. The *element* is a layer's box or,
   * for a shape's colour, the clipped layer inside it. The *channel* is the
   * CSS those tracks write: a stroke's weight and its colour are two tracks
   * and one `box-shadow`, and two animations on one property do not combine —
   * the last one named simply wins. Tracks that share a channel are compiled
   * into a single animation whose every stop carries all of them.
   */
  const groups = new Map<
    string,
    { node: string; target: 'box' | 'paint'; channel: string; tracks: MotionTrack[] }
  >();
  for (const track of live) {
    const target = targetOf(doc[track.node], track.property);
    const channel = channelOf(track.property);
    const id = `${track.node}:${target}:${channel}`;
    const group = groups.get(id) ?? { node: track.node, target, channel, tracks: [] };
    group.tracks.push(track);
    groups.set(id, group);
  }

  /** the animations each element runs, in the order they were declared */
  const byTarget = new Map<string, { node: string; target: 'box' | 'paint'; names: string[] }>();

  for (const group of groups.values()) {
    const node = doc[group.node];
    const name = `pl-motion-${group.tracks.map((track) => track.id).join('-')}`;

    // every moment any track in this channel says something about
    const times = [...new Set(group.tracks.flatMap((track) => track.keys.map((key) => key.at)))].sort(
      (a, b) => a - b,
    );
    // The ends have to be said out loud. A property named only in the middle
    // of an animation is *not* held by CSS outside those keyframes: the
    // browser synthesises the missing 0% and 100% from the element's own
    // style, and would tween the layer's design value into the first key. A
    // timeline holds the first and last key instead — what `valueAt` says — so
    // the compiler writes those two stops itself.
    const stops = [...new Set([0, ...times.map(percentOf), 100])].sort((a, b) => a - b);

    const write = writerFor(node, doc, group.tracks, duration);
    const body = stops.map((percent) => {
      const ms = (percent / 100) * duration;
      // the curve is the one on the key that starts here, and where several
      // tracks share a stop it is the first of them in the panel's order
      const leaving = group.tracks
        .map((track) => track.keys.find((key) => percentOf(key.at) === percent))
        .find((key): key is Keyframe => !!key);
      const nextAt = times.find((time) => percentOf(time) > percent);
      const timing =
        leaving && nextAt !== undefined
          ? `\n    animation-timing-function: ${timingFunction(leaving, nextAt)};`
          : '';
      return `  ${percent}% {\n    ${write(ms)};${timing}\n  }`;
    });

    blocks.push(`@keyframes ${name} {\n${body.join('\n')}\n}`);
    const key = `${group.node}:${group.target}`;
    const target = byTarget.get(key) ?? { node: group.node, target: group.target, names: [] };
    target.names.push(name);
    byTarget.set(key, target);
  }

  const rules: string[] = [];
  for (const { node: id, target, names } of byTarget.values()) {
    // `div[data-node-id]` rather than the bare attribute: a thin line carries
    // a transparent hit-pad with the same id, and a pad that took the layer's
    // own left and top would leave the layer it exists to widen.
    const box = selector ? selector(id) : `${scope ?? ''} div[data-node-id="${id}"]`.trim();
    // a shape's colour is on the clipped layer inside the box, not on the box
    const where = target === 'paint' ? `${box} [data-paint="${id}"]` : box;
    rules.push(
      `${where} {\n` +
        `  animation-name: ${names.join(', ')};\n` +
        `  animation-duration: ${names.map(() => `${duration}ms`).join(', ')};\n` +
        // a curve declared inside a keyframe overrides this; it is the default
        // for the segments that do not declare one
        `  animation-timing-function: linear;\n` +
        // A paused animation is a scrub, and a scrub does not loop: the
        // playhead is a position in one pass of the timeline, so at the very
        // end it has to read as the last keyframe rather than as the first
        // frame of the next lap.
        `  animation-iteration-count: ${playing && (loop ?? spec.loop) ? 'infinite' : '1'};\n` +
        // hold the first and last keys either side of the run, which is what a
        // timeline means by a property that is only keyed in the middle of it
        `  animation-fill-mode: both;\n` +
        `  animation-delay: ${-Math.max(0, at)}ms;\n` +
        `  animation-play-state: ${playing ? 'running' : 'paused'};\n` +
        `}`,
    );
  }

  return [...blocks, ...rules].join('\n\n');
}

/**
 * Where the playhead has got to, `elapsed` ms after playback started at `from`.
 *
 * The browser is running the animation; this is only what the panel's own
 * playhead has to say about it, which is why it is arithmetic rather than a
 * reading off the DOM.
 */
export function playheadAt(spec: MotionSpec, from: number, elapsed: number): number {
  const duration = Math.max(1, spec.duration);
  const raw = from + elapsed;
  if (!spec.loop) return Math.min(duration, raw);
  return raw % duration;
}

/** `0:01.25` — the readout Figma puts beside the transport. */
export function formatTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const seconds = Math.floor(clamped / 1000);
  const hundredths = Math.floor((clamped % 1000) / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/**
 * The easings the keyframe menu offers — the prototype panel's thirteen.
 *
 * The last two are not presets but doors: a keyframe carrying `custom-bezier`
 * or `custom-spring` also carries the numbers, and the panel opens an editor
 * for them.
 */
export const KEY_EASINGS: Easing[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-back',
  'ease-out-back',
  'ease-in-out-back',
  'gentle',
  'quick',
  'bouncy',
  'slow',
  'custom-bezier',
  'custom-spring',
];

/** Whether an easing is one the panel has to offer numbers for. */
export function isCustomEasing(easing: Easing): boolean {
  return easing === 'custom-bezier' || easing === 'custom-spring';
}
