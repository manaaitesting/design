import { cloneAnchor } from './geometry';
import type { BooleanOp, Doc, FlexSpec, FontSpec, NodeType, SceneNode } from './types';

export const DEFAULT_FLEX: FlexSpec = {
  mode: 'flex',
  columns: 2,
  rows: 0,
  direction: 'column',
  gap: 16,
  crossGap: 16,
  padding: [16, 16, 16, 16],
  align: 'start',
  justify: 'start',
  wrap: false,
  alignContent: 'start',
  // Figma's advanced defaults
  strokesIncluded: false,
  stacking: 'last',
  baseline: false,
};

export const DEFAULT_FONT: FontSpec = {
  family: 'Inter, system-ui, sans-serif',
  size: 16,
  weight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,
  align: 'left',
  color: '#111111',
};

const BASE: Omit<SceneNode, 'id' | 'type' | 'name' | 'parent'> = {
  children: [],
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  wMode: 'fixed',
  hMode: 'fixed',
  rotation: 0,
  flex: null,
  clip: true,
  fill: '#FFFFFF',
  fillVisible: true,
  fillOpacity: 1,
  opacity: 1,
  blend: 'normal',
  radius: 0,
  radii: null,
  border: null,
  outline: null,
  shadow: null,
  innerShadow: null,
  filters: null,
  guides: null,
  video: null,
  flipH: false,
  flipV: false,
  aspectLocked: false,
  constraints: { h: 'start', v: 'start' },
};

export const DEFAULT_FILTERS = {
  blur: 0,
  backdropBlur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  grayscale: 0,
  hueRotate: 0,
};

export const DEFAULT_GUIDES = {
  type: 'columns' as const,
  count: 12,
  gutter: 16,
  margin: 24,
  size: 8,
  color: 'rgba(255,0,80,0.18)',
  visible: true,
  align: 'stretch' as const,
  width: 64,
};

const PER_TYPE: Partial<Record<NodeType, Partial<SceneNode>>> = {
  page: { fill: '#EEEEEE', clip: false, w: 0, h: 0 },
  // Figma's section: a tinted board you drop artboards onto. It never clips —
  // a frame dragged half out of one has to stay visible, not disappear.
  section: { fill: '#E9E9E9', clip: false, w: 800, h: 600, radius: 8, blend: 'pass-through' },
  // Figma's groups and frames start pass-through, so a Multiply child goes on
  // blending against the page behind them until you say otherwise
  frame: { fill: '#FFFFFF', blend: 'pass-through' },
  rect: { fill: '#DDDDDD', clip: false },
  ellipse: { fill: '#DDDDDD', radius: 9999, clip: false },
  text: {
    fill: null,
    clip: false,
    w: 120,
    h: 24,
    wMode: 'fit',
    hMode: 'fit',
    text: 'Text',
    vAlign: 'top' as const,
    underline: null,
    textStroke: null,
  },
  image: { fill: '#E5E5E5', w: 240, h: 160, clip: true },
  shader: { fill: null, w: 320, h: 320, clip: true, radius: 8 },
  vector: {
    fill: null,
    clip: false,
    anchors: [],
    closed: false,
    smooth: 0,
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  },
  polygon: { fill: '#DDDDDD', clip: false, sides: 3 },
  star: { fill: '#DDDDDD', clip: false, sides: 5, innerRatio: 0.4 },
  line: {
    fill: null,
    clip: false,
    h: 0,
    hMode: 'fixed',
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  },
  arrow: {
    fill: null,
    clip: false,
    h: 0,
    hMode: 'fixed',
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  },
  // a boolean group paints its children's combined outline, so its own box is
  // transparent and never clips — the same deal a group frame gets
  boolean: { fill: '#DDDDDD', clip: false, op: 'union' },
  // A slice paints nothing at all: it is a region to export, and the whole
  // point is that what comes out is whatever was under it.
  slice: { fill: null, fillVisible: false, clip: false, w: 200, h: 200 },
};

/** What a boolean group is called, by operation — Figma names them this way. */
export const BOOLEAN_LABEL: Record<BooleanOp, string> = {
  union: 'Union',
  subtract: 'Subtract',
  intersect: 'Intersect',
  exclude: 'Exclude',
};

export const TYPE_LABEL: Record<NodeType, string> = {
  page: 'Page',
  section: 'Section',
  frame: 'Frame',
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  image: 'Image',
  shader: 'Shader',
  vector: 'Vector',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
  boolean: 'Union',
  slice: 'Slice',
};

/**
 * Names are derived from the live document rather than a module counter so that
 * two collaborators creating nodes at the same time don't both mint "Frame 3".
 */
export function nameFor(type: NodeType, doc: Doc): string {
  const label = TYPE_LABEL[type];
  const taken = new Set(Object.values(doc).map((n) => n.name));
  if (!taken.has(label)) return label;
  for (let i = 2; ; i++) {
    const candidate = `${label} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function makeNode(
  id: string,
  type: NodeType,
  parent: string | null,
  patch: Partial<SceneNode> = {},
): SceneNode {
  const perType = PER_TYPE[type] ?? {};
  const flex = patch.flex ?? perType.flex ?? null;
  const font = patch.font ?? (type === 'text' ? DEFAULT_FONT : undefined);
  return {
    ...BASE,
    ...perType,
    ...patch,
    id,
    type,
    parent,
    name: patch.name ?? TYPE_LABEL[type],
    children: [...(patch.children ?? [])],
    // never share mutable sub-objects between nodes
    flex: flex ? { ...flex, padding: [...flex.padding] as FlexSpec['padding'] } : null,
    font: font ? { ...font } : undefined,
    shader: patch.shader ? { id: patch.shader.id, params: { ...patch.shader.params } } : undefined,
    radii: patch.radii ? ([...patch.radii] as [number, number, number, number]) : null,
    points: patch.points ? patch.points.map((point) => [...point] as [number, number]) : perType.points,
    anchors: patch.anchors ? patch.anchors.map(cloneAnchor) : perType.anchors,
  };
}
