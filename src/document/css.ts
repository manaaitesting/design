import type { CSSProperties } from 'react';
import { effectStyle, effectsOf } from './effects';
import {
  isInFlow,
  type Align,
  type AlignContent,
  type Doc,
  type FlexSpec,
  type Justify,
  type NumericField,
  type Paint,
  type SceneNode,
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

function withAlpha(paint: string, alpha: number): string {
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
): string | null {
  const id = node.vars?.[field];
  const name = id ? tokens[id] : undefined;
  if (!name) return null;
  // A number variable is a bare number, so it can serve a length, a ratio or a
  // count. `calc` is what gives it the unit the property being written wants.
  return `calc(var(--${name}) * 1px)`;
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
  // vectors paint through their <path>, so the box itself stays transparent
  if (node.type === 'vector') {
    style.background = undefined;
    style.overflow = 'visible';
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
  if (node.blend !== 'normal') style.mixBlendMode = node.blend as CSSProperties['mixBlendMode'];

  // Border, inner shadow and drop shadow all share `box-shadow`; the order here
  // is what stacks them correctly — insets first, drop last.
  const shadows: string[] = [];
  if (node.border && node.type !== 'vector') {
    const { width, color, style: lineStyle, position, sides } = node.border;
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
  shadows.push(...inset, ...drop);
  if (shadows.length) style.boxShadow = shadows.join(', ');

  if (node.outline) {
    const { width, color, offset, style: lineStyle } = node.outline;
    style.outline = `${width}px ${lineStyle} ${color}`;
    style.outlineOffset = offset;
  }

  // Layer blur comes from the effects list; the rest of `filters` is this
  // canvas's colour adjustments, which Figma has no equivalent for.
  const parts: string[] = [...blurs];
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
    style.fontSize = f.size;
    style.fontWeight = f.weight;
    style.lineHeight = f.lineHeight;
    style.letterSpacing = f.letterSpacing ? `${f.letterSpacing}em` : undefined;
    style.textAlign = f.align;
    style.color = f.color;
    style.whiteSpace = 'pre-wrap';
    style.wordBreak = 'break-word';

    if (f.case && f.case !== 'none') {
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

  if (node.type === 'image') {
    // set after `background` above — the shorthand would otherwise reset these
    if (node.src) style.backgroundImage = `url(${node.src})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
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
