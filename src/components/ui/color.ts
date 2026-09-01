/**
 * Colour maths for the paint picker.
 *
 * The picker edits HSV because that is what a saturation/value square and a hue
 * strip are, but the document stores hex — so every value that leaves here is
 * converted back. Round-tripping through HSV loses hue when a colour is pure
 * black or grey, which is why the picker keeps hue in its own state rather than
 * re-deriving it from the value on every render.
 */

export interface Hsv {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hsvToHex = (hsv: Hsv): string => rgbToHex(...hsvToRgb(hsv));
export const hexToHsv = (hex: string): Hsv => rgbToHsv(...hexToRgb(hex));

export function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
}

/** The formats Figma offers in the picker's dropdown. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'css';

export function formatColor(hex: string, format: ColorFormat, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (format === 'rgb') {
    return alpha < 1
      ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(alpha)})`
      : `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
  }
  if (format === 'hsl') {
    const { h, s, v } = rgbToHsv(r, g, b);
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return `${Math.round(h)}, ${Math.round(sl * 100)}%, ${Math.round(l * 100)}%`;
  }
  if (format === 'css') {
    return alpha < 1
      ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${Math.round(alpha * 100)}%)`
      : hex.toLowerCase();
  }
  return hex.replace('#', '').toUpperCase();
}

/** Parses whatever the user types back into a hex, whichever format is showing. */
export function parseColor(input: string, format: ColorFormat): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (format === 'rgb' || format === 'css') {
    const parts = raw.replace(/^rgba?\(|\)$/gi, '').split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map(Number);
      if ([r, g, b].every(Number.isFinite)) return rgbToHex(r, g, b);
    }
  }
  if (format === 'hsl') {
    const parts = raw.replace(/^hsla?\(|\)$/gi, '').split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const h = Number.parseFloat(parts[0]);
      const s = Number.parseFloat(parts[1]) / 100;
      const l = Number.parseFloat(parts[2]) / 100;
      if ([h, s, l].every(Number.isFinite)) {
        const v = l + s * Math.min(l, 1 - l);
        return hsvToHex({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
      }
    }
  }

  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex.split('').map((c) => c + c).join('')}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolves whatever is stored on a paint into a hex the picker can edit.
 *
 * A fill is not always a hex: it can be `var(--ink)`, an `rgb()`, or a named
 * colour. Opening the picker on one of those used to fall back to grey, so the
 * spectrum started in the wrong place and the first drag replaced the colour
 * with something unrelated to what was on screen.
 */
export function resolveColor(
  value: string,
  tokens: { name: string; value: string }[] = [],
  depth = 0,
): string | null {
  const raw = value?.trim();
  if (!raw || depth > 4) return null;
  if (isHex(raw)) return parseColor(raw, 'hex');

  const variable = raw.match(/^var\(\s*--([\w-]+)\s*(?:,([^)]*))?\)$/);
  if (variable) {
    const token = tokens.find((t) => t.name === variable[1]);
    if (token) return resolveColor(token.value, tokens, depth + 1);
    // a var() with a fallback still has a colour in it
    if (variable[2]) return resolveColor(variable[2].trim(), tokens, depth + 1);
    return null;
  }

  // gradients and images have no single colour to edit
  if (/gradient\(|^url\(/.test(raw)) return null;

  // everything else — rgb(), hsl(), `rebeccapurple` — is resolved by the
  // browser, which is the only thing that knows the whole colour syntax
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = raw;
  if (!probe.style.color) return null;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = computed.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return rgbToHex(Number(parts[0]), Number(parts[1]), Number(parts[2]));
}

export interface GradientStop {
  /** the colour exactly as written, so a `var()` stop survives editing */
  raw: string;
  /** where it sits in the original string, so a rewrite touches nothing else */
  start: number;
  end: number;
}

/**
 * The colour stops inside a gradient, in source order.
 *
 * The picker edits one stop at a time. Without this it replaced the entire
 * `linear-gradient(...)` with whatever hex the spectrum produced, so a single
 * drag destroyed the gradient.
 */
export function gradientStops(value: string): GradientStop[] {
  const open = value.indexOf('(');
  if (open < 0) return [];
  const body = value.slice(open + 1, value.lastIndexOf(')'));
  const pattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(\s*--[\w-]+\s*(?:,[^)]*)?\)/g;

  const stops: GradientStop[] = [];
  for (const match of body.matchAll(pattern)) {
    stops.push({
      raw: match[0],
      start: open + 1 + match.index,
      end: open + 1 + match.index + match[0].length,
    });
  }
  return stops;
}

/** Rewrites one stop, leaving angles, positions and the rest of the string alone. */
export function replaceGradientStop(value: string, index: number, next: string): string {
  const stops = gradientStops(value);
  const stop = stops[index];
  if (!stop) return value;
  return value.slice(0, stop.start) + next + value.slice(stop.end);
}

// ── Gradients and patterns ───────────────────────────────────────────────

export type GradientKind = 'linear' | 'radial' | 'conic';

export interface Gradient {
  kind: GradientKind;
  /** degrees; ignored by radial, which has no direction to speak of */
  angle: number;
  stops: { color: string; at: number }[];
}

/** Splits on commas that are not inside brackets — `rgb(1, 2, 3)` is one item. */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * Reads a gradient into something the picker can edit stop by stop.
 *
 * `gradientStops` above finds colours in place, which is what a single-stop
 * rewrite needs; this is the other half — adding, removing and moving stops
 * means holding the whole thing as data and re-emitting it.
 */
