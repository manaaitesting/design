/**
 * The scene graph.
 *
 * Every field here maps onto something CSS can express directly. That is the
 * whole premise of a code-native canvas: there is no proprietary layout model
 * to translate at export time — the browser's layout engine *is* the renderer,
 * so what you see on the artboard and what `export/toReact` emits cannot drift.
 */

import type { Anchor } from './geometry';

export type { Anchor };

import type { ImageAdjust } from './adjust';
import type { TextRun } from './text';

export type { TextRun, ImageAdjust };

/** A note pinned to a layer for whoever builds it. */
export interface Annotation {
  id: string;
  /** an optional heading, so a layer can carry more than one kind of note */
  label?: string;
  note: string;
}

/** Where a layer has got to. Figma's "ready for dev", plus its two neighbours. */
export type DevStatus = 'none' | 'ready' | 'done';

/** One closed or open run of anchors inside a vector. */
export interface VectorPath {
  anchors: Anchor[];
  closed: boolean;
}

export type NodeType =
  | 'page'
  | 'section'
  | 'frame'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'image'
  | 'shader'
  | 'vector'
  | 'slice'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'boolean';

/**
 * How a boolean group combines its children.
 *
 * The group is live, as Figma's is: the children keep their own geometry and
 * stay editable, and the combination is re-evaluated on every paint. `union`
 * and `exclude` are winding rules over one path; `intersect` and `subtract`
 * clip and mask — all four are things SVG does natively, which is why the
 * result exports as real markup rather than a baked outline.
 */
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

/**
 * How a mask layer decides what shows through.
 *
 * `alpha` is the geometric mask — the sibling's outline clips the group, which
 * is CSS `clip-path` and survives export. `luminance` uses the layer's painted
 * brightness instead, which needs a real mask image.
 */
export type MaskType = 'alpha' | 'luminance';

/** `fixed` → px · `fit` → fit-content · `fill` → stretch to the parent's cross axis */
export type SizeMode = 'fixed' | 'fit' | 'fill';

export type Axis = 'row' | 'column';
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'between';

/** How wrapped rows share the leftover cross-axis space — Figma's Align content. */
export type AlignContent = Align | 'between';

/** Which sibling paints on top inside an auto-layout frame. */
export type Stacking = 'first' | 'last';

/**
 * How one column or one row of a grid auto layout is sized.
 *
 * The same three choices a layer itself gets, because they mean the same
 * thing: a fixed number of pixels, hug (as wide as the cell's contents need),
 * or fill (a share of what is left over). `value` is the pixel count for
 * `fixed` and the `fr` weight for `fill` — two columns at 1 and 2 is Figma's
 * ratio — and it is ignored by `fit`.
 */
export interface Track {
  mode: SizeMode;
  value?: number;
}

export interface FlexSpec {
  /** Figma's Flow: flex in a direction, or a wrapping grid */
  mode?: 'flex' | 'grid';
  /** columns, when mode is 'grid' */
  columns?: number;
  /** rows, when mode is 'grid'; 0 means "as many as the children need" */
  rows?: number;
  /**
   * Per-track sizing for a grid, column-wise and row-wise.
   *
   * Absent — or shorter than the track count — means the tracks it does not
   * reach are `fill`, which is what every grid started life as. Keeping the
   * fallback rather than materialising a full array is what lets the column
   * count change without dragging a stale list of sizes along with it.
   */
  columnTracks?: Track[];
  rowTracks?: Track[];
  direction: Axis;
  /** spacing along the direction items flow in */
  gap: number;
  /**
   * Spacing between wrapped lines, and between grid rows. Figma exposes this as
   * a second gap field the moment a layout can wrap; undefined means "same as
   * `gap`", which is what a non-wrapping row has always done.
   */
  crossGap?: number;
  /** [top, right, bottom, left] */
  padding: [number, number, number, number];
  align: Align;
  justify: Justify;
  wrap: boolean;
  /** only meaningful once the layout wraps onto more than one line */
  alignContent?: AlignContent;
  /**
   * Figma's advanced settings. Defaults match Figma's: strokes sit outside the
   * layout, later siblings paint on top, and text aligns by its box rather than
   * its baseline.
   */
  strokesIncluded?: boolean;
  stacking?: Stacking;
  baseline?: boolean;
}

