/**
 * Prototype logic, kept out of the components that draw it.
 *
 * Two very different surfaces read from here — the connection noodles on the
 * canvas and the runtime that plays the prototype back — and they have to agree
 * on what a click does, or the arrows would lie about the thing they describe.
 */

import { newId } from '../lib/id';
import {
  ancestors,
  isArtboard,
  topLevelOf,
  type Doc,
  type Interaction,
  type Easing,
  type OverlaySpec,
  type PrototypeDevice,
  type SceneNode,
  type SpringSpec,
  type TransitionSpec,
} from './types';

export const DEFAULT_TRANSITION: TransitionSpec = {
  type: 'instant',
  direction: 'left',
  duration: 300,
  easing: 'ease-out',
};

/**
 * The seven curves, as cubic beziers.
 *
 * The first four are CSS keywords already; the "back" three overshoot, which is
 * why their control points step outside the 0–1 box.
 */
const CURVES: Record<string, string> = {
  linear: 'linear',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'ease-in-back': 'cubic-bezier(0.36, 0, 0.66, -0.56)',
  'ease-out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'ease-in-out-back': 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
};

/** Figma's four named springs. */
export const SPRINGS: Record<string, SpringSpec> = {
  gentle: { stiffness: 100, damping: 15, mass: 1 },
  quick: { stiffness: 300, damping: 20, mass: 1 },
  bouncy: { stiffness: 600, damping: 15, mass: 1 },
  slow: { stiffness: 80, damping: 20, mass: 1 },
};

export const DEFAULT_SPRING: SpringSpec = { stiffness: 200, damping: 20, mass: 1 };
export const DEFAULT_BEZIER: [number, number, number, number] = [0.42, 0, 0.58, 1];

/** Where a damped spring has got to, as a fraction of the distance, at time t. */
function springAt(spring: SpringSpec, t: number): number {
  const { stiffness: k, damping: c, mass: m } = spring;
  const omega = Math.sqrt(k / Math.max(m, 0.0001));
  const zeta = c / (2 * Math.sqrt(Math.max(k * m, 0.0001)));
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * omega * t) *
        (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
    );
  }
  // critically damped and beyond: no overshoot, just a slower arrival
  return 1 - Math.exp(-omega * t) * (1 + omega * t);
}

const SAMPLES = 40;

/**
 * A spring as a CSS easing.
 *
 * CSS has no spring, so the simulation is sampled into `linear()` — a
 * piecewise-linear curve through the positions the spring actually passes
 * through. Enough samples and the difference is invisible, and unlike a bezier
 * it can overshoot and settle the way a spring does.
 */
export function springCss(spring: SpringSpec, durationMs: number): string {
  const seconds = Math.max(durationMs, 1) / 1000;
  const stops: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * seconds;
    const value = i === SAMPLES ? 1 : springAt(spring, t);
    stops.push(Number(value.toFixed(4)).toString());
  }
  return `linear(${stops.join(', ')})`;
}

/** The spring a transition means, if it means one at all. */
export function springOf(spec: {
  easing: Easing;
  spring?: SpringSpec;
}): SpringSpec | null {
  if (spec.easing === 'custom-spring') return spec.spring ?? DEFAULT_SPRING;
  return SPRINGS[spec.easing] ?? null;
}

/** What to put in a CSS `transition-timing-function` for this transition. */
export function easingCss(spec: {
  easing: Easing;
  duration: number;
  bezier?: [number, number, number, number];
  spring?: SpringSpec;
}): string {
  const spring = springOf(spec);
  if (spring) return springCss(spring, spec.duration);
  if (spec.easing === 'custom-bezier') {
    const [x1, y1, x2, y2] = spec.bezier ?? DEFAULT_BEZIER;
    return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
  }
  return CURVES[spec.easing] ?? 'ease';
}

/**
 * The named curves as control points.
 *
 * `easingCss` can hand the browser a keyword — `ease-in` and its two
 * neighbours are keywords in CSS — but a sampler needs the numbers, so the
 * beziers the spec defines those keywords as are written out here beside the
 * three "back" curves, which were always beziers. `linear` needs no entry and
 * `custom-bezier` brings its own.
 */
const CURVE_POINTS: Record<string, [number, number, number, number]> = {
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'ease-in-back': [0.36, 0, 0.66, -0.56],
  'ease-out-back': [0.34, 1.56, 0.64, 1],
  'ease-in-out-back': [0.68, -0.6, 0.32, 1.6],
};

/** y of a cubic bezier at x, by bisection — enough for a readout or a test. */
function bezierAt([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (curve(mid, x1, x2) < x) low = mid;
    else high = mid;
  }
  return curve((low + high) / 2, y1, y2);
}

/**
 * How far along a transition is, as a fraction, when a fraction of its time has
 * passed.
 *
 * The canvas never calls this — there the browser interpolates, which is the
 * point of compiling to CSS. It is what lets the *model* be asked the same
 * question: what does this timeline read at 350ms, with no DOM in the room.
 */
