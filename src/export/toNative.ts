/**
 * SwiftUI and Android XML, for the Inspect tab.
 *
 * Figma's handoff offers the design as iOS and Android code beside the CSS, and
 * these are the same idea: not an app, but the layer as the platform would spell
 * it, close enough to paste into a view and recognise.
 *
 * Every visual property is read back out of `nodeStyle()` rather than off the
 * node. That is the invariant this file lives under: the canvas and the
 * exporters must never be able to disagree about how a layer looks, so there is
 * exactly one function that decides, and this translates its answer rather than
 * forming a second opinion.
 */
import type { CSSProperties } from 'react';
import { nodeStyle } from '../document/css';
import type { Doc, SceneNode, Token } from '../document/types';

/** What both emitters need to know about a layer, taken from its style. */
interface Read {
  width?: number;
  height?: number;
  /** null when the layer is laid out by its parent rather than placed */
  x?: number;
  y?: number;
  background?: string;
  radius?: number;
  opacity?: number;
  padding?: [number, number, number, number];
  gap?: number;
  row?: boolean;
  stack: boolean;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  border?: { width: number; color: string };
}

const px = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
};

/**
 * A CSS colour as `#RRGGBB` plus an alpha, or null when it is not a flat one.
 *
 * Gradients, images and shaders have no single colour, and inventing one for
 * them would be worse than leaving the fill out and saying so in a comment.
 */
