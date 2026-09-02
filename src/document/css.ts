import type { CSSProperties } from 'react';
import { effectStyle, effectsOf } from './effects';
import { isContainer } from './layers';
import { pathOfRegions, seededRegions, vectorRegions } from './regions';
import {
  fillRuleOf,
  isClosedShape,
  outlinePath,
  paintsWithPath,
  shapePath,
  subpathsOf,
  variableWidthPath,
} from './geometry';
import {
  cssFilter,
  filterId,
  isNeutral,
  needsSvgFilter,
  rotationStyle,
  type ImageAdjust,
} from './adjust';
import {
  isInFlow,
  type Align,
  type AlignContent,
  type Doc,
  type EndCap,
  type FlexSpec,
  type Justify,
  type NumericField,
  type Paint,
  type SceneNode,
  type ShaderSpec,
} from './types';

/**
 * Applies a paint's own alpha.
 *
 * CSS has no `background-opacity`, so a solid hex becomes rgba(). Gradients and
 * token references are passed through untouched — dimming those would mean
 * wrapping the node in an extra element, which would change the exported markup.
 */
/**
 * Composes a paint stack into one `background` value.
 *
 * CSS only allows a bare colour as the *last* layer, so every solid above the
 * base is expressed as a two-stop gradient of itself — the standard way to
 * stack flat colours, and it exports as ordinary CSS.
 */
