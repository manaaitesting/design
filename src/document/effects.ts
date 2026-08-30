import type { CSSProperties } from 'react';
import type { Effect, EffectType, SceneNode, ShaderSpec } from './types';

/**
 * Effects.
 *
 * Figma's Effects list is ordered, individually hidable, and each entry carries
 * its own parameters. The model here is one flat `Effect` bag rather than a
 * discriminated union: a shadow's Blur and a layer blur's Blur are the same
 * control in the same place, so switching an effect's type in the popover keeps
 * whatever the two types share instead of resetting the row.
 *
 * Everything that CSS can put on the element itself — shadows, uniform blurs —
 * comes out of `effectStyle`. Everything that needs a surface of its own —
 * noise, texture, progressive blur, glass — comes out of `effectLayers` as a
 * plain absolutely-positioned div, so the canvas and the exported markup draw
 * the same thing.
 */

export const EFFECT_LABEL: Record<EffectType, string> = {
  'inner-shadow': 'Inner shadow',
  'drop-shadow': 'Drop shadow',
  'layer-blur': 'Layer blur',
  'background-blur': 'Background blur',
  noise: 'Noise',
  texture: 'Texture',
  glass: 'Glass',
  shader: 'Shader',
};

/** the order the + menu offers them in, and where Figma rules its hairline */
export const EFFECT_MENU: { type: EffectType; divider?: boolean }[] = [
  { type: 'inner-shadow' },
  { type: 'drop-shadow' },
  { type: 'layer-blur' },
  { type: 'background-blur' },
  { type: 'noise' },
  { type: 'texture' },
  { type: 'glass' },
  { type: 'shader', divider: true },
];

/**
 * The library behind the styles button in the section header.
 *
 * Figma lists the effect styles a file has published; this canvas has no style
 * library, so the button offers the stacks people reach for instead — each one
 * replaces the layer's effects, exactly as applying a style does.
 */
export const EFFECT_PRESETS: { name: string; effects: () => Effect[] }[] = [
  {
    name: 'Soft shadow',
    effects: () => [{ ...newEffect('drop-shadow'), y: 2, blur: 8, opacity: 0.12 }],
  },
  {
    name: 'Card elevation',
    effects: () => [
      { ...newEffect('drop-shadow'), y: 1, blur: 2, opacity: 0.08 },
      { ...newEffect('drop-shadow'), id: 'lift', y: 8, blur: 24, spread: -4, opacity: 0.16 },
    ],
  },
  {
    name: 'Inset well',
    effects: () => [{ ...newEffect('inner-shadow'), y: 2, blur: 6, opacity: 0.2 }],
  },
  {
    name: 'Frosted glass',
    effects: () => [{ ...newEffect('glass'), blur: 12, refraction: 0.5, depth: 10 }],
  },
  {
    name: 'Film grain',
    effects: () => [{ ...newEffect('noise'), variant: 'multi', grain: 0.12, sizeX: 0.4, sizeY: 0.4 }],
  },
  {
    name: 'Paper texture',
    effects: () => [{ ...newEffect('texture'), sizeX: 0.35, sizeY: 0.35, radius: 2 }],
  },
];

export const SHADOW_TYPES: EffectType[] = ['drop-shadow', 'inner-shadow'];
export const BLUR_TYPES: EffectType[] = ['layer-blur', 'background-blur'];

/** Figma's defaults, read off the reference panel. */
export function newEffect(type: EffectType): Effect {
  return {
    id: Math.random().toString(36).slice(2, 8),
    type,
    visible: true,
    x: 0,
    y: 4,
    blur: 4,
    spread: 0,
    color: '#000000',
    opacity: 0.25,
    blend: 'normal',
    progressive: false,
    start: 0,
    end: 4,
    variant: 'mono',
    sizeX: 0.5,
    sizeY: 0.5,
    density: 1,
    color2: '#FFFFFF',
    opacity2: 0.25,
    grain: 0.15,
    radius: 4,
    clip: false,
    refraction: 0.4,
    depth: 8,
  };
}

/**
 * The effects on a node, including documents written before the list existed.
 *
 * A legacy node keeps its shadow in `shadow`/`innerShadow`/`filters`; reading
 * those back as list entries is what stops an old file from looking like it
 * lost its effects the moment this panel opened.
 */
export function effectsOf(node: SceneNode): Effect[] {
  if (node.effects) return node.effects;

  const list: Effect[] = [];
  const shadow = (spec: NonNullable<SceneNode['shadow']>, type: EffectType, id: string): Effect => ({
    ...newEffect(type),
    id,
    x: spec.x,
    y: spec.y,
    blur: spec.blur,
    spread: spec.spread,
    ...splitColor(spec.color),
  });

  if (node.innerShadow) list.push(shadow(node.innerShadow, 'inner-shadow', 'legacy-inner'));
  if (node.shadow) list.push(shadow(node.shadow, 'drop-shadow', 'legacy-drop'));
  node.shadows?.forEach((spec, index) => list.push(shadow(spec, 'drop-shadow', `legacy-drop-${index}`)));
  if (node.filters?.blur) list.push({ ...newEffect('layer-blur'), id: 'legacy-blur', blur: node.filters.blur });
  if (node.filters?.backdropBlur) {
    list.push({ ...newEffect('background-blur'), id: 'legacy-backdrop', blur: node.filters.backdropBlur });
  }
  return list;
}