/** One paint in a stack. The first entry is the front-most, as in Figma. */
export interface Paint {
  id: string;
  value: string;
  opacity: number;
  visible: boolean;
  /**
   * Image paints only.
   *
   * `fit`, `scale` and `offset` say how the picture sits in the box; `rotation`
   * turns it in right angles; `adjust` is Figma's seven sliders. A paint that
   * says none of this is a plain background and costs nothing extra to draw —
   * only the ones that need their own element get one.
   */
  fit?: 'fill' | 'fit' | 'crop' | 'tile';
  scale?: number;
  offset?: [number, number];
  rotation?: 0 | 90 | 180 | 270;
  adjust?: ImageAdjust;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

/**
 * What a stroke's end wears, as Figma's cap dropdown lists it: the three plain
 * caps, then the four decorated ones that make a path an arrow.
 */
export type EndCap =
  | 'butt'
  | 'round'
  | 'square'
  | 'arrowLine'
  | 'arrowTriangle'
  | 'circle'
  | 'diamond';

export interface BorderSpec {
  width: number;
  color: string;
  /**
   * The paint's own opacity, as every other paint in the panel has one. It is
   * kept apart from the colour so a variable-bound stroke can still be faded.
   */
  opacity?: number;
  /**
   * The row's eye. A hidden stroke keeps its weight, which is the whole reason
   * this is a flag rather than a width of zero.
   */
  visible?: boolean;
  style: LineStyle;
  /** where the stroke sits relative to the edge, as in Figma */
  position: 'inside' | 'center' | 'outside';
  /**
   * Figma's individual strokes — [top, right, bottom, left]. Null means every
   * side takes `width`, which is what a stroke has always done.
   */
  sides?: [number, number, number, number] | null;
  /** dash pattern in px; a vector draws these literally, a box rounds to CSS */
  dash?: number;
  gap?: number;
  /** how a vector's open ends and corners are finished */
  cap?: 'butt' | 'round' | 'square';
  /**
   * Figma's per-end caps, which is where an arrowhead lives — a cap belongs to
   * the end of a run, not to the layer, so a bent path can carry a head on one
   * end and nothing on the other. Both fall back to `cap`, which is all a layer
   * drawn before these existed has.
   */
  capStart?: EndCap;
  capEnd?: EndCap;
  join?: 'miter' | 'round' | 'bevel';
  /**
   * Figma's miter angle, in degrees.
   *
   * Below it a mitred join gives up and bevels instead, which is what stops a
   * sharp corner growing a spike. SVG spells the same rule as a ratio, so the
   * angle is converted on the way out.
   */
  miterAngle?: number;
}

/** CSS `outline` — sits outside the box, unlike a border. */
export interface OutlineSpec {
  width: number;
  color: string;
  offset: number;
  style: LineStyle;
}

export interface FilterSpec {
  /** layer blur */
  blur: number;
  /** background blur — frosts whatever sits behind the node */
  backdropBlur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  hueRotate: number;
}

/**
 * Prototyping.
 *
 * An interaction is a trigger, an action and a transition — the same three
 * things Figma's interaction popover asks for. They live on the layer that is
 * touched, so a button carries its own behaviour wherever it is copied to.
 */
export type Trigger =
  /** an interaction that is wired but deliberately inert */
  | 'none'
  | 'click'
  | 'drag'
  | 'hover'
  | 'press'
  | 'key'
  | 'mouse-enter'
  | 'mouse-leave'
  | 'mouse-down'
  | 'mouse-up'
  | 'delay';
export type InteractionAction =
  | 'navigate'
  | 'back'
  | 'url'
  | 'open-overlay'
  | 'close-overlay'
  | 'swap-overlay'
  | 'scroll-to'
  | 'set-variable'
  /** swap an instance to another variant of its set — Figma's "Change to" */
  | 'change-to'
  /** put a collection into one of its modes while the prototype plays */
  | 'set-mode'
  /** run one branch of an if / else-if / else, depending on the variables */
  | 'conditional'
  /** play, pause or toggle a video on the frame */
  | 'play-pause'
  /** move a video's playhead to a timestamp */
  | 'set-playhead'
  | 'none';
export type TransitionType =
  | 'instant'
  | 'dissolve'
  | 'smart-animate'
  /** the incoming frame travels in over the one it replaces */
  | 'move'
  /** the outgoing frame travels off, uncovering the one beneath */
  | 'move-out'
  | 'push'
  | 'slide'
  | 'slide-out';
export type TransitionDirection = 'left' | 'right' | 'top' | 'bottom';
/**
 * Figma's easing menu: a straight line, seven curves, and five springs.
 *
 * The curves are cubic beziers and go straight into CSS. The springs are a
 * simulation rather than a curve, so they are sampled into a `linear()` easing
 * — see `easingCss`.
 */
export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-back'
  | 'ease-out-back'
  | 'ease-in-out-back'
  | 'custom-bezier'
  | 'gentle'
  | 'quick'
  | 'bouncy'
  | 'slow'
  | 'custom-spring';

/** The three numbers a spring is made of. */
export interface SpringSpec {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface TransitionSpec {
  type: TransitionType;
  /** which way the incoming frame travels; ignored by instant and dissolve */
  direction: TransitionDirection;
  /** ms */
  duration: number;
  easing: Easing;
  /** control points, when the easing is a custom bezier */
  bezier?: [number, number, number, number];
  /** parameters, when the easing is a custom spring */
  spring?: SpringSpec;
}

/**
 * Where an overlay sits, and how it behaves while it is up.
 *
 * Figma's overlay settings, which is most of what makes an overlay different
 * from a navigation: it is drawn over the frame you were on, and it can be
 * dismissed without going anywhere.
 */
export interface OverlaySpec {
  position:
    | 'center'
    | 'top'
    | 'bottom'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'manual';
  /** dims what is behind it */
  background: boolean;
  /** a click outside closes it */
  closeOnOutside: boolean;
}

/**
 * The devices a prototype can be framed in.
 *
 * The sizes are the real ones, because the point of the setting is to see the
 * design at the size it will be used at — a phone frame that is not a phone's
 * size is decoration.
 */
export type PrototypeDevice =
  | 'none'
  | 'phone'
  | 'phone-large'
  | 'tablet'
  | 'laptop'
  | 'desktop'
  | 'watch';

export interface DeviceSpec {
  id: PrototypeDevice;
  label: string;
  /** the screen, in CSS pixels */
  w: number;
  h: number;
  /** bezel thickness and corner radius of the shell drawn around it */
  bezel: number;
  radius: number;
}

export const DEVICES: DeviceSpec[] = [
  { id: 'none', label: 'No device', w: 0, h: 0, bezel: 0, radius: 0 },
  { id: 'phone', label: 'Phone — 390 × 844', w: 390, h: 844, bezel: 12, radius: 44 },
  { id: 'phone-large', label: 'Phone L — 430 × 932', w: 430, h: 932, bezel: 12, radius: 48 },
  { id: 'tablet', label: 'Tablet — 834 × 1194', w: 834, h: 1194, bezel: 16, radius: 26 },
  { id: 'laptop', label: 'Laptop — 1440 × 900', w: 1440, h: 900, bezel: 14, radius: 12 },
  { id: 'desktop', label: 'Desktop — 1920 × 1080', w: 1920, h: 1080, bezel: 16, radius: 8 },
  { id: 'watch', label: 'Watch — 184 × 224', w: 184, h: 224, bezel: 10, radius: 40 },
];

/** One arm of a conditional: when to take it, and what to do if you do. */
export interface ConditionBranch {
  id: string;
  /** the expression, as Figma writes it; the trailing `else` branch has none */
  condition?: string;
  /** what running this branch does — Figma allows a list, and so does this */
  actions: Interaction[];
}

export interface Interaction {
  id: string;
  trigger: Trigger;
  /** ms the `delay` trigger waits after the frame appears */
  delay: number;
  /**
   * Figma's "State" section: what to forget on the way in.
   *
   * A prototype normally remembers where you had scrolled a frame to and which
   * variant its instances were swapped to, so coming back looks like coming
   * back. These say to arrive fresh instead.
   */
  resetScroll?: boolean;
  resetComponentState?: boolean;
  resetVideo?: boolean;
  /** the layer whose video `play-pause` and `set-playhead` act on */
  animation?: string;
  /** what `play-pause` does when it fires */
  behavior?: 'toggle' | 'play' | 'pause';
  /** where `set-playhead` moves the playhead to, in seconds */
  timestamp?: number;
  /**
   * The branches of a `conditional`, in order.
   *
   * The first whose condition holds is the one that runs, and a branch with no
   * condition is the `else` — which is why it can only be last.
   */
  branches?: ConditionBranch[];
  action: InteractionAction;
  /** the frame `navigate` goes to */
  destination: string | null;
  /** the address `url` opens */
  url?: string;
  /** open-overlay only: where the overlay sits and how it dismisses */
  overlay?: OverlaySpec;
  /** the key the `key` trigger listens for, as `KeyboardEvent.key` */
  key?: string;
  /** set-variable: which variable, and what to set it to while playing */
  variable?: string;
  value?: string;
  /** set-mode: which collection, and which of its modes */
  collection?: string;
  mode?: string;
  transition: TransitionSpec;
}

/**
 * Motion.
 *
 * A frame carries a timeline: a duration, and a list of tracks saying how one
 * property of one layer changes over it. That is Figma Motion's model, and it
 * is deliberately a different thing from the transitions above — a transition
 * animates the step *between* two frames, a timeline animates what happens
 * *inside* one.
 *
 * Every property here is one CSS can interpolate, because that is what the
 * timeline compiles to: `src/document/motion.ts` turns these tracks into real
 * `@keyframes`, the browser does the interpolation, and the export carries the
 * same rules out with no runtime behind them.
 */
export type MotionProperty =
  | 'x'
  | 'y'
  | 'w'
  | 'h'
  | 'rotation'
  | 'opacity'
  | 'radius'
  | 'fill'
  /** the stroke's weight and its colour, which are two tracks and not one */
  | 'strokeWidth'
  | 'strokeColor'
  /** layer blur, wherever this layer keeps it — an effect, or the older field */
  | 'blur';

/**
 * One value a property is pinned to at one moment.
 *
 * `easing` is how the curve *leaves* this key toward the next one, which is
 * where CSS puts a per-keyframe timing function too — so the field means the
 * same thing in the model and in the compiled animation.
 */
export interface Keyframe {
  id: string;
  /** ms from the start of the timeline */
  at: number;
  /** a number for every property but `fill`, which holds a colour */
  value: number | string;
  easing: Easing;
  /** control points, when the easing is a custom bezier */
  bezier?: [number, number, number, number];
  /** parameters, when the easing is a custom spring */
  spring?: SpringSpec;
}

/** One layer's one property, over the whole timeline. */
export interface MotionTrack {
  id: string;
  /** the layer this drives */
  node: string;
  property: MotionProperty;
  /** in time order — the store keeps them sorted */
  keys: Keyframe[];
}

export interface MotionSpec {
  /** ms */
  duration: number;
  loop: boolean;
  tracks: MotionTrack[];
}

/**
 * How a set of columns or rows sits in its frame — Figma's grid Type.
 *
 * `stretch` fills the frame and honours the margin; the other three pin a run
 * of fixed-width tracks to one edge or the middle, where the margin has nothing
 * to say and a width does.
 */
export type GuideAlign = 'stretch' | 'start' | 'end' | 'center';

/** Layout guides — a design aid drawn over a frame, never exported. */
export interface GuideSpec {
  id?: string;
  type: 'columns' | 'rows' | 'grid';
  count: number;
  gutter: number;
  margin: number;
  /** grid cell size, used when type is 'grid' */
  size: number;
  color: string;
  /** the guide paint's own opacity, so picking a colour cannot make it opaque */
  opacity?: number;
  visible: boolean;
  /** columns and rows only; defaults to stretch, as Figma's do */
  align?: GuideAlign;
  /** track thickness when not stretching */
  width?: number;
}

export interface VideoSpec {
  src: string;
  loop: boolean;
  muted: boolean;
  autoplay: boolean;
  fit: 'cover' | 'contain';
}

export interface UnderlineSpec {
  /** Figma offers the two lines under one Decoration control */
  line?: 'underline' | 'strikethrough';
  style: 'solid' | 'wavy' | 'dashed' | 'dotted' | 'double';
  color: string;
  thickness: number;
  offset: number;
}

export interface TextStrokeSpec {
  width: number;
  color: string;
}

/**
 * How a child reacts when its frame resizes. Only meaningful for absolutely
 * placed children — a flex child's position belongs to the layout.
 */
export type Constraint = 'start' | 'end' | 'center' | 'scale' | 'stretch';

export interface ConstraintSpec {
  h: Constraint;
  v: Constraint;
}

/** What an export produces. Code formats ignore the scale. */
export type ExportFormat = 'react' | 'html' | 'tailwind' | 'json' | 'png' | 'jpg' | 'svg' | 'pdf';

/**
 * One line of a layer's Export section.
 *
 * Figma keeps these on the layer, not on the app: the settings are part of how
 * a design is meant to ship, so they belong in the document where they sync and
 * survive a reload.
 */
export interface ExportSetting {
  id: string;
  scale: number;
  format: ExportFormat;
  /** appended to the filename, before the extension */
  suffix?: string;
  /** export what is inside the frame without the frame's own background */
  contentsOnly?: boolean;
}

/** Per-corner radii, clockwise from the top-left. */
export type Radii = [number, number, number, number];

export interface ShadowSpec {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/**
 * One entry in the Effects list.
 *
 * Every type shares one parameter bag: Blur means the same thing to a shadow
 * and to a layer blur, so switching an effect's type keeps what the two have
 * in common instead of resetting the row. `src/document/effects.ts` says which
 * fields each type reads, and turns the list into CSS.
 */
export type EffectType =
  | 'inner-shadow'
  | 'drop-shadow'
  | 'layer-blur'
  | 'background-blur'
  | 'noise'
  | 'texture'
  | 'glass'
  | 'shader';

export interface Effect {
  id: string;
  type: EffectType;
  /** the eye beside the row — keeps the settings while hiding the effect */
  visible: boolean;