function composePaints(paints: Paint[]): string {
  const visible = paints.filter((p) => p.visible !== false && p.value);
  if (!visible.length) return '';

  return visible
    .map((paint, index) => {
      const value = withAlpha(paint.value, paint.opacity ?? 1);
      const isFlat = !/gradient\(|^url\(/.test(value);
      const isLast = index === visible.length - 1;
      return isFlat && !isLast ? `linear-gradient(${value}, ${value})` : value;
    })
    .join(', ');
}

export function withAlpha(paint: string, alpha: number): string {
  if (alpha >= 1) return paint;
  const hex = /^#([0-9a-fA-F]{6})$/.exec(paint.trim());
  if (!hex) return paint;
  const value = parseInt(hex[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

const ALIGN_CSS: Record<Align, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const JUSTIFY_CSS: Record<Justify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};

const ALIGN_CONTENT_CSS: Record<AlignContent, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  between: 'space-between',
};

/**
 * `gap` is written row-first in CSS, so which of Figma's two gap fields lands
 * in which slot depends on the direction items flow in.
 */
function gapCss(flex: FlexSpec): string {
  const cross = flex.crossGap ?? flex.gap;
  const [row, column] =
    flex.mode === 'grid' || flex.direction === 'row' ? [cross, flex.gap] : [flex.gap, cross];
  return row === column ? `${row}px` : `${row}px ${column}px`;
}

/**
 * The single source of truth for how a node looks.
 *
 * The canvas renders real DOM with these styles and `export/toReact` serialises
 * the very same object, so a design cannot render one way and export another.
 */
/**
 * A field's value as CSS: the variable when one is bound, the number otherwise.
 *
 * Emitting `var()` rather than the resolved number is what makes the binding
 * live — the exported CSS moves with the token, instead of freezing whatever it
 * happened to be at export time.
 */
function bound(
  node: SceneNode,
  field: NumericField,
  tokens: Record<string, string>,
  /**
   * What the property being written measures in.
   *
   * A number variable is a bare number so it can serve a length, a ratio or a
   * count, and `calc` is what gives it the unit the property wants. `none` is
   * for the properties that want the number itself — `font-weight: 600` is not
   * a length, and wrapping it in `calc(… * 1px)` would break it. `percent` is
   * letter spacing, which the panel states as a percentage of the size but CSS
   * only accepts as a length: one percent of the em is `0.01em`.
   */
  unit: 'px' | 'none' | 'percent' = 'px',
): string | null {
  const id = node.vars?.[field];
  const name = id ? tokens[id] : undefined;
  if (!name) return null;
  if (unit === 'none') return `var(--${name})`;
  return `calc(var(--${name}) * ${unit === 'percent' ? '0.01em' : '1px'})`;
}

export function nodeStyle(node: SceneNode, doc: Doc, varNames: Record<string, string> = {}): CSSProperties {
  const style: CSSProperties = {};
  const parent = node.parent ? doc[node.parent] : null;
  const inFlow = isInFlow(node, doc);
  const parentAxis = parent?.flex?.direction ?? 'column';

  // ── Position ─────────────────────────────────────────────────────────
  if (!inFlow) {
    style.position = 'absolute';
    style.left = bound(node, 'x', varNames) ?? node.x;
    style.top = bound(node, 'y', varNames) ?? node.y;
  } else {
    style.position = 'relative';
  }

  // ── Size ─────────────────────────────────────────────────────────────
  const mainAxisIsWidth = parentAxis === 'row';

  // "Hug contents" needs contents. A leaf shape set to hug would collapse to
  // 0×0 and vanish from the canvas, so fall back to its fixed size.
  const canHug = node.type === 'text' || node.children.length > 0;
  const wMode = node.wMode === 'fit' && !canHug ? 'fixed' : node.wMode;
  const hMode = node.hMode === 'fit' && !canHug ? 'fixed' : node.hMode;

  if (wMode === 'fixed') style.width = bound(node, 'w', varNames) ?? node.w;
  else if (wMode === 'fit') style.width = 'fit-content';
  else if (inFlow && mainAxisIsWidth) style.flex = '1 1 0';
  else if (inFlow) style.alignSelf = 'stretch';
  else style.width = '100%';

  if (hMode === 'fixed') style.height = bound(node, 'h', varNames) ?? node.h;
  else if (hMode === 'fit') style.height = 'fit-content';
  else if (inFlow && !mainAxisIsWidth) style.flex = '1 1 0';
  else if (inFlow) style.alignSelf = 'stretch';
  else style.height = '100%';

  // Min and max bounds are handed to the browser rather than clamped here, so
  // a hugging or filling layer honours them while it is being laid out.
  if (node.minW != null) style.minWidth = node.minW;
  if (node.maxW != null) style.maxWidth = node.maxW;
  if (node.minH != null) style.minHeight = node.minH;
  if (node.maxH != null) style.maxHeight = node.maxH;

  const transforms: string[] = [];
  if (node.rotation) transforms.push(`rotate(${node.rotation}deg)`);
  if (node.flipH) transforms.push('scaleX(-1)');
  if (node.flipV) transforms.push('scaleY(-1)');
  if (transforms.length) style.transform = transforms.join(' ');

  // A child that opted out of its parent's auto layout still answers to the
  // cross-axis alignment it was given, so the override is applied last.
  if (inFlow && node.alignSelf && node.alignSelf !== 'auto') {
    style.alignSelf = ALIGN_CSS[node.alignSelf];
  }

  // Canvas stacking. CSS already paints later siblings on top, so only Figma's
  // "First on top" needs saying — and it has to be said on the child.
  if (inFlow && parent?.flex?.stacking === 'first') {
    const index = parent.children.indexOf(node.id);
    if (index >= 0) style.zIndex = parent.children.length - index;
  }

  // ── Layout of this node's own children ───────────────────────────────
  if (node.flex) {
    const flex = node.flex;
    if (flex.mode === 'grid') {
      style.display = 'grid';
      style.gridTemplateColumns = `repeat(${Math.max(1, flex.columns ?? 2)}, minmax(0, 1fr))`;
      // 0 rows means "however many the children need", which is grid's default
      if (flex.rows) style.gridTemplateRows = `repeat(${flex.rows}, minmax(0, 1fr))`;
      style.alignItems = ALIGN_CSS[flex.align];
      style.justifyItems =
        JUSTIFY_CSS[flex.justify] === 'space-between' ? 'stretch' : JUSTIFY_CSS[flex.justify];
    } else {
      style.display = 'flex';
      style.flexDirection = flex.direction;
      // Baseline alignment is a cross-axis rule, so it supersedes align rather
      // than sitting beside it — the same trade Figma's toggle makes.
      style.alignItems = flex.baseline ? 'baseline' : ALIGN_CSS[flex.align];
      style.justifyContent = JUSTIFY_CSS[flex.justify];
      if (flex.wrap) {
        style.flexWrap = 'wrap';
        style.alignContent = ALIGN_CONTENT_CSS[flex.alignContent ?? 'start'];
      }
    }
    style.gap = gapCss(flex);
    const [top, right, bottom, left] = flex.padding;
    style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    // "Strokes included in layout" is border-box: the stroke eats into the
    // frame instead of growing it.
    if (flex.strokesIncluded) style.boxSizing = 'border-box';
  } else if (node.type !== 'text') {
    // absolute children need a positioned ancestor
    style.display = 'block';
  }

  // ── Paint ────────────────────────────────────────────────────────────
  // A path shape paints through its own clipped layer (see `shapePaint`), and a
  // boolean group through its nested clips, so the box itself stays transparent
  // — a background here would draw the rectangle the shape is trying not to be.
  const pathPainted = paintsWithPath(node) || node.type === 'boolean';
  if (pathPainted) {
    style.background = undefined;
    style.overflow = 'visible';
  } else if (needsPaintLayers(node)) {
    // an adjusted or rotated image paints on its own element; a background here
    // would sit behind it, unadjusted, and show through anything transparent
    style.background = undefined;
  } else if (node.fills?.length) {
    const composed = composePaints(node.fills);
    if (composed) style.background = composed;
  } else if (node.fill && node.fillVisible !== false) {
    // Always the shorthand: shader presets are multi-layer values that may end
    // in a flat colour ("radial-gradient(…), radial-gradient(…), #C77BE8") or
    // carry position/size ("… 0 0 / 7px 7px"), neither of which is valid in
    // `background-image`.
    style.background = withAlpha(node.fill, node.fillOpacity ?? 1);
  }

  if (node.radii) {
    const [tl, tr, br, bl] = node.radii;
    style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
  } else if (node.radius || node.vars?.radius) {
    style.borderRadius = bound(node, 'radius', varNames) ?? node.radius;
  }

  // Figma's corner smoothing is CSS's superellipse: 2 is the circular corner
  // every rounded box already has, and higher exponents flatten it toward the
  // squircle. Browsers that do not know `corner-shape` ignore it and round.
  if (node.cornerSmoothing && (node.radius || node.radii)) {
    (style as Record<string, unknown>).cornerShape =
      `superellipse(${(2 + node.cornerSmoothing * 4).toFixed(2)})`;
  }

  // opacity is a ratio, not a length — the variable is a percentage of one
  const opacityToken = node.vars?.opacity;
  const opacityName = opacityToken ? varNames[opacityToken] : undefined;
  if (opacityName) style.opacity = `calc(var(--${opacityName}) / 100)`;
  else if (node.opacity !== 1) style.opacity = node.opacity;
  // Figma's "Normal" on a group is CSS's isolation — a Multiply child blends
  // against its siblings and stops at the group's edge — and "Pass through" is
  // the absence of it, which is what a plain element does anyway.
  if (node.blend === 'normal') {
    if (isContainer(node)) style.isolation = 'isolate';
  } else if (node.blend !== 'pass-through') {
    style.mixBlendMode = node.blend as CSSProperties['mixBlendMode'];
  }

  // Border, inner shadow and drop shadow all share `box-shadow`; the order here
  // is what stacks them correctly — insets first, drop last.
  const shadows: string[] = [];
  if (node.border && node.border.visible !== false && !pathPainted) {
    const { width, style: lineStyle, position, sides } = node.border;
    const color = withAlpha(node.border.color, node.border.opacity ?? 1);
    if (sides) {
      // Individual strokes have to be real borders: a box-shadow ring cannot
      // have four different widths, which is the whole point of the control.
      const [top, right, bottom, left] = sides;
      style.borderStyle = lineStyle ?? 'solid';
      style.borderColor = color;
      style.borderTopWidth = top;
      style.borderRightWidth = right;
      style.borderBottomWidth = bottom;
      style.borderLeftWidth = left;
      // an inside stroke eats into the box; an outside one grows it
      style.boxSizing = position === 'outside' ? 'content-box' : 'border-box';
    } else if (lineStyle && lineStyle !== 'solid') {
      // dashed/dotted can't be faked with a shadow, so use a real border
      style.border = `${width}px ${lineStyle} ${color}`;
      style.boxSizing = 'border-box';
    } else if (position === 'outside') {
      shadows.push(`0 0 0 ${width}px ${color}`);
    } else if (position === 'center') {
      const half = width / 2;
      shadows.push(`0 0 0 ${half}px ${color}`, `inset 0 0 0 ${half}px ${color}`);
    } else {
      shadows.push(`inset 0 0 0 ${width}px ${color}`);
    }
  }
  // The Effects list owns the shadows and the blurs; `effectsOf` reads a
  // pre-list document's `shadow`/`filters` back out as entries, so both shapes
  // of document render the same.
  const effects = effectsOf(node);
  const { inset, drop, filter: blurs, backdrop } = effectStyle(effects, node.clip);
  // A shape's shadow has to follow its outline, and `box-shadow` only knows
  // boxes. `drop-shadow()` reads the alpha of what was actually painted, so a
  // star casts a star. It is applied to the node, whose clipped fill layer and
  // stroke are its rendered content — CSS filters an element *before* its own
  // clip, which is why the clip lives on the layer inside rather than here.
  const dropFilters = pathPainted ? drop.map(asDropShadow) : [];
  if (!pathPainted) shadows.push(...inset, ...drop);
  if (shadows.length) style.boxShadow = shadows.join(', ');

  if (node.outline) {
    const { width, color, offset, style: lineStyle } = node.outline;
    style.outline = `${width}px ${lineStyle} ${color}`;
    style.outlineOffset = offset;
  }

  // Layer blur comes from the effects list; the rest of `filters` is this
  // canvas's colour adjustments, which Figma has no equivalent for.
  const parts: string[] = [...blurs, ...dropFilters];
  if (node.filters) {
    const f = node.filters;
    if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
    if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
    if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
    if (f.grayscale) parts.push(`grayscale(${f.grayscale})`);
    if (f.hueRotate) parts.push(`hue-rotate(${f.hueRotate}deg)`);
  }
  if (parts.length) style.filter = parts.join(' ');
  // background blur is a separate CSS property — it frosts what is behind
  if (backdrop.length) style.backdropFilter = backdrop.join(' ');

  if (node.clip) style.overflow = 'hidden';

  // ── Text ─────────────────────────────────────────────────────────────
  if (node.type === 'text' && node.font) {
    const f = node.font;
    style.fontFamily = f.family;
    style.fontSize = bound(node, 'fontSize', varNames) ?? f.size;
    style.fontWeight = bound(node, 'fontWeight', varNames, 'none') ?? f.weight;
    // The model keeps line height as a ratio, but the field states it in px and
    // so does a variable bound to it — a type scale says 16/24, not 16/1.5.
    style.lineHeight = bound(node, 'lineHeight', varNames) ?? f.lineHeight;
    style.letterSpacing =
      bound(node, 'letterSpacing', varNames, 'percent') ??
      (f.letterSpacing ? `${f.letterSpacing}em` : undefined);
    style.textAlign = f.align;
    style.color = f.color;
    style.whiteSpace = 'pre-wrap';
    style.wordBreak = 'break-word';

    if (f.case === 'small') {
      // small caps are the face's own glyphs, so this is a variant rather than
      // a transform — uppercasing the text would give the wrong letterforms
      style.fontVariantCaps = 'small-caps';
    } else if (f.case && f.case !== 'none') {
      style.textTransform =
        f.case === 'upper' ? 'uppercase' : f.case === 'lower' ? 'lowercase' : 'capitalize';
    }

    // Figma's "Truncate text": keep N lines and ellipsise the rest
    if (f.maxLines && f.maxLines > 0) {
      style.display = '-webkit-box';
      style.WebkitBoxOrient = 'vertical';
      style.WebkitLineClamp = f.maxLines;
      style.overflow = 'hidden';
    }

    // Truncation needs `-webkit-box`, so it and vertical alignment cannot both
    // own `display`. Truncating wins: it is the one that changes what the text
    // says, and a clipped line matters more than where the block sits.
    if (node.vAlign && node.vAlign !== 'top' && !f.maxLines) {
      style.display = 'flex';
      style.flexDirection = 'column';
      style.justifyContent = node.vAlign === 'middle' ? 'center' : 'flex-end';
    }

    if (node.underline) {
      const u = node.underline;
      style.textDecorationLine = u.line === 'strikethrough' ? 'line-through' : 'underline';
      style.textDecorationStyle = u.style as CSSProperties['textDecorationStyle'];
      style.textDecorationColor = u.color;
      style.textDecorationThickness = `${u.thickness}px`;
      style.textUnderlineOffset = `${u.offset}px`;
    }

    if (f.italic) style.fontStyle = 'italic';

    // `font-variant-numeric` is one property holding several independent
    // choices, so the checkboxes in the Details tab are collected rather than
    // written one at a time — the last declaration would otherwise win alone.
    const numerics: string[] = [];
    if (f.numeric === 'tabular') numerics.push('tabular-nums');
    else if (f.numeric === 'oldstyle') numerics.push('oldstyle-nums');
    if (f.slashedZero) numerics.push('slashed-zero');
    if (f.fractions) numerics.push('diagonal-fractions');
    if (f.ordinals) numerics.push('ordinal');
    if (numerics.length) style.fontVariantNumeric = numerics.join(' ');
    if (f.numberPosition && f.numberPosition !== 'normal') {
      style.fontVariantPosition = f.numberPosition;
    }

    // The two letter-case features are OpenType tags rather than keywords, so
    // they join whatever the escape hatch already asked for.
    const features = [...(f.features ?? [])];
    if (f.caseSensitive) features.push('case');
    if (f.capitalSpacing) features.push('cpsp');
    if (features.length) {
      style.fontFeatureSettings = features.map((tag) => `"${tag}"`).join(', ');
    }

    if (f.variations) {
      const axes = Object.entries(f.variations).filter(([, value]) => Number.isFinite(value));
      if (axes.length) {
        style.fontVariationSettings = axes.map(([tag, value]) => `"${tag}" ${value}`).join(', ');
      }
    }

    if (f.verticalTrim === 'cap') {
      // `text-box` is the shorthand; older engines that do not know it simply
      // keep the half-leading, which is the same result as trim being off
      (style as Record<string, unknown>).textBox = 'trim-both cap alphabetic';
    }
    if (f.wrap && f.wrap !== 'auto') style.textWrap = f.wrap;
    if (f.hangingPunctuation) {
      (style as Record<string, unknown>).hangingPunctuation = 'first last';
    }
    if (f.paragraphIndent) style.textIndent = `${f.paragraphIndent}px`;

    if (node.textStroke) {
      style.WebkitTextStrokeWidth = `${node.textStroke.width}px`;
      style.WebkitTextStrokeColor = node.textStroke.color;
    }
  }

  if (node.type === 'shader') {
    // the WebGL canvas fills the box; a background would only show through
    // while the context is still coming up
    style.overflow = 'hidden';
  }

  if (node.type === 'image' || (!pathPainted && /url\(/.test(String(style.background ?? '')))) {
    // set after `background` above — the shorthand would otherwise reset these
    if (node.type === 'image' && node.src) style.backgroundImage = `url(${node.src})`;
    Object.assign(style, imageSizing(node));
  }

  return style;
}

const CSS_PROP = /[A-Z]/g;

function kebab(prop: string): string {
  return prop.replace(CSS_PROP, (m) => `-${m.toLowerCase()}`);
}

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order']);

/** Serialise a style object to a CSS declaration block. */
export function styleToCss(style: CSSProperties, indent = '  '): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const value = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v);
      return `${indent}${kebab(k)}: ${value};`;
    })
    .join('\n');
}

