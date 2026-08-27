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
  type SceneNode,
  type TransitionSpec,
} from './types';

export const DEFAULT_TRANSITION: TransitionSpec = {
  type: 'instant',
  direction: 'left',
  duration: 300,
  easing: 'ease-out',
};

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

/** Every frame you can navigate to: the artboards on this page. */
export function destinationsOn(doc: Doc, pageId: string): SceneNode[] {
  return (doc[pageId]?.children ?? [])
    .map((id) => doc[id])
    .filter((node): node is SceneNode => !!node && node.type === 'frame');
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
      const to = interaction.action === 'navigate' ? interaction.destination : null;
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
  return (doc[pageId]?.children ?? [])
    .map((id) => doc[id])
    .filter((node): node is SceneNode => !!node?.flowStart)
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
export function describe(interaction: Interaction, doc: Doc): string {
  const TRIGGER: Record<Interaction['trigger'], string> = {
    click: 'On click',
    hover: 'While hovering',
    press: 'While pressing',
    delay: 'After delay',
  };
  const target =
    interaction.action === 'navigate'
      ? (interaction.destination && doc[interaction.destination]?.name) || 'nothing'
      : interaction.action === 'back'
        ? 'back'
        : interaction.action === 'url'
          ? interaction.url || 'a link'
          : 'nothing';
  const verb =
    interaction.action === 'navigate'
      ? `Navigate to ${target}`
      : interaction.action === 'back'
        ? 'Back'
        : interaction.action === 'url'
          ? `Open ${target}`
          : 'None';
  return `${TRIGGER[interaction.trigger]} → ${verb}`;
}