export function easeAt(
  spec: { easing: Easing; duration: number; bezier?: [number, number, number, number]; spring?: SpringSpec },
  progress: number,
): number {
  const t = Math.min(1, Math.max(0, progress));
  const spring = springOf(spec);
  if (spring) return springAt(spring, (t * Math.max(spec.duration, 1)) / 1000);
  if (spec.easing === 'linear') return t;
  if (spec.easing === 'custom-bezier') return bezierAt(spec.bezier ?? DEFAULT_BEZIER, t);
  const points = CURVE_POINTS[spec.easing];
  return points ? bezierAt(points, t) : t;
}

/** A fresh interaction — Figma's default is a click that goes nowhere yet. */
export function newInteraction(patch: Partial<Interaction> = {}): Interaction {
  return {
    id: newId(),
    trigger: 'click',
    delay: 800,
    action: 'navigate',
    destination: null,
    transition: { ...DEFAULT_TRANSITION },
    ...patch,
  };
}

export function interactionsOf(node: SceneNode | undefined): Interaction[] {
  return node?.interactions ?? [];
}

/**
 * The artboards on a page, wherever they sit.
 *
 * A section is a way of organising a page's flows, not a way of taking boards
 * out of the prototype — in Figma a frame inside one is still a destination, a
 * flow starting point and a place a noodle can land. This walked
 * `page.children` and so lost every board the moment it was put in a section:
 * a noodle could still leave it, because the source side resolves through
 * `topLevelOf`, but nothing could point at it.
 */
export function artboardsOn(doc: Doc, pageId: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const id of doc[pageId]?.children ?? []) {
    const node = doc[id];
    if (!node) continue;
    if (node.type === 'frame') out.push(node);
    // one level: Figma does not nest sections, and a frame inside a frame is a
    // component of a screen rather than a screen
    else if (node.type === 'section') {
      for (const child of node.children) {
        const inner = doc[child];
        if (inner?.type === 'frame') out.push(inner);
      }
    }
  }
  return out;
}

/** Every frame you can navigate to: the artboards on this page. */
export function destinationsOn(doc: Doc, pageId: string): SceneNode[] {
  return artboardsOn(doc, pageId);
}

/** The artboard a layer belongs to — where a connection starts from. */
export function frameOf(id: string, doc: Doc): string | null {
  const node = doc[id];
  if (!node) return null;
  const top = topLevelOf(id, doc);
  return doc[top] && isArtboard(doc[top], doc) ? top : null;
}

export interface Connection {
  /** the layer carrying the interaction */
  from: string;
  to: string;
  interaction: Interaction;
}

/** Every navigate-to interaction on the page, for drawing the noodles. */
export function connectionsOn(doc: Doc, pageId: string): Connection[] {
  const out: Connection[] = [];
  const walk = (id: string): void => {
    const node = doc[id];
    if (!node) return;
    for (const interaction of interactionsOf(node)) {
      // every action that points somewhere gets a line, not only navigate:
      // an overlay or a scroll-to that Present honours was invisible on the
      // canvas, which made those flows unreadable without opening the panel
      const to = needsDestination(interaction.action) ? interaction.destination : null;
      if (to && doc[to]) out.push({ from: id, to, interaction });
    }
    for (const child of node.children) walk(child);
  };
  for (const child of doc[pageId]?.children ?? []) walk(child);
  return out;
}

export interface Flow {
  /** the frame the flow starts at */
  id: string;
  name: string;
}

/** Flow starting points, in document order — the list Present plays from. */
export function flowsOn(doc: Doc, pageId: string): Flow[] {
  return artboardsOn(doc, pageId)
    .filter((node) => !!node.flowStart)
    .map((node) => ({ id: node.id, name: node.flowStart || 'Flow 1' }));
}

