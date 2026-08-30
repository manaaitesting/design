import {
  backgroundOf,
  imageSizing,
  needsPaintLayers,
  nodeStyle,
  paintLayers,
  shaderSurface,
  shapePaint,
  styleToCss,
  type ShapeStroke,
} from '../document/css';
import { colourMatrix, transferFunctions } from '../document/adjust';
import { effectLayers, effectsOf } from '../document/effects';
import { motionCss, timelinesIn } from '../document/motion';
import { booleanClips, decoratedEnds, endCapPath, END_CAP_BOX, paintsWithPath } from '../document/geometry';
import { booleanOutlinePath } from '../document/boolean';
import { maskStyles } from '../document/mask';
import { pathTextSpec, type PathTextSpec } from '../document/textpath';
import { defaultModes, modeVars, publish, resolveToken } from '../document/variables';
import type { CSSProperties } from 'react';
import type { Doc, SceneNode, ShaderSpec } from '../document/types';
import { DEFAULT_COLLECTION, type Collection } from '../document/variables';
import { fontFaceCss, googleHref, webFontsIn, type CustomFont } from '../lib/fonts';
import { isPlain, listBoxStyle, plainText, runLines, runStyle, runsOf } from '../document/text';
import { compose, defaultParams, SHADER_BY_ID } from '../webgl/shaders';
import type { Token } from '../document/store';

function slug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'node'}-${id.slice(0, 4)}`;
}

function escapeText(text: string): string {
  return text.replace(/[{}]/g, (c) => `{'${c}'}`);
}

function pascal(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  const joined = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `Component${joined}` : joined || 'Component';
}

interface Emitted {
  markup: string;
  css: string;
}

/**
 * Emits the subtree as JSX plus a stylesheet.
 *
 * The style objects come from `nodeStyle` — the very same function the canvas
 * renders with — so the exported component is not an approximation of the
 * design, it is the design.
 */
/**
 * The markup a text node's content becomes.
 *
 * Plain text is the string. Paragraph spacing and lists need the lines to be
 * real blocks first — the same split the canvas makes, so the export and the
 * artboard say the same thing. JSX and HTML disagree about how an inline style
 * is written, so the caller supplies that rather than the two growing apart.
 */
/**
 * A text layer that follows a path, as markup.
 *
 * The same `pathTextSpec` the canvas draws from, so the exported SVG puts every
 * letter where the canvas put it. Vector text, and selectable in a browser —
 * the glyphs are real text, laid out by the same engine.
 */
function pathTextMarkup(
  node: SceneNode,
  spec: PathTextSpec,
  className: string,
  pad: string,
  mode: 'jsx' | 'html',
  escape: (value: string) => string,
  inlineStyle: (declarations: Record<string, string | number>) => string,
): string {
  const font = node.font;
  const id = `${className}-textpath`;
  const attributes = [
    `fill="${font?.color ?? '#000000'}"`,
    font?.family ? `${attrName('fontFamily', mode)}="${escapeAttr(font.family)}"` : '',
    font?.size ? `${attrName('fontSize', mode)}="${font.size}"` : '',
    font?.weight ? `${attrName('fontWeight', mode)}="${font.weight}"` : '',
    font?.letterSpacing ? `${attrName('letterSpacing', mode)}="${font.letterSpacing}em"` : '',
    `${attrName('textAnchor', mode)}="${spec.anchor}"`,
  ]
    .filter(Boolean)
    .join(' ');

  const body = spec.plain
    ? escape(spec.runs.map((run) => run.text).join(''))
    : spec.runs
        .map((run) => {
          const style = runStyle(run, font) as Record<string, string | number>;
          const inner = escape(run.text);
          if (!Object.keys(style).length) return inner;
          return `<tspan ${inlineStyle(style)}>${inner}</tspan>`;
        })
        .join('');

  return (
    `${pad}  <svg ${styleAttr(SVG_LAYER, mode)} viewBox="0 0 ${Math.max(spec.width, 1)} ${Math.max(spec.height, 1)}" ` +
    `preserveAspectRatio="none">` +
    `<defs><path id="${id}" d="${spec.d}"/></defs>` +
    `<text ${attributes}>` +
    // `startOffset` and `side` are SVG's own spellings and stay as they are in
    // both modes: SVG has a handful of genuinely camelCase attributes, and
    // kebab-casing this one silently drops the offset
    `<textPath href="#${id}" startOffset="${spec.startOffset}" side="${spec.side}">` +
    `${body}</textPath></text></svg>`
  );
}

function textMarkup(
  node: SceneNode,
  escape: (value: string) => string,
  inlineStyle: (declarations: Record<string, string | number>) => string,
): string {
  const font = node.font;
  const spacing = font?.paragraphSpacing ?? 0;
  const list = font?.list && font.list !== 'none' ? font.list : null;
  const runs = runsOf(node);
  const plain = isPlain(runs);

  if (plain && !spacing && !list) return escape(plainText(runs));

  // a styled run becomes a span carrying only what it overrides — the rest is
  // still inherited from the layer's own rule, as it is on the canvas
  const body = (line: typeof runs): string =>
    plain
      ? escape(line.map((run) => run.text).join(''))
      : line
          .map((run) => {
            const style = runStyle(run, font) as Record<string, string | number>;
            const inner = escape(run.text);
            if (!Object.keys(style).length) return inner;
            return `<span ${inlineStyle(style)}>${inner}</span>`;
          })
          .join('');

  const lines = runLines(runs);
  const gap = (index: number) => (index && spacing ? ` ${inlineStyle({ marginTop: spacing })}` : '');

  if (!list && !spacing) return lines.map(body).join(escape('\n'));
  if (!list) return lines.map((line, i) => `<div${gap(i)}>${body(line)}</div>`).join('');

  const tag = list === 'number' ? 'ol' : 'ul';
  const items = lines.map((line, i) => `<li${gap(i)}>${body(line)}</li>`).join('');
  return `<${tag} ${inlineStyle(listBoxStyle(font) as Record<string, string | number>)}>${items}</${tag}>`;
}

/** A number variable is published unitless; everything else passes through. */
function tokenCssValue(token: Token): string {
  if (token.type !== 'number') return token.value;
  const match = /-?\d*\.?\d+/.exec(String(token.value));
  return match ? match[0] : token.value;
}

/** Token ids to names, so a bound field exports as the variable it follows. */
function namesOf(tokens: Token[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const token of tokens) names[token.id] = token.name;
  return names;
}

/** `style={{ marginTop: 8 }}` — JSX takes an object. */
function jsxStyle(declarations: Record<string, string | number>): string {
  const body = Object.entries(declarations)
    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : JSON.stringify(value)}`)
    .join(', ');
  return `style={{ ${body} }}`;
}