  /** shadows: offset, radius and spread, with the colour carrying its own alpha */
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  /** the shadow's own blend mode, behind the droplet in its popover */
  blend: string;

  /** blurs: uniform takes `blur`, progressive ramps `start` → `end` */
  progressive: boolean;
  start: number;
  end: number;

  /** noise: mono tints with `color`, duo adds `color2`, multi is full colour */
  variant: 'mono' | 'duo' | 'multi';
  sizeX: number;
  sizeY: number;
  density: number;
  color2: string;
  opacity2: number;
  /** how strong full-colour noise reads */
  grain: number;

  /** texture */
  radius: number;
  clip: boolean;

  /** glass */
  refraction: number;
  depth: number;

  /** shader — the same spec a shader node carries */
  shader?: ShaderSpec | null;
}

/**
 * Component properties.
 *
 * A main component publishes a list of properties; layers inside it say which
 * property drives them; an instance chooses a value for each. Values are held
 * as strings throughout — a boolean is "true"/"false" — because a Yjs map is
 * happier with one scalar type than with a union, and every control that reads
 * one already has to parse text.
 */
export type PropType = 'boolean' | 'text' | 'instance' | 'variant';

export interface ComponentProp {
  id: string;
  name: string;
  type: PropType;
  /** what an instance starts with */
  value: string;
  /** variant only: the values this property offers, in menu order */
  options?: string[];
}

/**
 * What a layer inside a component does with a property: `visible` hides it,
 * `text` writes its content, `instance` swaps what it points at.
 */
export interface PropBinding {
  prop: string;
  field: 'visible' | 'text' | 'instance';
}

/**
 * Styles.
 *
 * A variable is one value; a style is a whole set of them — the paints on a
 * fill, an entire type spec, a stack of effects. Layers subscribe rather than
 * copy, so editing the style moves everything wearing it.
 */
export type StyleKind = 'paint' | 'text' | 'effect' | 'grid';

/**
 * A design variable.
 *
 * `value` is the value in the collection's default mode, which is also all a
 * document that never uses modes ever needs. `values` adds the other modes,
 * `alias` points the variable at another one instead of holding a value, and
 * `collection` says which set of modes it answers to.
 */
export interface Token {
  id: string;
  name: string;
  type: 'color' | 'number' | 'text' | 'boolean';
  value: string;
  /** the collection this variable belongs to; absent means the default one */
  collection?: string;
  /** per-mode values, keyed by mode id */
  values?: Record<string, string>;
  /** follows another variable rather than holding a value of its own */
  alias?: string;
  /**
   * Where this variable may be applied — empty means anywhere its type fits.
   * See `VarScope` in `document/variables`.
   */
  scopes?: string[];
  /** kept out of the pickers, and out of anything published */
  hidden?: boolean;
  /** what it is for, shown in the picker */
  description?: string;
}

/** Which part of a layer a style is worn on. */
export type StyleSlot = 'fill' | 'stroke' | 'text' | 'effect' | 'grid';

/** The numeric fields a number variable can drive. */
export type NumericField =
  | 'x'
  | 'y'
  | 'w'
  | 'h'
  | 'radius'
  | 'opacity'
  /**
   * The type fields live inside `font` rather than on the node, but they bind
   * the same way and for the same reason: a design system that says "body is
   * 16/24" wants to say it once. `bindVariable` knows to write through to the
   * font spec for these four.
   */
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing';

/**
 * The boolean fields a boolean variable can drive.
 *
 * Figma has one, and it is the reason boolean variables exist: a design system
 * ships a feature flag by binding the layers it hides to a single variable, and
 * switching a mode turns the whole feature off in one place.
 */
export type BooleanField = 'visible';

/** Everything a variable can be bound to, whatever its type. */
export type BoundField = NumericField | BooleanField;

export function isBooleanField(field: BoundField): field is BooleanField {
  return field === 'visible';
}

/** The bound fields that are a property of `font` rather than of the node. */
export const FONT_FIELDS = {
  fontSize: 'size',
  fontWeight: 'weight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
} as const;

export type FontField = keyof typeof FONT_FIELDS;

export function isFontField(field: NumericField): field is FontField {
  return field in FONT_FIELDS;
}

/** A GPU shader bound to a node, with its uniform values. */
export interface ShaderSpec {
  id: string;
  params: Record<string, number | string>;
}

export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right' | 'justify';
  color: string;
  /** Figma's Text case — `small` is small caps, which is a glyph swap not a transform */
  case?: 'none' | 'upper' | 'lower' | 'title' | 'small';
  /** Figma's "Truncate text" — 0 keeps every line */
  maxLines?: number;
  /** px of space between paragraphs — a paragraph is a line of the text */
  paragraphSpacing?: number;
  /** Figma's list style */
  list?: 'none' | 'bullet' | 'number';
  /**
   * OpenType.
   *
   * `numeric` covers the two figures settings anyone actually reaches for —
   * tabular figures for tables, old-style for running text — and `features` is
   * the escape hatch for a face's own tags (`ss01`, `dlig`, and so on).
   */
  numeric?: 'normal' | 'tabular' | 'oldstyle';
  features?: string[];