/**
 * `box-shadow` syntax → `drop-shadow()` syntax.
 *
 * The filter takes no spread, so a spread shadow loses that much precision.
 * Growing the blur to compensate keeps the weight of the shadow about right,
 * which reads better than dropping the value on the floor.
 */
function asDropShadow(shadow: string): string {
  const parts = shadow.trim().split(/\s+(?![^(]*\))/);
  if (parts.length < 4) return `drop-shadow(${shadow})`;
  const [x, y, blur, spread, ...rest] = parts;
  const colour = rest.join(' ') || 'rgba(0,0,0,0.25)';
  const grown = parseFloat(blur) + Math.max(0, parseFloat(spread) || 0) * 2;
  return `drop-shadow(${x} ${y} ${Number.isFinite(grown) ? grown : parseFloat(blur) || 0}px ${colour})`;
}

/**
 * A paint that has to be drawn on an element of its own.
 *
 * A stack of ordinary paints composes into one `background`, which is the cheap
 * path and what almost every layer takes. An image that has been adjusted or
 * turned cannot: a filter applies to a whole element, and a background cannot
 * be rotated. Those paints get a layer each, in the same order they would have
 * composed in.
 */
export interface PaintLayer {
  id: string;
  style: CSSProperties;
  /** the SVG filter this layer needs, when CSS alone cannot express it */
  filter: { id: string; adjust: ImageAdjust } | null;
}