/** `style="margin-top: 8px"` — HTML takes a declaration block. */
/**
 * A style attribute, quoted safely.
 *
 * A font family is the reason this exists: `font-family: "Space Grotesk"` in a
 * `style="…"` attribute closes the attribute on its first quote, and the
 * browser silently drops every declaration after it — the layer keeps its
 * position and loses its type. Ten of the thirteen families here are quoted.
 */
function inlineStyle(css: string): string {
  return `style="${css.replace(/"/g, '&quot;')}"`;
}

/**
 * Wraps a layer's markup in its hyperlink, if it has one.
 *
 * A link that only worked on the canvas would be a note to the developer
 * rather than a link, so the export writes the anchor — the layer's box stays
 * exactly where it was, because the anchor takes `display: contents`.
 */
function linked(node: SceneNode, markup: string, mode: 'jsx' | 'html'): string {
  if (!node.link) return markup;
  const href = node.link.replace(/"/g, '&quot;');
  const rel = mode === 'jsx' ? 'rel="noreferrer noopener"' : 'rel="noreferrer noopener"';
  const style = mode === 'jsx' ? 'style={{ display: \'contents\' }}' : 'style="display: contents"';
  return `<a href="${href}" target="_blank" ${rel} ${style}>${markup}</a>`;
}

function htmlStyle(declarations: Record<string, string | number>): string {
  const body = Object.entries(declarations)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${name}: ${typeof value === 'number' && value !== 0 ? `${value}px` : value}`;
    })
    .join('; ');
  return inlineStyle(body);
}


function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * A shader surface, as markup.
 *
 * React gets the `Shader` component emitted with the component; HTML gets a
 * canvas the runtime script below picks up by attribute. Both carry the same id
 * and the same parameters, so the exported surface is the surface that was on
 * the canvas rather than a still of it.
 */
function shaderMarkup(spec: ShaderSpec, mode: 'jsx' | 'html'): string {
  // The canvas falls back to each parameter's own default for anything the node
  // never set, so the export has to carry the same resolved set — otherwise an
  // untouched slider reads as 0 in the export and the surface looks wrong.
  const def = SHADER_BY_ID.get(spec.id);
  const params = JSON.stringify(def ? { ...defaultParams(def), ...spec.params } : spec.params);
  if (mode === 'jsx') return `<Shader id="${spec.id}" params={${params}} />`;
  return (
    `<canvas data-shader="${spec.id}" data-params="${escapeAttr(params)}"` +
    ` style="display: block; width: 100%; height: 100%"></canvas>`
  );
}

/**
 * The canvas a shader *fill* paints on.
 *
 * A shader node paints one directly; every other layer wraps it in the same
 * surface `NodeView` gives it, which is what keeps the exported fill under the
 * layer's own radius instead of over its corners.
 */
function surfaceMarkup(
  node: SceneNode,
  pad: string,
  mode: 'jsx' | 'html',
  used: Set<string>,
): string {
  const surface = node.type === 'shader' ? null : shaderSurface(node);
  if (!surface) return '';
  used.add(surface.shader.id);
  return `${pad}  <div ${styleAttr(surface.style, mode)}>${shaderMarkup(surface.shader, mode)}</div>`;
}

/**
 * The extra elements an adjusted or rotated image paint needs.
 *
 * The canvas draws these with `PaintLayers`; the same styles are emitted here,
 * filter and all, so an image that was warmed up on the canvas is warmed up in
 * the export too.
 */
function paintMarkup(node: SceneNode, pad: string, mode: 'jsx' | 'html'): string {
  if (!needsPaintLayers(node)) return '';
  return paintLayers(node)
    .map((layer) => {
      const filter = layer.filter ? filterMarkup(layer.filter.id, layer.filter.adjust, mode) : '';
      return `${pad}  <div ${styleAttr(layer.style, mode)}>${filter}</div>`;
    })
    .join('\n');
}

/** The SVG filter behind temperature, tint, highlights and shadows. */
function filterMarkup(
  id: string,
  adjust: Parameters<typeof colourMatrix>[0],
  mode: 'jsx' | 'html',
): string {
  const matrix = colourMatrix(adjust).join(' ');
  const { exponent, intercept, slope } = transferFunctions(adjust);
  const gamma = ['R', 'G', 'B']
    .map((channel) => `<feFunc${channel} type="gamma" exponent="${exponent}" amplitude="1" offset="0"/>`)
    .join('');
  const linear = ['R', 'G', 'B']
    .map((channel) => `<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`)
    .join('');
  return (
    `<svg width="0" height="0" ${styleAttr({ position: 'absolute' }, mode)}>` +
    `<filter id="${id}" ${attrName('colorInterpolationFilters', mode)}="sRGB">` +
    `<feColorMatrix type="matrix" values="${matrix}"/>` +
    `<feComponentTransfer>${gamma}</feComponentTransfer>` +
    `<feComponentTransfer>${linear}</feComponentTransfer>` +
    `</filter></svg>`
  );
}

/**
 * A shape's two layers, as markup.
 *
 * The canvas draws these with `PathShape`; the strings below are the same
 * elements with the same styles, which is why an exported star is the star you
 * were looking at. The geometry itself is not restated — it comes from
 * `shapePaint`, exactly as the component's does.
 */
function shapeMarkup(
  node: SceneNode,
  pad: string,
  mode: 'jsx' | 'html',
  used: Set<string>,
): string {
  const paint = shapePaint(node);
  if (!paint) return '';
  const out: string[] = [];
  if (paint.fill) {
    // the shader goes inside the clipped layer, so the export fills the star
    // rather than the star's bounding box — the same nesting the canvas uses
    if (paint.shader) used.add(paint.shader.id);
    const inner = paint.shader ? shaderMarkup(paint.shader, mode) : '';
    // the same `data-paint` handle the canvas puts here, so a fill track on a
    // shape animates in the export as well
    out.push(`${pad}  <div data-paint="${node.id}" ${styleAttr(paint.fill, mode)}>${inner}</div>`);
  }
  if (paint.stroke && paint.band) {
    // a variable-width stroke is the band it sweeps, not a stroked line — the
    // canvas draws it that way and so must the export
    out.push(bandSvg(paint.band, paint.stroke.color, node.w, node.h, pad, mode));
  } else if (paint.stroke) {
    out.push(strokeSvg(node.id, paint.d, paint.stroke, paint.fillRule, node.w, node.h, pad, mode));
  }
  return out.join('\n');
}

/** A tapering stroke: one filled outline, wound so the middle stays empty. */
function bandSvg(
  d: string,
  color: string,
  width: number,
  height: number,
  pad: string,
  mode: 'jsx' | 'html',
): string {
  return (
    `${pad}  <svg ${styleAttr(SVG_LAYER, mode)} viewBox="0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}" ` +
    `preserveAspectRatio="none"><path d="${d}" fill="${color}" ${attrName('fillRule', mode)}="evenodd"/></svg>`
  );
}

/** A boolean group's nested clips and its outer stroke, as markup. */
function booleanMarkup(
  node: SceneNode,
  doc: Doc,
  pad: string,
  mode: 'jsx' | 'html',
  used: Set<string>,
): string {
  const parts = node.children.map((id) => doc[id]).filter((child) => child?.visible) as SceneNode[];
  if (!parts.length) return '';
  const clips = booleanClips(node, parts);
  if (!clips.length) return '';

  const background = backgroundOf(node);
  const shader = node.shader ?? null;
  if (shader) used.add(shader.id);
  let body =
    background || shader
      ? `<div ${styleAttr(
          {
            position: 'absolute',
            inset: 0,
            ...(background ? { background } : null),
            ...(background.includes('url(') ? imageSizing(node) : null),
          },
          mode,
        )}>${shader ? shaderMarkup(shader, mode) : ''}</div>`
      : '';
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i];
    const style = {
      position: 'absolute' as const,
      inset: 0,
      clipPath: `path(${clip.rule === 'evenodd' ? 'evenodd, ' : ''}'${clip.d}')`,
    };
    body = `<div ${styleAttr(style, mode)}>${body}</div>`;
  }

  const border = node.border;
  if (!border || border.width <= 0) return `${pad}  ${body}`;

  // the same outline the canvas strokes — computed once by the kernel, so the
  // exported edge is the edge you were looking at
  const d = booleanOutlinePath(node, parts);
  if (!d) return `${pad}  ${body}`;
  const stroke = strokeSvg(
    node.id,
    d,
    {
      color: border.color,
      width: border.width,
      dash: border.dash ? `${border.dash} ${border.gap ?? border.dash}` : null,
      cap: border.cap ?? 'butt',
      capStart: border.capStart ?? border.cap ?? 'butt',
      capEnd: border.capEnd ?? border.cap ?? 'butt',
      join: border.join ?? 'miter',
      align: border.position ?? 'center',
    },
    'evenodd',
    node.w,
    node.h,
    pad,
    mode,
  ).trimStart();

  return `${pad}  ${body}\n${pad}  ${stroke}`;
}

const SVG_LAYER: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
};

/** JSX and HTML spell SVG attributes differently; this is the whole difference. */
function attrName(name: string, mode: 'jsx' | 'html'): string {
  if (mode === 'jsx') return name;
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function styleAttr(style: CSSProperties, mode: 'jsx' | 'html'): string {
  if (mode === 'html') {
    return inlineStyle(styleToCss(style, '').replace(/\n/g, ' ').trim());
  }
  const body = Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : JSON.stringify(value)}`)
    .join(', ');
  return `style={{ ${body} }}`;
}

