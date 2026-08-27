/**
 * The scene graph.
 *
 * Every field here maps onto something CSS can express directly. That is the
 * whole premise of a code-native canvas: there is no proprietary layout model
 * to translate at export time — the browser's layout engine *is* the renderer,
 * so what you see on the artboard and what `export/toReact` emits cannot drift.
 */

export type NodeType = 'page' | 'frame' | 'text' | 'rect' | 'ellipse' | 'image' | 'shader' | 'vector';

/** `fixed` → px · `fit` → fit-content · `fill` → stretch to the parent's cross axis */
export type SizeMode = 'fixed' | 'fit' | 'fill';

export type Axis = 'row' | 'column';
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'between';

export interface FlexSpec {
  /** Figma's Flow: flex in a direction, or a wrapping grid */
  mode?: 'flex' | 'grid';
  /** columns, when mode is 'grid' */
  columns?: number;
  direction: Axis;
  gap: number;
  /** [top, right, bottom, left] */
  padding: [number, number, number, number];
  align: Align;
  justify: Justify;
  wrap: boolean;
}

/** One paint in a stack. The first entry is the front-most, as in Figma. */
export interface Paint {
  id: string;
  value: string;
  opacity: number;
  visible: boolean;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface BorderSpec {
  width: number;
  color: string;
  style: LineStyle;
  /** where the stroke sits relative to the edge, as in Figma */
  position: 'inside' | 'center' | 'outside';
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
export type Trigger = 'click' | 'hover' | 'press' | 'delay';
export type InteractionAction = 'navigate' | 'back' | 'url' | 'none';
export type TransitionType = 'instant' | 'dissolve' | 'move' | 'push' | 'slide';
export type TransitionDirection = 'left' | 'right' | 'top' | 'bottom';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface TransitionSpec {
  type: TransitionType;
  /** which way the incoming frame travels; ignored by instant and dissolve */
  direction: TransitionDirection;
  /** ms */
  duration: number;
  easing: Easing;
}

export interface Interaction {
  id: string;
  trigger: Trigger;
  /** ms the `delay` trigger waits after the frame appears */
  delay: number;
  action: InteractionAction;
  /** the frame `navigate` goes to */
  destination: string | null;
  /** the address `url` opens */
  url?: string;
  transition: TransitionSpec;
}

/** Layout guides — a design aid drawn over a frame, never exported. */
export interface GuideSpec {
  type: 'columns' | 'rows' | 'grid';
  count: number;
  gutter: number;
  margin: number;
  /** grid cell size, used when type is 'grid' */
  size: number;
  color: string;
  visible: boolean;
}

export interface VideoSpec {
  src: string;
  loop: boolean;
  muted: boolean;
  autoplay: boolean;
  fit: 'cover' | 'contain';
}

export interface UnderlineSpec {
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

/** Per-corner radii, clockwise from the top-left. */
export type Radii = [number, number, number, number];

export interface ShadowSpec {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
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
  align: 'left' | 'center' | 'right';
  color: string;
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
  rotation: number;

  /** Non-null turns this node into a flex container; children then flow. */
  flex: FlexSpec | null;
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
  border: BorderSpec | null;
  outline: OutlineSpec | null;
  shadow: ShadowSpec | null;
  /** extra drop shadows beyond the first */
  shadows?: ShadowSpec[];
  innerShadow: ShadowSpec | null;
  filters: FilterSpec | null;
  guides: GuideSpec | null;
  video: VideoSpec | null;
  flipH: boolean;
  flipV: boolean;
  /** ties W and H together while resizing */
  aspectLocked: boolean;
  /** how this node follows its parent's resize */
  constraints?: ConstraintSpec;

  /** text nodes */
  text?: string;
  font?: FontSpec;
  vAlign?: 'top' | 'middle' | 'bottom';
  underline?: UnderlineSpec | null;
  textStroke?: TextStrokeSpec | null;
  /** image nodes */
  src?: string;
  /** shader nodes; null clears it, the way `video` does */
  shader?: ShaderSpec | null;

  /** what this layer does when a viewer touches it in the prototype */
  interactions?: Interaction[];
  /**
   * Names this frame as a flow's starting point — Figma's badge above the
   * artboard, and where Present begins.
   */
  flowStart?: string | null;

  /** this node is a main component — instances mirror it */
  isComponent?: boolean;
  /** this subtree is an instance of that main component */
  instanceOf?: string;
  /**
   * Properties edited locally inside an instance. Propagation from the main
   * skips these, which is what makes an instance useful rather than a copy.
   */
  overridden?: string[];
  /** vector nodes — points in the node's own coordinate space */
  points?: [number, number][];
  closed?: boolean;
  /** rounds the corners between segments */
  smooth?: number;
}

export type Doc = Record<string, SceneNode>;

export const ROOT_ID = 'root';

/** A node sitting directly on the page — an artboard — is positioned in world space. */
export function isArtboard(node: SceneNode, doc: Doc): boolean {
  return node.parent !== null && doc[node.parent]?.type === 'page';
}

/** True when the parent controls this node's position (i.e. it's in flex flow). */
export function isInFlow(node: SceneNode, doc: Doc): boolean {
  const parent = node.parent ? doc[node.parent] : null;
  return !!parent && parent.type !== 'page' && parent.flex !== null;
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

/** The outermost ancestor that still sits on the page — what a single click selects. */
export function topLevelOf(id: string, doc: Doc): string {
  let cur = doc[id];
  if (!cur) return id;
  while (cur.parent && doc[cur.parent] && doc[cur.parent].type !== 'page') {
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

export function descendants(id: string, doc: Doc, out: string[] = []): string[] {
  for (const child of doc[id]?.children ?? []) {
    out.push(child);
    descendants(child, doc, out);
  }
  return out;
}