  /** the italic half of Figma's style menu — Bold and Bold Italic are one family */
  italic?: boolean;

  /**
   * Vertical trim.
   *
   * Figma's "Vertical trim" drops the half-leading above the cap and below the
   * baseline, so a heading's box is the letters rather than the line box. CSS
   * spells it `text-box`, which is exactly this and nothing else.
   */
  verticalTrim?: 'standard' | 'cap';

  /** Figma's "Wrap style" — how a line break is chosen, not whether it happens */
  wrap?: 'auto' | 'balance' | 'pretty';

  /**
   * Indentation, from the Details tab.
   *
   * Hanging punctuation pulls an opening quote into the margin, and a hanging
   * list pulls the bullet out of the text column; both are the typographic
   * detail that makes a left edge read as straight when it is not.
   */
  hangingPunctuation?: boolean;
  hangingList?: boolean;
  paragraphIndent?: number;

  /**
   * Letter case, from the Details tab.
   *
   * `case` above changes which letters are shown; these change which *glyphs*
   * are used for them — case-sensitive forms lift brackets and dashes to suit
   * capitals, capital spacing opens the tracking that all-caps needs.
   */
  caseSensitive?: boolean;
  capitalSpacing?: boolean;

  /**
   * Numbers, from the Details tab.
   *
   * `numeric` above is the figures style; these are the rest of what OpenType
   * offers for them, each one a checkbox in Figma and a `font-variant-numeric`
   * keyword here.
   */
  slashedZero?: boolean;
  fractions?: boolean;
  ordinals?: boolean;
  numberPosition?: 'normal' | 'super' | 'sub';