export function flatColor(value: string | undefined): { hex: string; alpha: number } | null {
  if (!value) return null;
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const body = hex[1];
    const full =
      body.length === 3
        ? body
            .split('')
            .map((c) => c + c)
            .join('')
        : body;
    return { hex: `#${full.toUpperCase()}`, alpha: 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((p) => Number(p.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    const [r, g, b] = parts;
    const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
    const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return { hex: `#${(to(r) + to(g) + to(b)).toUpperCase()}`, alpha: a };
  }
  return null;
}

function read(node: SceneNode, doc: Doc, varNames: Record<string, string>): Read {
  const style = nodeStyle(node, doc, varNames) as CSSProperties & Record<string, unknown>;

  const padding = (() => {
    const raw = style.padding;
    if (typeof raw !== 'string') return undefined;
    const parts = raw.split(/\s+/).map(px);
    if (parts.length !== 4 || parts.some((n) => n === undefined)) return undefined;
    return parts as [number, number, number, number];
  })();

  const radius = (() => {
    const raw = style.borderRadius;
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return undefined;
    // four corners: only a single number survives the trip to a platform that
    // takes one corner radius, so an uneven set reports its largest
    const parts = raw.split(/\s+/).map(px).filter((n): n is number => n !== undefined);
    return parts.length ? Math.max(...parts) : undefined;
  })();

  const border = (() => {
    const raw = style.border;
    if (typeof raw !== 'string') return undefined;
    const match = /^([\d.]+)px\s+\S+\s+(.+)$/.exec(raw.trim());
    if (!match) return undefined;
    return { width: Number(match[1]), color: match[2] };
  })();

  return {
    width: px(style.width),
    height: px(style.height),
    x: style.position === 'absolute' ? px(style.left) : undefined,
    y: style.position === 'absolute' ? px(style.top) : undefined,
    background: typeof style.background === 'string' ? style.background : undefined,
    radius,
    opacity: typeof style.opacity === 'number' ? style.opacity : undefined,
    padding,
    gap: px(style.gap),
    row: style.flexDirection === 'row',
    stack: style.display === 'flex',
    color: typeof style.color === 'string' ? style.color : undefined,
    fontSize: px(style.fontSize),
    fontWeight: typeof style.fontWeight === 'number' ? style.fontWeight : undefined,
    border,
  };
}

// ── SwiftUI ──────────────────────────────────────────────────────────────

/** Figma's own names for the weights, which SwiftUI happens to share. */
function swiftWeight(weight: number | undefined): string | null {
  if (!weight || weight === 400) return null;
  const names: Record<number, string> = {
    100: 'ultraLight', 200: 'thin', 300: 'light', 500: 'medium',
    600: 'semibold', 700: 'bold', 800: 'heavy', 900: 'black',
  };
  return names[weight] ? `.${names[weight]}` : null;
}

function swiftColor(value: string | undefined): string | null {
  const flat = flatColor(value);
  if (!flat) return null;
  return flat.alpha < 1
    ? `Color(hex: "${flat.hex}").opacity(${round(flat.alpha)})`
    : `Color(hex: "${flat.hex}")`;
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

function swiftNode(node: SceneNode, doc: Doc, vars: Record<string, string>, depth: number): string[] {
  const pad = '    '.repeat(depth);
  const r = read(node, doc, vars);
  const lines: string[] = [];
  const modifiers: string[] = [];

  if (node.type === 'text') {
    lines.push(`${pad}Text(${JSON.stringify(node.text ?? '')})`);
    const weight = swiftWeight(r.fontWeight);
    if (r.fontSize) {
      modifiers.push(`.font(.system(size: ${round(r.fontSize)}${weight ? `, weight: ${weight}` : ''}))`);
    }
    const colour = swiftColor(r.color);
    if (colour) modifiers.push(`.foregroundStyle(${colour})`);
  } else if (node.children.length) {
    const open = r.stack ? (r.row ? 'HStack' : 'VStack') : 'ZStack';
    const spacing = r.stack && r.gap ? `(alignment: .top, spacing: ${round(r.gap)})` : '(alignment: .topLeading)';
    lines.push(`${pad}${open}${r.stack ? (r.gap ? `(spacing: ${round(r.gap)})` : '') : spacing} {`);
    for (const child of node.children) lines.push(...swiftNode(doc[child]!, doc, vars, depth + 1));
    lines.push(`${pad}}`);
    if (r.padding) {
      const [t, right, b, l] = r.padding;
      modifiers.push(
        t === right && right === b && b === l
          ? `.padding(${round(t)})`
          : `.padding(EdgeInsets(top: ${round(t)}, leading: ${round(l)}, bottom: ${round(b)}, trailing: ${round(right)}))`,
      );
    }
  } else {
    const shape = node.type === 'ellipse' ? 'Ellipse()' : r.radius ? `RoundedRectangle(cornerRadius: ${round(r.radius)})` : 'Rectangle()';
    const colour = swiftColor(r.background);
    lines.push(`${pad}${shape}`);
    if (colour) modifiers.push(`.fill(${colour})`);
    // a gradient, an image or a shader has no one colour to name
    else if (r.background) lines.push(`${pad}    // fill: ${r.background}`);
  }

  // a container's own paint goes behind it rather than into a shape
  if (node.children.length || node.type === 'text') {
    const colour = swiftColor(r.background);
    if (colour) {
      modifiers.push(
        r.radius
          ? `.background(RoundedRectangle(cornerRadius: ${round(r.radius)}).fill(${colour}))`
          : `.background(${colour})`,
      );
    }
  }

  if (r.width !== undefined || r.height !== undefined) {
    const parts = [
      r.width !== undefined ? `width: ${round(r.width)}` : null,
      r.height !== undefined ? `height: ${round(r.height)}` : null,
    ].filter(Boolean);
    modifiers.push(`.frame(${parts.join(', ')})`);
  }
  if (r.border) {
    const colour = swiftColor(r.border.color);
    if (colour) {
      modifiers.push(
        r.radius
          ? `.overlay(RoundedRectangle(cornerRadius: ${round(r.radius)}).stroke(${colour}, lineWidth: ${round(r.border.width)}))`
          : `.border(${colour}, width: ${round(r.border.width)})`,
      );
    }
  }
  if (r.opacity !== undefined && r.opacity !== 1) modifiers.push(`.opacity(${round(r.opacity)})`);
  // placed rather than flowed: SwiftUI has no absolute layout, so an offset
  // inside a ZStack is the honest equivalent
  if (r.x !== undefined && r.y !== undefined && (r.x || r.y)) {
    modifiers.push(`.offset(x: ${round(r.x)}, y: ${round(r.y)})`);
  }

  for (const modifier of modifiers) lines.push(`${pad}    ${modifier}`);
  return lines;
}

/**
 * The layer as a SwiftUI view.
 *
 * `Color(hex:)` is not in the standard library, so the extension that makes the
 * output compile travels with it — a snippet that needs a helper you are not
 * given is a snippet you cannot paste.
 */
export function toSwiftUI(rootId: string, doc: Doc, tokens: Token[] = []): string {
  const node = doc[rootId];
  if (!node) return '';
  const vars = Object.fromEntries(tokens.map((t) => [t.id, t.name]));
  const name = pascalCase(node.name || 'Layer');
  const body = swiftNode(node, doc, vars, 2);

  return [
    'import SwiftUI',
    '',
    `struct ${name}: View {`,
    '    var body: some View {',
    ...body,
    '    }',
    '}',
    '',
    'extension Color {',
    '    init(hex: String) {',
    '        let v = UInt64(hex.dropFirst(), radix: 16) ?? 0',
    '        self.init(',
    '            .sRGB,',
    '            red: Double((v >> 16) & 0xff) / 255,',
    '            green: Double((v >> 8) & 0xff) / 255,',
    '            blue: Double(v & 0xff) / 255',
    '        )',
    '    }',
    '}',
    '',
  ].join('\n');
}

// ── Android ──────────────────────────────────────────────────────────────

function androidColor(value: string | undefined): string | null {
  const flat = flatColor(value);
  if (!flat) return null;
  if (flat.alpha >= 1) return flat.hex;
  const alpha = Math.round(flat.alpha * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${alpha}${flat.hex.slice(1)}`;
}

function androidNode(node: SceneNode, doc: Doc, vars: Record<string, string>, depth: number): string[] {
  const pad = '    '.repeat(depth);
  const r = read(node, doc, vars);
  const attrs: string[] = [];
  const dp = (n: number) => `${Math.round(n)}dp`;

  attrs.push(`android:layout_width="${r.width !== undefined ? dp(r.width) : 'wrap_content'}"`);
  attrs.push(`android:layout_height="${r.height !== undefined ? dp(r.height) : 'wrap_content'}"`);
  const background = androidColor(r.background);
  if (background) attrs.push(`android:background="${background}"`);
  if (r.opacity !== undefined && r.opacity !== 1) attrs.push(`android:alpha="${round(r.opacity)}"`);
  if (r.padding) {
    const [t, right, b, l] = r.padding;
    attrs.push(`android:paddingTop="${dp(t)}"`, `android:paddingEnd="${dp(right)}"`);
    attrs.push(`android:paddingBottom="${dp(b)}"`, `android:paddingStart="${dp(l)}"`);
  }
  if (r.x !== undefined || r.y !== undefined) {
    if (r.x) attrs.push(`android:layout_marginStart="${dp(r.x)}"`);
    if (r.y) attrs.push(`android:layout_marginTop="${dp(r.y)}"`);
  }

  if (node.type === 'text') {
    attrs.push(`android:text=${JSON.stringify(node.text ?? '')}`);
    if (r.fontSize) attrs.push(`android:textSize="${Math.round(r.fontSize)}sp"`);
    const colour = androidColor(r.color);
    if (colour) attrs.push(`android:textColor="${colour}"`);
    if (r.fontWeight && r.fontWeight >= 600) attrs.push('android:textStyle="bold"');
    return [`${pad}<TextView`, ...attrs.map((a) => `${pad}    ${a}`), `${pad}    />`];
  }

  if (!node.children.length) {
    return [`${pad}<View`, ...attrs.map((a) => `${pad}    ${a}`), `${pad}    />`];
  }

  // a flowed container is a LinearLayout; a placed one is a FrameLayout, which
  // is the only Android box that lets its children sit where they were put
  const tag = r.stack ? 'LinearLayout' : 'FrameLayout';
  if (r.stack) {
    attrs.push(`android:orientation="${r.row ? 'horizontal' : 'vertical'}"`);
    // there is no gap: Android spaces children by their own margins
    if (r.gap) attrs.push(`<!-- gap ${round(r.gap)}dp: set layout_margin on the children -->`);
  }
  const open = [`${pad}<${tag}`, ...attrs.map((a) => `${pad}    ${a}`), `${pad}    >`];
  const kids = node.children.flatMap((id) => androidNode(doc[id]!, doc, vars, depth + 1));
  return [...open, ...kids, `${pad}</${tag}>`];
}

/** The layer as an Android layout. */
export function toAndroidXml(rootId: string, doc: Doc, tokens: Token[] = []): string {
  const node = doc[rootId];
  if (!node) return '';
  const vars = Object.fromEntries(tokens.map((t) => [t.id, t.name]));
  const body = androidNode(node, doc, vars, 0);
  // the namespace belongs on the outermost tag, which is the first line here
  const withNamespace = body[0] + '\n    xmlns:android="http://schemas.android.com/apk/res/android"';
  return ['<?xml version="1.0" encoding="utf-8"?>', withNamespace, ...body.slice(1), ''].join('\n');
}

function pascalCase(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[A-Za-z]/.test(joined) ? joined : `Layer${joined}`;
}