function strokeSvg(
  id: string,
  d: string,
  stroke: ShapeStroke,
  fillRule: 'nonzero' | 'evenodd',
  width: number,
  height: number,
  pad: string,
  mode: 'jsx' | 'html',
): string {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const clipped = stroke.align !== 'center';
  const drawWidth = clipped ? stroke.width * 2 : stroke.width;
  const room = Math.max(stroke.width * 2, 8);

  const defs =
    stroke.align === 'inside'
      ? `<defs><clipPath id="${id}-sc" clipPathUnits="userSpaceOnUse"><path d="${d}" ${attrName('clipRule', mode)}="${fillRule}"/></clipPath></defs>`
      : stroke.align === 'outside'
        ? `<defs><mask id="${id}-sm" maskUnits="userSpaceOnUse"><rect x="${-room}" y="${-room}" width="${w + room * 2}" height="${h + room * 2}" fill="#fff"/><path d="${d}" fill="#000" ${attrName('fillRule', mode)}="${fillRule}"/></mask></defs>`
        : '';

  const bind =
    stroke.align === 'inside'
      ? ` ${attrName('clipPath', mode)}="url(#${id}-sc)"`
      : stroke.align === 'outside'
        ? ` mask="url(#${id}-sm)"`
        : '';

  // the same markers the canvas draws the decorated ends with, so an exported
  // arrow is the arrow that was on screen rather than a bare line
  const marked = decoratedEnds(stroke.capStart, stroke.capEnd);
  const box = `viewBox="${-END_CAP_BOX} ${-END_CAP_BOX} ${END_CAP_BOX * 2} ${END_CAP_BOX * 2}" refX="0" refY="0" markerWidth="${END_CAP_BOX * 2}" markerHeight="${END_CAP_BOX * 2}" markerUnits="strokeWidth" orient="auto-start-reverse"`;
  const capOf = (which: 'start' | 'end') => (marked ? endCapPath(which === 'start' ? stroke.capStart : stroke.capEnd) : null);
  const capDefs = (['start', 'end'] as const)
    .map((which) => {
      const cap = capOf(which);
      return cap ? `<marker id="${id}-cap-${which}" ${box}><path d="${cap}" fill="${stroke.color}"/></marker>` : '';
    })
    .join('');

  return (
    `${pad}  <svg ${styleAttr(SVG_LAYER, mode)} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${defs}` +
    (capDefs ? `<defs>${capDefs}</defs>` : '') +
    `<path d="${d}" fill="none" stroke="${stroke.color}" ${attrName('strokeWidth', mode)}="${drawWidth}" ` +
    (stroke.dash ? `${attrName('strokeDasharray', mode)}="${stroke.dash}" ` : '') +
    (capOf('start') ? `${attrName('markerStart', mode)}="url(#${id}-cap-start)" ` : '') +
    (capOf('end') ? `${attrName('markerEnd', mode)}="url(#${id}-cap-end)" ` : '') +
    `${attrName('strokeLinecap', mode)}="${marked ? 'butt' : stroke.cap}" ${attrName('strokeLinejoin', mode)}="${stroke.join}" ` +
    (stroke.join === 'miter' && stroke.miterLimit
      ? `${attrName('strokeMiterlimit', mode)}="${stroke.miterLimit.toFixed(2)}" `
      : '') +
    `${attrName('vectorEffect', mode)}="non-scaling-stroke"${bind}/></svg>`
  );
}