  /**
   * Variable-font axis values, by tag.
   *
   * A variable family is one file that interpolates — `wght` between 100 and
   * 900, `slnt` between -10 and 0 — so the sliders in the Variable tab write
   * here rather than picking one of nine named cuts. `wght` is kept in step
   * with `weight`, because they are the same property said two ways.
   */
  variations?: Record<string, number>;
}

export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  parent: string | null;
  children: string[];

  visible: boolean;
  locked: boolean;

  /** Position within the parent. Ignored when the parent lays children out with flex. */
  x: number;
  y: number;
  w: number;
  h: number;
  wMode: SizeMode;
  hMode: SizeMode;
  /**
   * Bounds a layer will not resize past.
   *
   * Figma puts these on every layer rather than only on auto-layout children,
   * because the case they exist for — a card that may grow with its text but
   * never past 480px — is about the layer, not about its parent. They map onto
   * `min-width` and friends, so the browser enforces them during layout instead
   * of the editor clamping after the fact.
   */
  minW?: number | null;
  maxW?: number | null;
  minH?: number | null;
  maxH?: number | null;
  rotation: number;

  /** Non-null turns this node into a flex container; children then flow. */
  flex: FlexSpec | null;
  /**
   * Figma's "Absolute position": this child keeps its own x/y and stops taking
   * part in its parent's auto layout, without leaving the frame.
   */
  absolute?: boolean;
  /** Overrides the parent's cross-axis alignment for this child alone. */
  alignSelf?: Align | 'auto';
  /**
   * Where this child sits in a grid auto layout, and how many cells it covers.
   *
   * Figma's "Grid position": a column and row start, each with a span. Leaving
   * a start unset is auto-flow — the child takes the next free cell, which is
   * what every child did before there was any way to say otherwise. A span
   * with no start still spans, so "make this card two columns wide" needs no
   * decision about where the card goes.
   */
  gridColumn?: number | null;
  gridRow?: number | null;
  gridColumnSpan?: number | null;
  gridRowSpan?: number | null;
  clip: boolean;