/** The name a new starting point gets: Flow 1, Flow 2, … */
export function nextFlowName(doc: Doc, pageId: string): string {
  const taken = new Set(flowsOn(doc, pageId).map((flow) => flow.name));
  for (let i = 1; ; i++) {
    const name = `Flow ${i}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Where Present should open: the flow that contains the selection, else the
 * first flow on the page, else the first frame — the order Figma resolves in.
 */
export function openingFrame(doc: Doc, pageId: string, selection: string[]): string | null {
  const flows = flowsOn(doc, pageId);
  const selectedFrame = selection.map((id) => frameOf(id, doc)).find(Boolean) ?? null;
  if (selectedFrame && flows.some((flow) => flow.id === selectedFrame)) return selectedFrame;
  if (selectedFrame) return selectedFrame;
  if (flows.length) return flows[0].id;
  return destinationsOn(doc, pageId)[0]?.id ?? null;
}

/**
 * The interaction a viewer's gesture fires: the closest one at or above the
 * layer touched, since a click on a label inside a button means the button.
 */
export function hitInteraction(
  id: string,
  doc: Doc,
  trigger: Interaction['trigger'],
): { node: string; interaction: Interaction } | null {
  const chain = [doc[id], ...ancestors(id, doc)].filter(Boolean) as SceneNode[];
  for (const node of chain) {
    // a frame is only a hotspot when it carries the interaction itself
    const interaction = interactionsOf(node).find((entry) => entry.trigger === trigger);
    if (interaction) return { node: node.id, interaction };
  }
  return null;
}

/** Layers inside a frame that respond to a click — Figma's hotspot flash. */
export function hotspotsIn(frameId: string, doc: Doc): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    const node = doc[id];
    if (!node) return;
    if (interactionsOf(node).some((entry) => entry.trigger === 'click' || entry.trigger === 'press')) {
      out.push(id);
    }
    for (const child of node.children) walk(child);
  };
  walk(frameId);
  return out;
}

/** A layer's position relative to the artboard it lives on. */
export function offsetInFrame(id: string, frameId: string, doc: Doc): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current = doc[id];
  while (current && current.id !== frameId) {
    x += current.x;
    y += current.y;
    current = current.parent ? doc[current.parent] : undefined!;
    if (!current) break;
  }
  return { x, y };
}

/** A one-line summary of an interaction, as the panel and tooltips show it. */
export const TRIGGER_LABEL: Record<Interaction['trigger'], string> = {
  none: 'None',
  click: 'On click',
  drag: 'On drag',
  hover: 'While hovering',
  press: 'While pressing',
  key: 'Key/Gamepad',
  'mouse-enter': 'Mouse enter',
  'mouse-leave': 'Mouse leave',
  'mouse-down': 'Mouse down',
  'mouse-up': 'Mouse up',
  delay: 'After delay',
};

/**
 * Figma renames three of the triggers on a touch device, because a tap is not
 * a click and there is no mouse to press. The prototype device decides it.
 */
const TOUCH_LABEL: Partial<Record<Interaction['trigger'], string>> = {
  click: 'On tap',
  'mouse-down': 'Touch down',
  'mouse-up': 'Touch up',
};

export function triggerLabel(trigger: Interaction['trigger'], touch: boolean): string {
  return (touch && TOUCH_LABEL[trigger]) || TRIGGER_LABEL[trigger];
}

/**
 * The short forms the Interactions list uses.
 *
 * The row has three narrow columns, so it drops the "On" and the "While" that
 * the menu spells out — Figma writes "Tap", not "On tap", once you have chosen.
 */
const SHORT_TRIGGER: Record<Interaction['trigger'], string> = {
  none: 'None',
  click: 'Click',
  drag: 'Drag',
  hover: 'Hover',
  press: 'Press',
  key: 'Key',
  'mouse-enter': 'Mouse enter',
  'mouse-leave': 'Mouse leave',
  'mouse-down': 'Mouse down',
  'mouse-up': 'Mouse up',
  delay: 'Delay',
};

const SHORT_TOUCH: Partial<Record<Interaction['trigger'], string>> = {
  click: 'Tap',
  'mouse-down': 'Touch down',
  'mouse-up': 'Touch up',
};

export function shortTrigger(trigger: Interaction['trigger'], touch: boolean): string {
  return (touch && SHORT_TOUCH[trigger]) || SHORT_TRIGGER[trigger];
}

const TOUCH_DEVICES = new Set<string>(['phone', 'phone-large', 'tablet', 'watch']);

/** Whether the prototype is played with a finger rather than a pointer. */
export function isTouch(device: PrototypeDevice | undefined): boolean {
  return TOUCH_DEVICES.has(device ?? 'none');
}

export const ACTION_LABEL: Record<Interaction['action'], string> = {
  navigate: 'Navigate to',
  back: 'Back',
  url: 'Open link',
  'open-overlay': 'Open overlay',
  'close-overlay': 'Close overlay',
  'swap-overlay': 'Swap overlay with',
  'scroll-to': 'Scroll to',
  'set-variable': 'Set variable',
  'change-to': 'Change to',
  'set-mode': 'Set variable mode',
  conditional: 'Conditional',
  'play-pause': 'Play/Pause animation',
  'set-playhead': 'Set playhead',
  none: 'None',
};

export const DEFAULT_OVERLAY: OverlaySpec = {
  position: 'center',
  background: true,
  closeOnOutside: true,
};

/** Actions that need somewhere to go — the ones that show a destination menu. */
export function needsDestination(action: Interaction['action']): boolean {
  return (
    action === 'navigate' ||
    action === 'open-overlay' ||
    action === 'swap-overlay' ||
    action === 'scroll-to' ||
    // "Change to" points at a variant rather than a frame, but it is still a
    // destination as far as the panel is concerned
    action === 'change-to'
  );
}

export function describe(interaction: Interaction, doc: Doc): string {
  const named = interaction.destination ? doc[interaction.destination]?.name : null;
  const verb = ACTION_LABEL[interaction.action];
  const target = needsDestination(interaction.action)
    ? ` ${named ?? 'nothing'}`
    : interaction.action === 'url'
      ? ` ${interaction.url || 'a link'}`
      : '';
  return `${TRIGGER_LABEL[interaction.trigger]} → ${verb}${target}`;
}