/** The reset the canvas itself lays out under, scoped to one export. */
const BORDER_BOX = (root: string) =>
  `.${root},\n.${root} * {\n  box-sizing: border-box;\n}`;

export function toReact(
  rootId: string,
  doc: Doc,
  tokens: Token[] = [],
  collections: Collection[] = [DEFAULT_COLLECTION],
  customFonts: CustomFont[] = [],
): Emitted {
  const varNames = namesOf(tokens);
  const baseModes = defaultModes(collections);
  const rules: string[] = [];
  const usedShaders = new Set<string>();

  const walk = (id: string, depth: number, extra?: CSSProperties): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const className = slug(node.name, node.id);

    // a mask is resolved by the parent, so it arrives as extra style
    const style = {
      ...nodeStyle(node, doc, varNames),
      ...extra,
      ...modeVars(node, tokens, baseModes),
    };
    const masking = node.children.length ? maskStyles(node, doc) : null;
    // The root of an export shouldn't be absolutely positioned inside nothing —
    // but it still has to be the containing block its own children resolve
    // against, or every absolutely placed layer inside it escapes to the page.
    if (depth === 0) {
      style.position = 'relative';
      delete style.left;
      delete style.top;
    }
    rules.push(`.${className} {\n${styleToCss(style)}\n}`);

    // Noise, texture, progressive blur and glass paint on their own surface —
    // the canvas draws them as overlay divs, so the export has to as well.
    const layers = effectLayers(effectsOf(node), node.clip);
    layers.forEach((layer, index) => {
      rules.push(`.${className}-fx${index} {\n${styleToCss(layer.style)}\n}`);
    });
    const overlays = layers
      .map((layer, index) => {
        if (!layer.shader) return `${pad}  <div className="${className}-fx${index}" />`;
        usedShaders.add(layer.shader.id);
        return (
          `${pad}  <div className="${className}-fx${index}">` +
          `${shaderMarkup(layer.shader, 'jsx')}</div>`
        );
      })
      .join('\n');

    if (node.type === 'text') {
      const onPath = pathTextSpec(node, doc);
      if (onPath) {
        const svg = pathTextMarkup(node, onPath, className, pad, 'jsx', escapeText, jsxStyle);
        return `${pad}<div className="${className}">\n${[svg, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
      }
      const text = linked(node, textMarkup(node, escapeText, jsxStyle), 'jsx');
      if (!overlays) return `${pad}<div className="${className}">${text}</div>`;
      return `${pad}<div className="${className}">\n${pad}  ${text}\n${overlays}\n${pad}</div>`;
    }
    if (node.type === 'shader' && node.shader) {
      usedShaders.add(node.shader.id);
      const surface = `${pad}  ${shaderMarkup(node.shader, 'jsx')}`;
      return `${pad}<div className="${className}">\n${[surface, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    if (paintsWithPath(node)) {
      const shape = shapeMarkup(node, pad, 'jsx', usedShaders);
      return `${pad}<div className="${className}">\n${[shape, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    if (node.type === 'boolean') {
      const shape = booleanMarkup(node, doc, pad, 'jsx', usedShaders);
      return `${pad}<div className="${className}">\n${[shape, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    // a shader fill sits at the bottom of the stack, under the image paints
    const surface = surfaceMarkup(node, pad, 'jsx', usedShaders);
    const paints = paintMarkup(node, pad, 'jsx');
    if (node.children.length === 0) {
      const inner = [surface, paints, overlays].filter(Boolean).join('\n');
      if (!inner) return `${pad}<div className="${className}" />`;
      return `${pad}<div className="${className}">\n${inner}\n${pad}</div>`;
    }
    const children = [
      surface,
      paints,
      node.children
        .map((childId) => walk(childId, depth + 1, masking?.styles[childId]))
        .filter(Boolean)
        .join('\n'),
      overlays,
    ]
      .filter(Boolean)
      .join('\n');
    return `${pad}<div className="${className}">\n${children}\n${pad}</div>`;
  };

  const body = walk(rootId, 0);
  const name = pascal(doc[rootId]?.name ?? 'Component');

  // The canvas lays out under a border-box reset, so a layer's width is the
  // width you see whatever padding it carries. Exported CSS lands in someone
  // else's page, which may not do that — without this every padded frame comes
  // out wider than it was designed.
  rules.unshift(BORDER_BOX(slug(doc[rootId]?.name ?? 'component', rootId)));

  // Every timeline in the subtree, as the same `@keyframes` the canvas was
  // animating with — the root's own and any board nested inside it. They need
  // no runtime: an exported component animates because the stylesheet says so,
  // which is the whole reason the timeline compiles to CSS rather than to a
  // frame loop.
  for (const timeline of timelinesIn(doc, rootId)) {
    const animation = motionCss(timeline, doc, {
      selector: (id) => `.${slug(doc[id]?.name ?? 'layer', id)}`,
      playing: true,
    });
    if (animation) rules.push(animation);
  }

  const shaderRuntime = usedShaders.size ? emitShaderRuntime([...usedShaders]) : '';
  // a web face the design uses has to come with it, or the export renders in a
  // fallback and looks like a different design
  const fonts = fontImports(rootId, doc, customFonts);
  const stylesheet = fonts + rules.join('\n\n') + '\n';
  // only the tokens this subtree actually references — an export shouldn't drag
  // the whole theme along
  const root = emitTokenRoot(stylesheet, tokens, baseModes);

  const markup = `import './${slug(doc[rootId]?.name ?? 'component', rootId)}.css';
${usedShaders.size ? "import { Shader } from './Shader';\n" : ''}
export function ${name}() {
  return (
${body}
  );
}
${shaderRuntime}`;

  return { markup, css: root + stylesheet };
}

/**
 * `@import` lines for the web faces a subtree uses.
 *
 * Exported CSS that silently falls back to the system font is the classic
 * handoff bug: the design and the build look different and nobody can say why.
 */
function fontImports(rootId: string, doc: Doc, custom: CustomFont[] = []): string {
  const families = familiesIn(rootId, doc);
  const fonts = webFontsIn(families);
  // an uploaded face has to travel with the export, or it renders as a fallback
  const used = custom.filter((font) =>
    families.some((family) => family?.includes(`"${font.name}"`)),
  );
  const parts = [
    ...fonts.map((font) => `@import url('${googleHref(font)}');`),
    used.length ? fontFaceCss(used) : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join('\n')}\n\n` : '';
}

/** Every font family used in a subtree, in document order. */
function familiesIn(rootId: string, doc: Doc): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  const walk = (id: string) => {
    const node = doc[id];
    if (!node) return;
    if (node.font) out.push(node.font.family);
    node.children.forEach(walk);
  };
  walk(rootId);
  return out;
}

/**
 * Emits `:root { --name: value }` for every variable the CSS refers to.
 *
 * These are the default mode of each collection; a frame that overrides one
 * carries its own declarations in its own rule, so the export switches modes
 * the same way the canvas does.
 */
function emitTokenRoot(css: string, tokens: Token[], modes: Record<string, string>): string {
  const used = tokens.filter((token) => css.includes(`var(--${token.name})`));
  if (!used.length) return '';
  const byId = new Map(tokens.map((token) => [token.id, token]));
  // published the same way the canvas publishes them: a number is unitless,
  // and whoever uses it supplies the unit
  const declarations = used
    .map((token) => `  --${token.name}: ${publish(token, resolveToken(token, modes, byId))};`)
    .join('\n');
  return `:root {\n${declarations}\n}\n\n`;
}

/**
 * `{ id: `<glsl>` }` for the shaders a subtree uses.
 *
 * The React runtime and the HTML one both need the very same programs, so the
 * sources are composed once here rather than in each emitter.
 */
function fragmentMap(ids: string[]): string {
  return ids
    .map((id) => {
      const def = SHADER_BY_ID.get(id);
      if (!def) return '';
      const glsl = compose(def)
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      return `  ${JSON.stringify(id)}: \`${glsl}\`,`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * A self-contained WebGL runtime for the shaders this subtree uses.
 *
 * Emitted alongside the component rather than referenced as a dependency, so
 * the exported code runs with nothing installed.
 */
function emitShaderRuntime(ids: string[]): string {
  const sources = fragmentMap(ids);

  return `

/* ── Shader.jsx ────────────────────────────────────────────────────────────
   Drop this next to the component above. No dependencies.                  */

const VERTEX = \`#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
\`;

const FRAGMENTS = {
${sources}
};

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Shader({ id, params = {} }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) return;

    const build = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };

    const program = gl.createProgram();
    gl.attachShader(program, build(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, build(gl.FRAGMENT_SHADER, FRAGMENTS[id]));
    gl.linkProgram(program);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const start = performance.now();
    let frame;
    const draw = (now) => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), (now - start) / 1000);
      for (const [key, value] of Object.entries(params)) {
        const loc = gl.getUniformLocation(program, 'u_' + key);
        if (!loc) continue;
        if (typeof value === 'string') gl.uniform3f(loc, ...hexToRgb(value));
        else gl.uniform1f(loc, value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [id, params]);

  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
`;
}

/**
 * The same WebGL runtime, as a script tag for the standalone HTML.
 *
 * A shader is a GPU program, and there is no static markup that stands in for
 * one — so rather than emit a placeholder, the page carries the programs and
 * runs them. One shared frame loop drives every surface on the page, which is
 * what the canvas does too. Each canvas is found by its `data-shader`
 * attribute, so the markup above stays ordinary elements with ordinary styles.
 */
function emitHtmlShaderRuntime(ids: string[]): string {
  const sources = fragmentMap(ids);
  return `
    <script>
      (function () {
        const VERTEX = \`#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
\`;

        const FRAGMENTS = {
${sources}
        };

        function hexToRgb(hex) {
          const v = String(hex).replace('#', '');
          const n = parseInt(v.length === 3 ? v.split('').map(function (c) { return c + c; }).join('') : v, 16);
          return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        }

        function build(gl, type, src) {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          return s;
        }

        const live = [];
        const canvases = document.querySelectorAll('canvas[data-shader]');
        for (let i = 0; i < canvases.length; i++) {
          const canvas = canvases[i];
          const source = FRAGMENTS[canvas.getAttribute('data-shader')];
          if (!source) continue;
          const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
          if (!gl) continue;
          let program;
          try {
            program = gl.createProgram();
            gl.attachShader(program, build(gl, gl.VERTEX_SHADER, VERTEX));
            gl.attachShader(program, build(gl, gl.FRAGMENT_SHADER, source));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
          } catch (error) {
            console.error('[shader]', error);
            continue;
          }
          gl.useProgram(program);
          gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
          const attr = gl.getAttribLocation(program, 'a_pos');
          gl.enableVertexAttribArray(attr);
          gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
          let params = {};
          try { params = JSON.parse(canvas.getAttribute('data-params') || '{}'); } catch (error) {}
          live.push({ canvas: canvas, gl: gl, program: program, params: params });
        }
        if (!live.length) return;

        const start = performance.now();
        // one loop for every surface on the page: a frame each would cost a
        // scheduling slot per shader, which is what the editor avoids too
        function draw(now) {
          for (let i = 0; i < live.length; i++) {
            const s = live[i];
            const gl = s.gl;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(1, Math.round(s.canvas.clientWidth * dpr));
            const h = Math.max(1, Math.round(s.canvas.clientHeight * dpr));
            if (s.canvas.width !== w || s.canvas.height !== h) {
              s.canvas.width = w;
              s.canvas.height = h;
            }
            gl.useProgram(s.program);
            gl.viewport(0, 0, w, h);
            gl.uniform2f(gl.getUniformLocation(s.program, 'u_resolution'), w, h);
            gl.uniform1f(gl.getUniformLocation(s.program, 'u_time'), (now - start) / 1000);
            for (const key in s.params) {
              const loc = gl.getUniformLocation(s.program, 'u_' + key);
              if (!loc) continue;
              const value = s.params[key];
              if (typeof value === 'string') {
                const c = hexToRgb(value);
                gl.uniform3f(loc, c[0], c[1], c[2]);
              } else {
                gl.uniform1f(loc, value);
              }
            }
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
      })();
    </script>`;
}

/** Standalone HTML, styles inlined — paste into any page. */
export function toHtml(
  rootId: string,
  doc: Doc,
  tokens: Token[] = [],
  collections: Collection[] = [DEFAULT_COLLECTION],
  customFonts: CustomFont[] = [],
): string {
  const varNames = namesOf(tokens);
  const baseModes = defaultModes(collections);
  const usedShaders = new Set<string>();
  // An HTML export styles every layer inline, and an inline style has nothing
  // for a keyframe rule to hang off — so the layers a timeline drives are the
  // only ones that carry a handle, and the animation names them by it.
  const timelines = timelinesIn(doc, rootId);
  const animated = new Set(timelines.flatMap((spec) => spec.tracks.map((track) => track.node)));
  const walk = (id: string, depth: number, extra?: CSSProperties): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const mark = animated.has(id) ? `data-motion="${id}" ` : '';
    const style = {
      ...nodeStyle(node, doc, varNames),
      ...extra,
      ...modeVars(node, tokens, baseModes),
    };
    const masking = node.children.length ? maskStyles(node, doc) : null;
    // the root is still what its absolutely placed children resolve against
    if (depth === 0) {
      style.position = 'relative';
      delete style.left;
      delete style.top;
    }
    const inline = inlineStyle(styleToCss(style, '').replace(/\n/g, ' ').trim());
    const overlays = effectLayers(effectsOf(node), node.clip)
      .map((layer) => {
        if (layer.shader) usedShaders.add(layer.shader.id);
        const body = layer.shader ? shaderMarkup(layer.shader, 'html') : '';
        return `${pad}  <div ${inlineStyle(styleToCss(layer.style, '').replace(/\n/g, ' ').trim())}>${body}</div>`;
      })
      .join('\n');

    if (node.type === 'text') {
      const onPath = pathTextSpec(node, doc);
      if (onPath) {
        const svg = pathTextMarkup(node, onPath, slug(node.name, node.id), pad, 'html', (value) => value, htmlStyle);
        return `${pad}<div ${inline}>\n${[svg, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
      }
      const text = linked(node, textMarkup(node, (value) => value, htmlStyle), 'html');
      if (!overlays) return `${pad}<div ${mark}${inline}>${text}</div>`;
      return `${pad}<div ${mark}${inline}>\n${pad}  ${text}\n${overlays}\n${pad}</div>`;
    }
    if (node.type === 'shader' && node.shader) {
      usedShaders.add(node.shader.id);
      const surface = `${pad}  ${shaderMarkup(node.shader, 'html')}`;
      return `${pad}<div ${mark}${inline}>\n${[surface, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    if (paintsWithPath(node)) {
      const shape = shapeMarkup(node, pad, 'html', usedShaders);
      return `${pad}<div ${mark}${inline}>\n${[shape, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    if (node.type === 'boolean') {
      const shape = booleanMarkup(node, doc, pad, 'html', usedShaders);
      return `${pad}<div ${mark}${inline}>\n${[shape, overlays].filter(Boolean).join('\n')}\n${pad}</div>`;
    }
    // a shader fill sits at the bottom of the stack, under the image paints
    const surface = surfaceMarkup(node, pad, 'html', usedShaders);
    const paints = paintMarkup(node, pad, 'html');
    if (node.children.length === 0) {
      const inner = [surface, paints, overlays].filter(Boolean).join('\n');
      return `${pad}<div ${mark}${inline}>${inner ? `\n${inner}\n${pad}` : ''}</div>`;
    }
    const children = [
      surface,
      paints,
      node.children
        .map((childId) => walk(childId, depth + 1, masking?.styles[childId]))
        .filter(Boolean)
        .join('\n'),
      overlays,
    ]
      .filter(Boolean)
      .join('\n');
    return `${pad}<div ${mark}${inline}>\n${children}\n${pad}</div>`;
  };

  const body = walk(rootId, 0);
  const used = tokens.filter((token) => body.includes(`var(--${token.name})`));
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const style = used.length
    ? `\n    <style>:root {\n${used
        .map((t) => `      --${t.name}: ${publish(t, resolveToken(t, baseModes, byId))};`)
        .join('\n')}\n    }</style>`
    : '';

  const families = familiesIn(rootId, doc);
  const links = webFontsIn(families)
    .map((font) => `\n    <link rel="stylesheet" href="${googleHref(font)}">`)
    .join('');
  const faces = customFonts.filter((font) =>
    families.some((family) => family?.includes(`"${font.name}"`)),
  );
  const faceCss = faces.length ? `\n    <style>${fontFaceCss(faces)}</style>` : '';
  const animation = timelines
    .map((spec) => motionCss(spec, doc, { selector: (id) => `[data-motion="${id}"]`, playing: true }))
    .filter(Boolean)
    .join('\n\n');
  const motionStyle = animation ? `\n    <style>\n${animation}\n    </style>` : '';
  // The GLSL travels with the page. A shader has no static equivalent, so the
  // alternative was a comment where the surface should be — this emits the same
  // programs the canvas ran, driven by one shared frame loop.
  const runtime = usedShaders.size ? emitHtmlShaderRuntime([...usedShaders]) : '';

  return `<!doctype html>
<html>
  <head>
    <style>*, *::before, *::after { box-sizing: border-box }</style>${links}${faceCss}${style}${motionStyle}
  </head>
  <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#EEEEEE">
${body}${runtime}
  </body>
</html>
`;
}

export function toJson(rootId: string, doc: Doc): string {
  const collect = (id: string): SceneNode[] => {
    const node = doc[id];
    if (!node) return [];
    return [node, ...node.children.flatMap(collect)];
  };
  return JSON.stringify(collect(rootId), null, 2);
}