  fill: string | null;
  /** the eye toggle beside Fill — keeps the value while hiding the paint */
  fillVisible: boolean;
  /** alpha of the fill paint alone, independent of the layer's opacity */
  fillOpacity: number;
  /** a stack of paints; when present it supersedes `fill` */
  fills?: Paint[];
  opacity: number;
  blend: string;
  radius: number;
  /** non-null overrides `radius` with per-corner values */
  radii: Radii | null;
  /**
   * Figma's corner smoothing, 0–1. 0 is an ordinary circular corner; 0.6 is the
   * iOS squircle. CSS calls the same thing a superellipse.
   */
  cornerSmoothing?: number;
  border: BorderSpec | null;
  outline: OutlineSpec | null;
  shadow: ShadowSpec | null;
  /** extra drop shadows beyond the first */
  shadows?: ShadowSpec[];
  innerShadow: ShadowSpec | null;
  filters: FilterSpec | null;
  /** the Effects list; when present it supersedes `shadow` and `filters` */
  effects?: Effect[];
  guides: GuideSpec | GuideSpec[] | null;
  video: VideoSpec | null;
  flipH: boolean;
  flipV: boolean;
  /** ties W and H together while resizing */
  aspectLocked: boolean;
  /** how this node follows its parent's resize */
  constraints?: ConstraintSpec;

  /** text nodes */
  text?: string;
  /**
   * Styled runs within the text.
   *
   * `text` stays the plain reading of the layer — what a search matches, what an
   * agent reads — and the runs are how it is dressed. A layer that has never
   * been styled per word has no runs at all, which is why nothing needed
   * migrating when they arrived. See `document/text`.
   */
  runs?: TextRun[];
  /**
   * Figma Draw's "Type on a path": the text runs along another layer's outline
   * instead of sitting in a box.
   *
   * `source` is the layer whose outline is followed. Attaching gives the text
   * layer that layer's box, so the outline — which is drawn in its own local
   * coordinates — means the same thing in both, and the glyphs land on the line
   * rather than beside it.
   *
   * A path holds one line: `offset` is how far along it the text starts, as a
   * percentage, and `side` is which side of the line the glyphs sit on. This is
   * a relationship between two layers rather than a property of the type, which
   * is why it is here and not on `font` — a text style or a copied set of
   * properties must not carry another layer's id onto a second layer.
   */
  textPath?: {
    source: string;
    offset: number;
    side: 'top' | 'bottom';
  } | null;
  font?: FontSpec;
  vAlign?: 'top' | 'middle' | 'bottom';
  underline?: UnderlineSpec | null;
  textStroke?: TextStrokeSpec | null;
  /** image nodes */
  src?: string;

  /**
   * How an image paint sits in its box — Figma's Fill / Fit / Crop / Tile.
   *
   * `scale` and `offset` only mean anything to Crop and Tile: crop pans a
   * magnified image behind the box, tile repeats it at that size. They apply to
   * every image paint on the layer, which is one each in every real document.
   */
  imageFit?: 'fill' | 'fit' | 'crop' | 'tile';
  imageScale?: number;
  imageOffset?: [number, number];
  /**
   * Whether this layer's own fill is painted into an export.
   *
   * Figma's "Show in exports", which it offers on a page and on any frame: a
   * slice cropped out of a page comes out on the page colour when this is on
   * and transparent when it is off, and a frame exported with it off gives you
   * its contents on nothing. Undefined means on, so a document written before
   * the control existed keeps the background it was exporting with.
   */
  exportBackground?: boolean;

  /**
   * The shader this layer paints with — a fill, not a node type.
   *
   * A `shader` node is a layer whose only job is to carry one, but any layer
   * may hold one: a star filled with the aurora shader is a star with a shader
   * paint, exactly as a star filled with a photo is a star with an image paint.
   * Null clears it, the way `video` does, and the two are exclusive.
   */
  shader?: ShaderSpec | null;

  /** the export settings this layer carries */
  exports?: ExportSetting[];

  /**
   * Handoff notes.
   *
   * Figma calls these annotations: a line of guidance pinned to a layer, and a
   * status saying whether the layer is settled enough to build. They are part of
   * the document because they are part of what is being handed over.
   */
  annotations?: Annotation[];
  devStatus?: DevStatus;