/**
 * Do two layers carry the same effects?
 *
 * The id is skipped: two shadows built the same way on two layers are the same
 * effect to the person looking at them, and saying "Mixed" because a random
 * suffix differs would be a lie about the design.
 */
export function sameEffects(a: Effect[], b: Effect[]): boolean {
  if (a.length !== b.length) return false;
  const shape = (effect: Effect) =>
    JSON.stringify(Object.entries(effect).filter(([key]) => key !== 'id').sort());
  return a.every((effect, index) => shape(effect) === shape(b[index]));
}

/** `rgba(0,0,0,0.25)` and `#RRGGBBAA` both read back as a hex and an alpha. */
export function splitColor(value: string): { color: string; opacity: number } {
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value.trim());
  if (rgba) {
    const hex = [rgba[1], rgba[2], rgba[3]]
      .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0'))
      .join('');
    return { color: `#${hex.toUpperCase()}`, opacity: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value.trim());
  if (long) return { color: `#${long[1].toUpperCase()}`, opacity: parseInt(long[2], 16) / 255 };
  return { color: value, opacity: 1 };
}

/** Pairs a colour with its own alpha, the way every effect stores it. */
export function rgba(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const value = parseInt(hex[1], 16);
  const parts = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return alpha >= 1 ? color : `rgba(${parts.join(', ')}, ${Number(alpha.toFixed(3))})`;
}

const shown = (effects: Effect[], type: EffectType) =>
  effects.filter((effect) => effect.type === type && effect.visible !== false);

/**
 * Whether a shadow has to be drawn on a layer of its own.
 *
 * `box-shadow` cannot blend, so a shadow with a blend mode moves onto its own
 * element, where `mix-blend-mode` applies. A drop shadow paints outside the
 * box, so on a clipping layer that would throw it away — there the blend is
 * dropped instead of the shadow.
 */
function blended(effect: Effect, clip: boolean): boolean {
  if (effect.blend === 'normal') return false;
  return effect.type === 'inner-shadow' || !clip;
}

/** The box-shadow, filter and backdrop-filter an effect list contributes. */
export function effectStyle(effects: Effect[], clip = false): {
  inset: string[];
  drop: string[];
  filter: string[];
  backdrop: string[];
} {
  const inset = shown(effects, 'inner-shadow')
    .filter((e) => !blended(e, clip))
    .map((e) => `inset ${shadowOf(e)}`);
  const drop = shown(effects, 'drop-shadow')
    .filter((e) => !blended(e, clip))
    .map((e) => shadowOf(e));
  // a progressive blur is drawn by its own masked layer, so only the uniform
  // ones belong on the element
  const filter = shown(effects, 'layer-blur')
    .filter((e) => !e.progressive)
    .map((e) => `blur(${e.blur}px)`);
  const backdrop = shown(effects, 'background-blur')
    .filter((e) => !e.progressive)
    .map((e) => `blur(${e.blur}px)`);

  return { inset, drop, filter, backdrop };
}

/** A layer that has to paint over the node rather than style it. */
export interface EffectLayer {
  id: string;
  style: CSSProperties;
  /** a shader effect paints a GPU surface into its layer */
  shader?: ShaderSpec | null;
}

const BASE_LAYER: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  borderRadius: 'inherit',
};

const shadowOf = (e: Effect) =>
  `${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${rgba(e.color, e.opacity)}`;

