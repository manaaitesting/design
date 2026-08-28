/**
 * Variables, collections and modes.
 *
 * A variable on its own is one value. A collection gives a set of variables
 * several *modes* — light and dark, compact and comfortable, one brand and
 * another — and a frame can say which mode it is showing. That is what makes
 * variables worth having rather than being named constants.
 *
 * All of it lands on CSS custom properties, which already work this way: the
 * root declares the default mode, a frame that overrides one re-declares those
 * same names on itself, and everything inside inherits. Nothing here is a
 * runtime; it is the cascade.
 */

import type { SceneNode, Token } from './types';

/**
 * Where a variable is allowed to be applied.
 *
 * Figma calls this scoping, and it exists because a token list without it
 * becomes unusable at about thirty variables: every colour picker offers every
 * colour, including the ones that are only ever meant to be borders. A variable
 * with no scopes is offered everywhere its *type* makes sense, which is what a
 * document that never sets one expects.
 */
export type VarScope =
  | 'fill'
  | 'stroke'
  | 'text'
  | 'effect'
  | 'size'
  | 'position'
  | 'gap'
  | 'radius'
  | 'strokeWidth'
  | 'opacity';

export const COLOR_SCOPES: VarScope[] = ['fill', 'stroke', 'text', 'effect'];
export const NUMBER_SCOPES: VarScope[] = [
  'size',
  'position',
  'gap',
  'radius',
  'strokeWidth',
  'opacity',
];

export const SCOPE_LABEL: Record<VarScope, string> = {
  fill: 'Fill',
  stroke: 'Stroke',
  text: 'Text',
  effect: 'Effect',
  size: 'Width and height',
  position: 'Position',
  gap: 'Gap and padding',
  radius: 'Corner radius',
  strokeWidth: 'Stroke weight',
  opacity: 'Opacity',
};

/** Which scope a numeric field belongs to, for filtering the variable menu. */
export const FIELD_SCOPE: Record<string, VarScope> = {
  x: 'position',
  y: 'position',
  w: 'size',
  h: 'size',
  radius: 'radius',
  opacity: 'opacity',
};

/**
 * True when a variable may be offered for this use.
 *
 * An empty or missing scope list means "wherever the type fits" — scoping is
 * something you opt into once a library is big enough to need it.
 */
export function inScope(token: Token, scope: VarScope): boolean {
  if (token.hidden) return false;
  if (!token.scopes?.length) return true;
  return token.scopes.includes(scope);
}

export interface Mode {
  id: string;
  name: string;
}

export interface Collection {
  id: string;
  name: string;
  modes: Mode[];
  /** the mode the canvas root publishes */
  defaultMode: string;
}

/**
 * The collection every variable belongs to until someone makes another one.
 *
 * A document that has only ever had a flat token list still resolves through
 * the same path this way, with `value` acting as the one mode's value — so
 * modes can be added later without a migration.
 */
export const DEFAULT_COLLECTION_ID = 'default';

export const DEFAULT_COLLECTION: Collection = {
  id: DEFAULT_COLLECTION_ID,
  name: 'Theme',
  modes: [{ id: 'default', name: 'Default' }],
  defaultMode: 'default',
};

export function collectionOf(token: Token): string {
  return token.collection ?? DEFAULT_COLLECTION_ID;
}

/** The mode each collection is showing, unless a frame says otherwise. */
export function defaultModes(collections: Collection[]): Record<string, string> {
  const modes: Record<string, string> = {};
  for (const collection of collections) {
    modes[collection.id] = collection.defaultMode ?? collection.modes[0]?.id ?? 'default';
  }
  return modes;
}

/**
 * A variable's value in a given set of modes.
 *
 * Aliases are followed rather than copied, so re-pointing `--surface` at
 * `--grey-100` moves everything wearing it. The depth limit is what stops a
 * cycle — two variables pointing at each other — from hanging the canvas.
 */
export function resolveToken(
  token: Token,
  modes: Record<string, string>,
  byId: Map<string, Token>,
  depth = 0,
): string {
  if (token.alias && depth < 8) {
    const target = byId.get(token.alias);
    if (target && target.id !== token.id) return resolveToken(target, modes, byId, depth + 1);
  }
  const mode = modes[collectionOf(token)];
  const perMode = mode ? token.values?.[mode] : undefined;
  return perMode ?? token.value;
}

/**
 * A number variable is published unitless.
 *
 * Whoever uses it supplies the unit — `calc(var(--x) * 1px)` for a length,
 * `calc(var(--x) / 100)` for a ratio. Publishing "16px" instead would make the
 * variable usable as a width and nowhere else.
 */
export function publish(token: Token, value: string): string {
  if (token.type !== 'number') return value;
  const match = /-?\d*\.?\d+/.exec(String(value));
  return match ? match[0] : value;
}

/** Every variable as a CSS custom property, resolved in the given modes. */
export function tokenVars(tokens: Token[], modes: Record<string, string>): Record<string, string> {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const vars: Record<string, string> = {};
  for (const token of tokens) {
    vars[`--${token.name}`] = publish(token, resolveToken(token, modes, byId));
  }
  return vars;
}

/**
 * The custom properties a frame re-declares because it overrides a mode.
 *
 * Only the variables in the overridden collections are written: a frame set to
 * dark should not freeze the values of a collection it said nothing about.
 */
export function modeVars(
  node: Pick<SceneNode, 'modes'>,
  tokens: Token[],
  base: Record<string, string>,
): Record<string, string> {
  const overrides = node.modes;
  if (!overrides || !Object.keys(overrides).length) return {};
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const modes = { ...base, ...overrides };
  const vars: Record<string, string> = {};
  for (const token of tokens) {
    if (!(collectionOf(token) in overrides)) continue;
    vars[`--${token.name}`] = publish(token, resolveToken(token, modes, byId));
  }
  return vars;
}

/** True when this type can carry a mode override — Figma allows it on frames. */
export function canHoldModes(node: SceneNode): boolean {
  return (
    node.type === 'frame' ||
    node.type === 'section' ||
    node.type === 'page' ||
    node.type === 'boolean'
  );
}