  /**
   * How this frame scrolls while the prototype is playing, and how a child
   * behaves when the frame it is in scrolls. Both are Figma's, and both are
   * about playback only — the canvas never scrolls a frame.
   */
  scroll?: 'none' | 'vertical' | 'horizontal' | 'both';
  scrollBehavior?: 'scrolls' | 'fixed' | 'sticky';

  /**
   * A hyperlink on the layer — Figma's ⌘K.
   *
   * It is a property of the layer rather than of a run of characters, which is
   * the common case and the one that survives an export: the text comes out
   * inside an `<a href>`, and a click in the prototype opens it.
   */
  link?: string | null;

  /** what this layer does when a viewer touches it in the prototype */
  interactions?: Interaction[];
  /**
   * Names this frame as a flow's starting point — Figma's badge above the
   * artboard, and where Present begins.
   */
  flowStart?: string | null;

  /**
   * The timeline this frame plays — Figma Motion's, kept on the board it
   * animates rather than on the page, because a timeline is about one screen.
   *
   * It is stored whole, the way `interactions` and `effects` are: a keyframe
   * is small, and a list that is replaced as a unit merges the same way the
   * rest of the document's lists do.
   */
  motion?: MotionSpec | null;

  /**
   * Prototype settings, carried by the page.
   *
   * Figma keeps these with the document rather than with whoever is playing it:
   * the device a prototype is meant to be seen on, and the colour behind it,
   * are decisions about the design, so they travel with the file and everybody
   * plays back the same thing.
   */
  prototypeDevice?: PrototypeDevice;
  prototypeBackground?: string;

  /**
   * Page nodes: which frame stands for the file in the browser.
   *
   * Figma's "Set as thumbnail". Without one the first frame on the page is
   * used, which is right until the day the first frame is a scratch board.
   */
  thumbnailOf?: string;

  /** this node is a main component — instances mirror it */
  isComponent?: boolean;
  /**
   * A main component that came from the shared library.
   *
   * `libraryId` is the published component it is a copy of and `libraryVersion`
   * is which revision was taken, so a file can tell when the original has moved
   * on. Instances go on pointing at this local main, which is what lets an
   * update be applied in place and reach every instance at once.
   */
  libraryId?: string;
  libraryVersion?: number;
  /** this subtree is an instance of that main component */
  instanceOf?: string;

  /**
   * What this component is for, and where the rest of the story is.
   *
   * Figma shows both on the instance as well as the main, which is the point:
   * the person reaching for a component is usually not the person who made it.
   */
  description?: string;
  docs?: string;

  /** the properties this main component publishes to its instances */
  props?: ComponentProp[];
  /** what this layer inside a component follows */
  bindings?: PropBinding[];
  /** what an instance has chosen, keyed by property id */
  propValues?: Record<string, string>;
  /** this frame groups the variants of one component */
  isComponentSet?: boolean;
  /** for a main inside a set: which variant it is, keyed by property id */
  variantValues?: Record<string, string>;
  /** the styles this layer wears, by slot */
  styles?: Partial<Record<StyleSlot, string>>;
  /**
   * Number variables bound to numeric fields, by field name.
   *
   * The field keeps its resolved number so every geometry calculation — snap,
   * resize, bounds — carries on working in plain arithmetic; the binding is
   * what makes the rendered CSS a `var()`, and what the store re-resolves when
   * the variable moves.
   */
  vars?: Partial<Record<BoundField, string>>;
  /**
   * Properties edited locally inside an instance. Propagation from the main
   * skips these, which is what makes an instance useful rather than a copy.
   */
  overridden?: string[];
  /**
   * Vector nodes.
   *
   * `anchors` is the live representation — a point with optional cubic handles.
   * `points` is what documents written before handles existed hold; it is read
   * as a run of corners and rewritten as anchors on the first edit, so an old
   * path never has to be migrated ahead of time.
   */
  anchors?: Anchor[];
  points?: [number, number][];
  closed?: boolean;
  /**
   * Several subpaths in one layer.
   *
   * A flattened boolean has holes, and a hole is a second ring — which one
   * anchor list cannot express. When this is present it *is* the geometry, and
   * `anchors` is left alone as the single-subpath shorthand everything else
   * still writes.
   */
  paths?: VectorPath[];
  /** rounds the corners between segments */
  smooth?: number;
  /**
   * Which of the path's regions are painted — Figma's paint bucket.
   *
   * Stored as a point inside each painted region rather than as the region
   * itself, because the regions are derived from the geometry and move when it
   * does: a seed goes on pointing at the same area while its shape is edited,
   * and quietly stops painting if that area is edited away. Absent means the
   * whole outline is filled, which is what every shape does until someone
   * paints a region of it.
   */
  fillSeeds?: [number, number][];

  /** polygon and star: how many sides / points */
  sides?: number;
  /** star: the inner radius as a fraction of the outer one */
  innerRatio?: number;
  /** ellipse arc, in turns clockwise from twelve o'clock */
  arcStart?: number;
  arcEnd?: number;
  /** ellipse donut: the hole's radius as a fraction of the outer one */
  innerRadius?: number;

  /** boolean groups: how the children combine */
  op?: BooleanOp;

  /** pages only: the guides dragged off the rulers, in world coordinates */
  rulerGuides?: { axis: 'x' | 'y'; at: number }[];