export function effectLayers(effects: Effect[], clip = false): EffectLayer[] {
  const layers: EffectLayer[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    if ((effect.type === 'inner-shadow' || effect.type === 'drop-shadow') && blended(effect, clip)) {
      layers.push({
        id: effect.id,
        style: {
          ...BASE_LAYER,
          boxShadow: effect.type === 'inner-shadow' ? `inset ${shadowOf(effect)}` : shadowOf(effect),
          mixBlendMode: effect.blend as CSSProperties['mixBlendMode'],
        },
      });
      continue;
    }

    if ((effect.type === 'layer-blur' || effect.type === 'background-blur') && effect.progressive) {
      // One masked backdrop layer: what it frosts is everything painted beneath
      // it, which inside the node is the node itself. The mask ramps the blur in
      // from `start` to `end` rather than switching it on at an edge.
      const from = Math.min(effect.start, effect.end);
      const to = Math.max(effect.start, effect.end);
      const fade = `linear-gradient(to bottom, rgba(0,0,0,${(from / Math.max(to, 0.001)).toFixed(3)}) 0%, #000 100%)`;
      layers.push({
        id: effect.id,
        style: {
          ...BASE_LAYER,
          backdropFilter: `blur(${to}px)`,
          WebkitBackdropFilter: `blur(${to}px)`,
          maskImage: fade,
          WebkitMaskImage: fade,
        } as CSSProperties,
      });
      continue;
    }

    if (effect.type === 'noise') {
      layers.push({
        id: effect.id,
        style: {
          ...BASE_LAYER,
          backgroundImage: noiseImage(effect),
          backgroundSize: 'cover',
          mixBlendMode:
            effect.blend === 'normal' ? undefined : (effect.blend as CSSProperties['mixBlendMode']),
        },
      });
      continue;
    }

    if (effect.type === 'texture') {
      layers.push({
        id: effect.id,
        style: {
          ...BASE_LAYER,
          backgroundImage: textureImage(effect),
          backgroundSize: 'cover',
          mixBlendMode: 'overlay',
          // "Clip to shape" is what keeps the grain off a rounded corner
          overflow: effect.clip ? 'hidden' : undefined,
          borderRadius: effect.clip ? 'inherit' : 0,
        },
      });
      continue;
    }

    if (effect.type === 'shader' && effect.shader) {
      layers.push({
        id: effect.id,
        style: { ...BASE_LAYER, mixBlendMode: effect.blend === 'normal' ? undefined : (effect.blend as CSSProperties['mixBlendMode']) },
        shader: effect.shader,
      });
      continue;
    }

    if (effect.type === 'glass') {
      const light = Math.min(0.6, 0.15 + effect.refraction * 0.5);
      layers.push({
        id: effect.id,
        style: {
          ...BASE_LAYER,
          backdropFilter: `blur(${effect.blur}px) saturate(${(1 + effect.refraction).toFixed(2)})`,
          WebkitBackdropFilter: `blur(${effect.blur}px) saturate(${(1 + effect.refraction).toFixed(2)})`,
          // the rim: a bright top-left edge and a dimmer bottom-right one, the
          // depth deciding how thick the glass reads
          boxShadow:
            `inset ${effect.depth / 8}px ${effect.depth / 8}px ${effect.depth / 2}px -${effect.depth / 4}px rgba(255,255,255,${light.toFixed(2)}), ` +
            `inset -${effect.depth / 8}px -${effect.depth / 8}px ${effect.depth / 2}px -${effect.depth / 4}px rgba(255,255,255,${(light / 2).toFixed(2)})`,
          backgroundImage: `linear-gradient(135deg, rgba(255,255,255,${(light / 3).toFixed(2)}), rgba(255,255,255,0) 60%)`,
        },
      });
    }
  }

  return layers;
}

/** feTurbulence, coloured in the filter itself so the layer is one image. */
function noiseImage(effect: Effect): string {
  const frequency = grainFrequency(effect.sizeX);
  const alpha = effect.density;
  const rects: string[] = [];
  const filters: string[] = [];

  if (effect.variant === 'multi') {
    filters.push(turbulence('n0', frequency, 0, `<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 ${(effect.grain * alpha).toFixed(3)}"/>`));
    rects.push('<rect width="100%" height="100%" filter="url(#n0)"/>');
  } else {
    filters.push(turbulence('n0', frequency, 0, tint(effect.color, effect.opacity * alpha)));
    rects.push('<rect width="100%" height="100%" filter="url(#n0)"/>');
    if (effect.variant === 'duo') {
      filters.push(turbulence('n1', frequency, 3, tint(effect.color2, effect.opacity2 * alpha)));
      rects.push('<rect width="100%" height="100%" filter="url(#n1)"/>');
    }
  }

  return svgUrl(`<defs>${filters.join('')}</defs>${rects.join('')}`);
}

/** A softer, larger grain — Figma's Texture is Noise with a radius on it. */
function textureImage(effect: Effect): string {
  const filter = turbulence(
    't0',
    grainFrequency(effect.sizeX),
    1,
    `<feColorMatrix type="saturate" values="0"/>` +
      `<feGaussianBlur stdDeviation="${(effect.radius / 8).toFixed(2)}"/>` +
      // a relief, not a stain: the grain reads through the paint underneath
      `<feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer>`,
    4,
  );
  return svgUrl(`<defs>${filter}</defs><rect width="100%" height="100%" filter="url(#t0)"/>`);
}

/** Figma's size is a grain diameter; feTurbulence wants its reciprocal. */
function grainFrequency(size: number): number {
  return Number((1 / Math.max(0.05, size) / 8).toFixed(4));
}

/** drops the turbulence's colour and keeps its alpha, tinted to `color` */
function tint(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const [r, g, b] = hex
    ? [0, 1, 2].map((i) => parseInt(hex[1].slice(i * 2, i * 2 + 2), 16) / 255)
    : [0, 0, 0];
  return (
    `<feColorMatrix type="matrix" values="0 0 0 0 ${r.toFixed(3)} 0 0 0 0 ${g.toFixed(3)} ` +
    `0 0 0 0 ${b.toFixed(3)} 0 0 0 ${alpha.toFixed(3)} 0"/>`
  );
}

function turbulence(id: string, frequency: number, seed: number, tail: string, octaves = 3): string {
  return (
    `<filter id="${id}" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/>` +
    `${tail}</filter>`
  );
}

function svgUrl(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
