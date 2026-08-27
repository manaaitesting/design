import type { CSSProperties } from 'react';
import { isInFlow, type Align, type Doc, type Justify, type Paint, type SceneNode } from './types';

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

/**
 * The single source of truth for how a node looks.
 *
 * The canvas renders real DOM with these styles and `export/toReact` serialises
 * the very same object, so a design cannot render one way and export another.
 */
export function nodeStyle(node: SceneNode, doc: Doc): CSSProperties {
  const style: CSSProperties = {};
  const parent = node.parent ? doc[node.parent] : null;
  const inFlow = isInFlow(node, doc);
  const parentAxis = parent?.flex?.direction ?? 'column';

  // ── Position ─────────────────────────────────────────────────────────
  if (!inFlow) {
    style.position = 'absolute';
    style.left = node.x;
    style.top = node.y;
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

  if (wMode === 'fixed') style.width = node.w;
  else if (wMode === 'fit') style.width = 'fit-content';
  else if (inFlow && mainAxisIsWidth) style.flex = '1 1 0';
  else if (inFlow) style.alignSelf = 'stretch';
  else style.width = '100%';

  if (hMode === 'fixed') style.height = node.h;
  else if (hMode === 'fit') style.height = 'fit-content';
  else if (inFlow && !mainAxisIsWidth) style.flex = '1 1 0';
  else if (inFlow) style.alignSelf = 'stretch';
  else style.height = '100%';

  const transforms: string[] = [];
  if (node.rotation) transforms.push(`rotate(${node.rotation}deg)`);
  if (node.flipH) transforms.push('scaleX(-1)');
  if (node.flipV) transforms.push('scaleY(-1)');
  if (transforms.length) style.transform = transforms.join(' ');

  // ── Layout of this node's own children ───────────────────────────────
  if (node.flex) {
    if (node.flex.mode === 'grid') {
      style.display = 'grid';
      style.gridTemplateColumns = `repeat(${Math.max(1, node.flex.columns ?? 2)}, minmax(0, 1fr))`;
      style.alignItems = ALIGN_CSS[node.flex.align];
      style.justifyItems = JUSTIFY_CSS[node.flex.justify] === 'space-between' ? 'stretch' : JUSTIFY_CSS[node.flex.justify];
    } else {
      style.display = 'flex';
      style.flexDirection = node.flex.direction;
      style.alignItems = ALIGN_CSS[node.flex.align];
      style.justifyContent = JUSTIFY_CSS[node.flex.justify];
      if (node.flex.wrap) style.flexWrap = 'wrap';
    }
    style.gap = node.flex.gap;
    const [top, right, bottom, left] = node.flex.padding;
    style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
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
  } else if (node.radius) {
    style.borderRadius = node.radius;
  }

  if (node.opacity !== 1) style.opacity = node.opacity;
  if (node.blend !== 'normal') style.mixBlendMode = node.blend as CSSProperties['mixBlendMode'];

  // Border, inner shadow and drop shadow all share `box-shadow`; the order here
  // is what stacks them correctly — insets first, drop last.
  const shadows: string[] = [];
  if (node.border && node.type !== 'vector') {
    const { width, color, style: lineStyle, position } = node.border;
    if (lineStyle && lineStyle !== 'solid') {
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
  if (node.innerShadow) {
    const { x, y, blur, spread, color } = node.innerShadow;
    shadows.push(`inset ${x}px ${y}px ${blur}px ${spread}px ${color}`);
  }
  for (const drop of [node.shadow, ...(node.shadows ?? [])]) {
    if (!drop) continue;
    shadows.push(`${drop.x}px ${drop.y}px ${drop.blur}px ${drop.spread}px ${drop.color}`);
  }
  if (shadows.length) style.boxShadow = shadows.join(', ');

  if (node.outline) {
    const { width, color, offset, style: lineStyle } = node.outline;
    style.outline = `${width}px ${lineStyle} ${color}`;
    style.outlineOffset = offset;
  }

  if (node.filters) {
    const f = node.filters;
    const parts: string[] = [];
    if (f.blur) parts.push(`blur(${f.blur}px)`);
    if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
    if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
    if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
    if (f.grayscale) parts.push(`grayscale(${f.grayscale})`);
    if (f.hueRotate) parts.push(`hue-rotate(${f.hueRotate}deg)`);
    if (parts.length) style.filter = parts.join(' ');
    // background blur is a separate CSS property — it frosts what is behind
    if (f.backdropBlur) style.backdropFilter = `blur(${f.backdropBlur}px)`;
  }

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

    if (node.vAlign && node.vAlign !== 'top') {
      style.display = 'flex';
      style.flexDirection = 'column';
      style.justifyContent = node.vAlign === 'middle' ? 'center' : 'flex-end';
    }

    if (node.underline) {
      const u = node.underline;
      style.textDecorationLine = 'underline';
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