  /**
   * Variable modes this frame applies to its subtree, by collection id.
   *
   * It publishes those collections' variables onto its own element, so the
   * cascade does the rest — which is why a dark-mode frame keeps working in the
   * export with no runtime at all.
   */
  modes?: Record<string, string>;

  /**
   * This layer masks the siblings above it in the layer list, exactly as
   * Figma's mask does — the layers it applies to are the ones that paint on top
   * of it, and the run ends at the next mask or the end of the frame.
   */
  isMask?: boolean;
  maskType?: MaskType;
}

export type Doc = Record<string, SceneNode>;

export const ROOT_ID = 'root';

/**
 * A section groups artboards on the canvas rather than laying anything out.
 *
 * It behaves like the page as far as its children are concerned — a frame
 * inside one is still a top-level artboard, not a nested layer — which is what
 * keeps clicking, framing and export working the way they did before sections
 * existed.
 */
export function isCanvasRoot(node: SceneNode | undefined): boolean {
  return node?.type === 'page' || node?.type === 'section';
}

/** A node sitting directly on the page or in a section — an artboard. */
export function isArtboard(node: SceneNode, doc: Doc): boolean {
  return node.parent !== null && isCanvasRoot(doc[node.parent]);
}

/** True when the parent controls this node's position (i.e. it's in flex flow). */
export function isInFlow(node: SceneNode, doc: Doc): boolean {
  if (node.absolute) return false;
  const parent = node.parent ? doc[node.parent] : null;
  return !!parent && !isCanvasRoot(parent) && parent.flex !== null;
}

/** True when this node sits inside an auto-layout frame, flowed or not. */
export function inAutoLayout(node: SceneNode, doc: Doc): boolean {
  const parent = node.parent ? doc[node.parent] : null;
  return !!parent && !isCanvasRoot(parent) && parent.flex !== null;
}

/**
 * The component set a variant belongs to.
 *
 * A variant is a main component whose parent is a set — there is no separate
 * back-pointer to keep in step, because the tree already says it.
 */
export function setOf(main: SceneNode | undefined, doc: Doc): SceneNode | null {
  const parent = main?.parent ? doc[main.parent] : null;
  return parent?.isComponentSet ? parent : null;
}

/** The instance root this node lives inside, if any. */
export function instanceRoot(id: string, doc: Doc): string | null {
  let current: SceneNode | undefined = doc[id];
  while (current) {
    if (current.instanceOf) return current.id;
    current = current.parent ? doc[current.parent] : undefined;
  }
  return null;
}

export function ancestors(id: string, doc: Doc): SceneNode[] {
  const out: SceneNode[] = [];
  let cur = doc[id]?.parent;
  while (cur && doc[cur]) {
    out.push(doc[cur]);
    cur = doc[cur].parent;
  }
  return out;
}

/**
 * The page a node lives on, or null when it is not in the document at all.
 *
 * A link to a layer says which page it is on by saying which layer it is, so
 * this is what turns `?node=` back into a page and a selection.
 */
export function pageOf(id: string, doc: Doc): string | null {
  let cur = doc[id];
  if (!cur) return null;
  if (cur.type === 'page') return cur.id;
  while (cur?.parent) {
    const parent = doc[cur.parent];
    if (!parent) return null;
    if (parent.type === 'page') return parent.id;
    cur = parent;
  }
  return null;
}

/**
 * Where a node sits in the space of its page, with every ancestor added back on.
 *
 * `x`/`y` are parent-local, so a layer three frames deep says nothing about
 * where it is on the board until the frames between it and the page have been
 * added back. Anything that has to reason across that boundary — moving a layer
 * to another page, framing one on screen — needs this rather than `node.x`.
 */
export function pagePoint(id: string, doc: Doc): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node = doc[id];
  while (node?.parent) {
    x += node.x ?? 0;
    y += node.y ?? 0;
    const parent = doc[node.parent];
    if (!parent || parent.type === 'page') break;
    node = parent;
  }
  return { x, y };
}

/** The outermost ancestor that still sits on the page — what a single click selects. */
export function topLevelOf(id: string, doc: Doc): string {
  let cur = doc[id];
  if (!cur) return id;
  while (cur.parent && doc[cur.parent] && !isCanvasRoot(doc[cur.parent])) {
    cur = doc[cur.parent];
  }
  return cur.id;
}

/**
 * The ancestor of `id` that sits directly inside `container` — the node a click
 * should select while you are "inside" that container. Null when `id` is not a
 * descendant of it at all.
 */
export function childOfContainer(id: string, container: string, doc: Doc): string | null {
  let current = doc[id];
  while (current?.parent) {
    if (current.parent === container) return current.id;
    current = doc[current.parent];
  }
  return null;
}

/**
 * The layout grids on a frame.
 *
 * Figma stacks them — a 12-column grid for the horizontal rhythm and an 8px
 * square grid for the vertical one, on the same frame — so this is a list. A
 * document written before it was carried a single spec, and reads back as a
 * one-entry stack rather than as a frame that lost its grid.
 */
export function guidesOf(node: SceneNode): GuideSpec[] {
  if (!node.guides) return [];
  return Array.isArray(node.guides) ? node.guides : [node.guides];
}

export function descendants(id: string, doc: Doc, out: string[] = []): string[] {
  for (const child of doc[id]?.children ?? []) {
    out.push(child);
    descendants(child, doc, out);
  }
  return out;
}