function paintNeedsLayer(paint: Paint): boolean {
  return /^url\(/.test(paint.value) && (!!paint.rotation || !isNeutral(paint.adjust));
}

export function needsPaintLayers(node: SceneNode): boolean {
  return (node.fills ?? []).some(paintNeedsLayer);
}

export function paintLayers(node: SceneNode): PaintLayer[] {
  const paints = (node.fills ?? []).filter((paint) => paint.visible !== false && paint.value);
  // the first paint is the front-most, and a later element paints on top
  return [...paints].reverse().map((paint) => {
    const image = /^url\(/.test(paint.value);
    const adjust = paint.adjust;
    const css = adjust ? cssFilter(adjust) : '';
    const svg = needsSvgFilter(adjust) ? filterId(node.id, paint.id) : null;
    const filters = [svg ? `url(#${svg})` : '', css].filter(Boolean).join(' ');

    return {
      id: paint.id,
      filter: svg && adjust ? { id: svg, adjust } : null,
      style: {
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        borderRadius: 'inherit',
        overflow: 'hidden',
        background: withAlpha(paint.value, paint.opacity ?? 1),
        ...(image ? imageSizing(node, paint) : null),
        ...(paint.rotation ? rotationStyle(paint.rotation, node.w, node.h) : null),
        ...(filters ? { filter: filters } : null),
      },
    };
  });
}

/**
 * The element a shader paint draws on.
 *
 * A shader is a live GPU surface, so unlike every other paint it cannot be a
 * `background` — it needs a canvas of its own. That canvas sits at the bottom
 * of the fill stack, beneath the layer's image paints and its children, which
 * is where a fill belongs. `overflow` and the inherited radius are what round
 * the surface off without clipping anything the layer contains.
 */
export function shaderSurface(node: SceneNode): { shader: ShaderSpec; style: CSSProperties } | null {
  if (!node.shader) return null;
  return {
    shader: node.shader,
    style: {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      overflow: 'hidden',
      borderRadius: 'inherit',
    },
  };
}

/** How a path shape's stroke is drawn. */
export interface ShapeStroke {
  color: string;
  width: number;
  dash: string | null;
  cap: 'butt' | 'round' | 'square';
  /**
   * The two ends, which Figma sets one at a time — an arrowhead lives here.
   * They fall back to `cap`, and while they agree and stay plain the renderer
   * draws them with `stroke-linecap` as it always did.
   */
  capStart: EndCap;
  capEnd: EndCap;
  join: 'miter' | 'round' | 'bevel';
  /**
   * SVG's miter limit, derived from Figma's miter *angle*.
   *
   * They are two spellings of one rule: SVG asks how many times longer than the
   * stroke the spike may get, Figma asks how sharp the corner may be before it
   * gives up. `limit = 1 / sin(angle / 2)` converts between them.
   */
  miterLimit?: number;
  /** `inside` and `outside` are drawn at double width and clipped to one half */
  align: 'inside' | 'center' | 'outside';
}

/**
 * The two layers a path shape paints with.
 *
 * The fill is ordinary CSS — a background clipped to the outline — so gradients,
 * images, paint stacks and blend modes all keep working on a star exactly as
 * they do on a rectangle. Only the stroke needs SVG, because CSS has no way to
 * draw a line along an arbitrary path.
 */
export interface ShapePaint {
  d: string;
  fillRule: 'nonzero' | 'evenodd';
  fill: CSSProperties | null;
  /** a shader paint, drawn on its own surface inside the clipped fill layer */
  shader: ShaderSpec | null;
  stroke: ShapeStroke | null;
  /**
   * The stroke as a filled band, when the path's points carry their own widths.
   *
   * SVG strokes one width per path, so a tapering line has to be drawn as the
   * shape it sweeps. Present only for a vector someone has actually varied.
   */
  band: string | null;
}

function dashOf(border: NonNullable<SceneNode['border']>): string | null {
  if (border.dash) return `${border.dash} ${border.gap ?? border.dash}`;
  if (border.style === 'dashed') return `${border.width * 4} ${border.width * 3}`;
  if (border.style === 'dotted') return `0 ${border.width * 2.2}`;
  return null;
}

/**
 * The `background` a node's paints compose to, ignoring where it is drawn.
 *
 * Shapes, boolean groups and the exporter all need the same value; only the
 * element it lands on differs.
 */
/**
 * How an image paint sits in its box.
 *
 * Every mode is a `background-size` and a `background-position`, which is why
 * cropping here costs nothing at export: the browser was always going to do
 * this arithmetic, and the exported CSS asks it for exactly the same thing.
 */
export function imageSizing(node: SceneNode, paint?: Paint): CSSProperties {
  // a paint may carry its own placement; the layer's is the fallback, which is
  // what a document written before paints had their own settings relies on
  const fit = paint?.fit ?? node.imageFit ?? 'fill';
  const scale = Math.max(paint?.scale ?? node.imageScale ?? 1, 0.01);
  const [ox, oy] = paint?.offset ?? node.imageOffset ?? [50, 50];

  switch (fit) {
    case 'fit':
      return { backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
    case 'tile':
      return {
        backgroundSize: `${Math.round(scale * 100)}%`,
        backgroundPosition: `${ox}% ${oy}%`,
        backgroundRepeat: 'repeat',
      };
    case 'crop':
      return {
        backgroundSize: `${Math.round(scale * 100)}%`,
        backgroundPosition: `${ox}% ${oy}%`,
        backgroundRepeat: 'no-repeat',
      };
    case 'fill':
    default:
      return { backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }
}

export function backgroundOf(node: SceneNode): string {
  if (node.fills?.length) return composePaints(node.fills);
  if (node.fill && node.fillVisible !== false) return withAlpha(node.fill, node.fillOpacity ?? 1);
  return '';
}

export function shapePaint(node: SceneNode): ShapePaint | null {
  if (!paintsWithPath(node)) return null;
  const d = shapePath(node) ?? outlinePath(node);
  const closed = isClosedShape(node);
  // A donut and a full ring are two wound rings; even-odd is what punches the
  // hole out of the middle.
  const fillRule = fillRuleOf(node);

  // Painted regions replace the outline as the thing the fill is clipped to.
  // Once a path has had one of its regions painted, the ones nobody painted are
  // empty — that is what makes a region a region rather than a decoration. The
  // cells are disjoint, so even-odd over all of them is exactly their union.
  const painted =
    node.type === 'vector' && node.fillSeeds
      ? pathOfRegions(
          seededRegions(vectorRegions(subpathsOf(node), node.smooth ?? 0), node.fillSeeds),
        )
      : null;
  const fillD = painted ?? d;
  const fillRuleUsed = painted ? 'evenodd' : fillRule;

  let fill: CSSProperties | null = null;
  // A shader paints on a surface of its own, so the clipped layer is worth
  // making for it even when the shape has no CSS background at all — that layer
  // is what confines the shader to the star instead of to the star's box.
  const shader = node.shader ?? null;
  // a path with every region unpainted has no fill left to draw
  if (closed && painted !== '') {
    const background = backgroundOf(node);
    if (background || shader) {
      fill = {
        position: 'absolute',
        inset: 0,
        ...(background ? { background } : null),
        // an image paint has to be told how to sit in the box, exactly as an
        // image node's does
        ...(background.includes('url(') ? imageSizing(node) : null),
        // `path()` takes the element's own coordinate space, which is exactly
        // the space the geometry was authored in
        clipPath: `path(${fillRuleUsed === 'evenodd' ? 'evenodd, ' : ''}'${fillD}')`,
        pointerEvents: 'none',
      };
    }
  }

  const border = node.border;
  const stroke: ShapeStroke | null =
    border && border.visible !== false && border.width > 0
      ? {
          color: withAlpha(border.color, border.opacity ?? 1),
          width: border.width,
          dash: dashOf(border),
          cap: border.cap ?? 'butt',
          capStart: border.capStart ?? border.cap ?? 'butt',
          capEnd: border.capEnd ?? border.cap ?? 'butt',
          join: border.join ?? 'miter',
          align: border.position ?? 'center',
        }
      : null;

  const band =
    node.type === 'vector' && stroke
      ? variableWidthPath(subpathsOf(node), stroke.width, node.smooth ?? 0)
      : null;

  return { d, fillRule, fill, shader: closed ? shader : null, stroke, band };
}