export function parseGradient(value: string): Gradient | null {
  const head = /^(linear|radial|conic)-gradient\(/.exec(value.trim());
  if (!head) return null;
  const body = value.trim().slice(head[0].length, value.trim().lastIndexOf(')'));
  const parts = topLevelParts(body);
  if (!parts.length) return null;

  const kind = head[1] as GradientKind;
  // the first part is a direction only when it carries no colour
  const direction = /deg|to\s|circle|ellipse|at\s/.test(parts[0]) && !/#|rgb|hsl|var\(/.test(parts[0])
    ? parts.shift()!
    : '';
  const angleMatch = /(-?[\d.]+)deg/.exec(direction);
  const angle = angleMatch ? Number(angleMatch[1]) : kind === 'linear' ? 180 : 0;

  const stops = parts.map((part, index) => {
    const at = /(-?[\d.]+)%/.exec(part);
    return {
      color: part.replace(/\s+-?[\d.]+%.*$/, '').trim(),
      at: at ? Number(at[1]) : (index / Math.max(1, parts.length - 1)) * 100,
    };
  });
  if (stops.length < 2) return null;

  return { kind, angle, stops };
}

export function formatGradient({ kind, angle, stops }: Gradient): string {
  const list = stops
    .map((stop) => `${stop.color} ${Math.round(stop.at)}%`)
    .join(', ');
  if (kind === 'radial') return `radial-gradient(circle at 50% 50%, ${list})`;
  if (kind === 'conic') return `conic-gradient(from ${Math.round(angle)}deg, ${list})`;
  return `linear-gradient(${Math.round(angle)}deg, ${list})`;
}

export interface PatternSpec {
  a: string;
  b: string;
  angle: number;
  /** stripe width in px */
  size: number;
}

const PATTERN = /^repeating-linear-gradient\(\s*(-?[\d.]+)deg\s*,\s*(.+?)\s+0\s+([\d.]+)px\s*,\s*(.+?)\s+[\d.]+px\s+[\d.]+px\s*\)$/;

/** A pattern is a repeating two-stripe gradient; these are its four knobs. */
export function parsePattern(value: string): PatternSpec | null {
  const match = PATTERN.exec(value.trim());
  if (!match) return null;
  return { angle: Number(match[1]), a: match[2], size: Number(match[3]), b: match[4] };
}

export function formatPattern({ a, b, angle, size }: PatternSpec): string {
  const step = Math.max(1, Math.round(size));
  return `repeating-linear-gradient(${Math.round(angle)}deg, ${a} 0 ${step}px, ${b} ${step}px ${step * 2}px)`;
}

/** The address inside a `url(...)` paint. */
export function imageSrc(value: string): string {
  return /^url\(\s*['"]?(.*?)['"]?\s*\)$/.exec(value.trim())?.[1] ?? '';
}

// ── Contrast ─────────────────────────────────────────────────────────────

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The WCAG contrast ratio between two colours, 1–21.
 *
 * This is what Figma's "Check color contrast" button reports: whether the paint
 * you are choosing is legible against what sits behind it.
 */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [light, dark] = x > y ? [x, y] : [y, x];
  return (light + 0.05) / (dark + 0.05);
}

/** Which WCAG thresholds a ratio clears, for normal and for large text. */
export function contrastGrades(ratio: number): { label: string; passes: boolean }[] {
  return [
    { label: 'AA', passes: ratio >= 4.5 },
    { label: 'AAA', passes: ratio >= 7 },
    { label: 'AA Large', passes: ratio >= 3 },
    { label: 'AAA Large', passes: ratio >= 4.5 },
  ];
}

/**
 * What a paint field says it is.
 *
 * Figma *names* a paint rather than printing it: a solid shows its hex, a
 * gradient shows Linear / Radial / Angular, an image shows Image, and a paint
 * bound to a variable shows the variable's name. This field printed the CSS
 * instead, so a gradient fill reported itself as
 * `radial-gradient(circle at 50% 50%, #DDDDDD 0%, …` — a string that overflows
 * the box, cannot be read at a glance, and is not something you could edit
 * there anyway.
 */
export function paintLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';

  const reference = /^var\(\s*--([a-zA-Z0-9_-]+)/.exec(raw);
  if (reference) return reference[1];

  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(raw);
  if (hex) {
    const digits = hex[1];
    const six =
      digits.length === 3 || digits.length === 4
        ? digits.slice(0, 3).split('').map((c) => c + c).join('')
        : digits.slice(0, 6);
    return six.toUpperCase();
  }

  const channels = /^rgba?\(([^)]*)\)$/i.exec(raw);
  if (channels) {
    const parts = channels[1].match(/-?\d*\.?\d+/g);
    if (parts && parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map((part) => Math.round(Number(part)));
      return rgbToHex(r, g, b).slice(1).toUpperCase();
    }
  }

  if (/^repeating-(linear|radial|conic)-gradient\(/i.test(raw)) return 'Pattern';
  if (/^linear-gradient\(/i.test(raw)) return 'Linear';
  if (/^radial-gradient\(/i.test(raw)) return 'Radial';
  if (/^conic-gradient\(/i.test(raw)) return 'Angular';
  if (/^url\(/i.test(raw)) return 'Image';
  return raw;
}

/**
 * Whether the paint field can be typed into.
 *
 * A hex is editable in place; a gradient or an image is not — its label is a
 * name, and `normalizeColor` would read "Radial" as a CSS colour keyword and
 * flatten the gradient the moment the field lost focus.
 */
export function paintIsTypable(value: string | null | undefined): boolean {
  const raw = (value ?? '').trim();
  return !!raw && !/gradient\(/i.test(raw) && !/^url\(/i.test(raw);
}
