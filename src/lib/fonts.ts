/**
 * Fonts.
 *
 * A design tool with thirteen hard-coded families is a design tool you cannot
 * use for real work, so the list below is the real one: the system stacks, plus
 * every family in the Google Fonts directory, read from the generated catalogue
 * beside this file. Each one knows the weights and italics it actually ships
 * and the variable axes it exposes, because offering Bold on a family that has
 * no bold is how a design ends up looking different everywhere it is opened.
 *
 * Web faces load from Google Fonts through an ordinary stylesheet link, added
 * once per family and never removed: a face that has been used somewhere in the
 * document has to keep rendering, and a link element is a few hundred bytes.
 */

import { AXIS_NAMES, GOOGLE_FONT_DATA } from './google-fonts';

export { AXIS_NAMES };

/**
 * A face someone uploaded into the document.
 *
 * It is stored as a data URL in the CRDT, so it syncs with everything else and
 * a collaborator who does not have the font installed still sees the design as
 * designed. `weight` is which weight the file *is* — a family uploaded twice at
 * two weights is two entries under one name.
 */
export interface CustomFont {
  id: string;
  name: string;
  /** the font file, as a data URL */
  src: string;
  weight: number;
  italic?: boolean;
}

/** The stylesheet text that makes uploaded faces available to the page. */
export function fontFaceCss(fonts: CustomFont[]): string {
  return fonts
    .map(
      (font) =>
        `@font-face { font-family: "${font.name}"; src: url(${font.src}); ` +
        `font-weight: ${font.weight}; font-style: ${font.italic ? 'italic' : 'normal'}; font-display: swap; }`,
    )
    .join('\n');
}

/** Uploaded faces, presented the way the built-in list is. */
export function customFamilies(fonts: CustomFont[]): FontFace[] {
  const byName = new Map<string, FontFace>();
  for (const font of fonts) {
    const existing = byName.get(font.name);
    if (existing) {
      const bucket = font.italic ? existing.italics : existing.weights;
      if (!bucket.includes(font.weight)) bucket.push(font.weight);
      continue;
    }
    byName.set(font.name, {
      name: font.name,
      stack: `"${font.name}", system-ui, sans-serif`,
      weights: font.italic ? [] : [font.weight],
      italics: font.italic ? [font.weight] : [],
      google: null,
      category: 'sans',
      axes: [],
      source: 'custom',
      rank: -1,
    });
  }
  return [...byName.values()].map((font) => ({
    ...font,
    // a family uploaded only in italic still has to offer a roman entry to pick
    weights: (font.weights.length ? [...font.weights] : [...font.italics]).sort((a, b) => a - b),
    italics: [...font.italics].sort((a, b) => a - b),
  }));
}

export const MAX_FONT_BYTES = 2_000_000;

/** Reads a font file into a data URL, with the same ceiling images have. */
export async function readFontFile(file: File): Promise<{ name: string; src: string }> {
  if (!/\.(woff2?|otf|ttf)$/i.test(file.name)) {
    throw new Error('That is not a font file — use .woff2, .woff, .otf or .ttf.');
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error(
      `${file.name} is ${(file.size / 1_000_000).toFixed(1)}MB — over the ${(MAX_FONT_BYTES / 1_000_000).toFixed(1)}MB limit.`,
    );
  }
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  return { name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), src };
}

/** One axis of a variable font, as the Variable tab's sliders need it. */
export interface FontAxis {
  tag: string;
  min: number;
  max: number;
  def: number;
}

export type FontCategory = 'sans' | 'serif' | 'display' | 'hand' | 'mono';

export interface FontFace {
  /** what the menu shows */
  name: string;
  /** the CSS `font-family` value, fallbacks included */
  stack: string;
  /** the roman weights the family ships */
  weights: number[];
  /** the weights it also ships as italic — empty for a family with no italic */
  italics: number[];
  /** null for the system stacks — nothing to fetch */
  google: string | null;
  category: FontCategory;
  /** the variable axes, `wght` included; empty for a static family */
  axes: FontAxis[];
  source: 'system' | 'google' | 'custom';
  /** position in Google's popularity order; -1 for anything not from there */
  rank: number;
}

/** The fallbacks a family of each kind falls back through. */
const FALLBACK: Record<FontCategory, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  display: 'system-ui, sans-serif',
  hand: 'cursive',
  mono: 'ui-monospace, monospace',
};

const CATEGORY_OF: Record<string, FontCategory> = {
  s: 'sans',
  f: 'serif',
  d: 'display',
  h: 'hand',
  m: 'mono',
};

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  sans: 'Sans serif',
  serif: 'Serif',
  display: 'Display',
  hand: 'Handwriting',
  mono: 'Monospace',
};

/** The families the browser already has, which need no stylesheet. */
export const SYSTEM_FONTS: FontFace[] = [
  {
    name: 'System UI',
    stack: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    italics: [400, 700],
    google: null,
    category: 'sans',
    axes: [],
    source: 'system',
    rank: -1,
  },
  {
    name: 'Georgia',
    stack: 'ui-serif, Georgia, serif',
    weights: [400, 700],
    italics: [400, 700],
    google: null,
    category: 'serif',
    axes: [],
    source: 'system',
    rank: -1,
  },
  {
    name: 'Helvetica',
    stack: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
    weights: [300, 400, 500, 700, 900],
    italics: [400, 700],
    google: null,
    category: 'sans',
    axes: [],
    source: 'system',
    rank: -1,
  },
  {
    name: 'Times',
    stack: '"Times New Roman", Times, serif',
    weights: [400, 700],
    italics: [400, 700],
    google: null,
    category: 'serif',
    axes: [],
    source: 'system',
    rank: -1,
  },
  {
    name: 'SF Mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    weights: [400, 500, 600, 700],
    italics: [400, 700],
    google: null,
    category: 'mono',
    axes: [],
    source: 'system',
    rank: -1,
  },
];

/** `4` is 400, and Recursive's `a` is 1000. */
function weightsFromDigits(digits: string): number[] {
  return [...digits].map((digit) => (digit === 'a' ? 1000 : Number(digit) * 100));
}

function parseGoogle(): FontFace[] {
  return GOOGLE_FONT_DATA.split('\n')
    .filter(Boolean)
    .map((line, rank) => {
      const [name, category, roman, italic, axes] = line.split('|');
      const kind = CATEGORY_OF[category] ?? 'sans';
      return {
        name,
        stack: `"${name}", ${FALLBACK[kind]}`,
        weights: weightsFromDigits(roman),
        italics: weightsFromDigits(italic ?? ''),
        google: name,
        category: kind,
        axes: (axes ?? '')
          .split(';')
          .filter(Boolean)
          .map((axis) => {
            const [tag, min, max, def] = axis.split(' ');
            return { tag, min: Number(min), max: Number(max), def: Number(def) };
          }),
        source: 'google' as const,
        rank,
      };
    });
}

export const GOOGLE_FONTS: FontFace[] = parseGoogle();

/**
 * Everything built in, system faces first.
 *
 * The order is the one the picker shows under "All fonts": the handful of
 * families that need no download, then Google's directory by popularity.
 */
export const FONTS: FontFace[] = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

const BY_STACK = new Map(FONTS.map((font) => [font.stack, font]));
const BY_NAME = new Map(FONTS.map((font) => [font.name.toLowerCase(), font]));

/** The first family named by a CSS font stack, unquoted. */
export function familyName(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^["']|["']$/g, '');
}

/**
 * The face a stack refers to.
 *
 * Documents written before this catalogue existed carry stacks of their own
 * making — `Inter, system-ui, sans-serif` rather than `"Inter", system-ui,
 * sans-serif` — so an exact miss falls back to the family the stack names,
 * which is the part that decides what renders.
 */
export function fontFor(stack: string | undefined, extra: FontFace[] = []): FontFace | undefined {
  if (!stack) return undefined;
  for (const font of extra) if (font.stack === stack) return font;
  const exact = BY_STACK.get(stack);
  if (exact) return exact;
  const name = familyName(stack).toLowerCase();
  for (const font of extra) if (font.name.toLowerCase() === name) return font;
  return BY_NAME.get(name);
}

/** The weights a family actually ships, for the weight menu. */
export function weightsFor(stack: string | undefined, extra: FontFace[] = []): number[] {
  return fontFor(stack, extra)?.weights ?? [400, 700];
}

/** The nearest weight a family has to the one asked for. */
export function nearestWeight(stack: string | undefined, weight: number, extra: FontFace[] = []): number {
  const weights = weightsFor(stack, extra);
  if (!weights.length) return weight;
  return weights.reduce((best, entry) =>
    Math.abs(entry - weight) < Math.abs(best - weight) ? entry : best,
  );
}

/**
 * The nearest style a family has to the one asked for.
 *
 * Switching from Playfair Bold Italic to a family with no italic has to land
 * somewhere real, and that somewhere is the roman of the same weight rather
 * than a synthesised slant.
 */
export function nearestStyle(
  stack: string | undefined,
  weight: number,
  italic: boolean,
  extra: FontFace[] = [],
): { weight: number; italic: boolean } {
  const font = fontFor(stack, extra);
  if (!font) return { weight, italic };
  const list = italic && font.italics.length ? font.italics : font.weights;
  if (!list.length) return { weight, italic: false };
  const nearest = list.reduce((best, entry) =>
    Math.abs(entry - weight) < Math.abs(best - weight) ? entry : best,
  );
  return { weight: nearest, italic: italic && font.italics.length > 0 };
}

export const WEIGHT_LABEL: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
  1000: 'Extra Black',
};

/** "Bold Italic" — what the style menu's trigger reads. */
export function styleLabel(weight: number, italic?: boolean): string {
  const roman = WEIGHT_LABEL[weight] ?? String(weight);
  return italic ? `${roman} Italic` : roman;
}

/** Every roman then italic style a family ships, in the menu's order. */
export function stylesOf(font: FontFace | undefined): { weight: number; italic: boolean }[] {
  if (!font) return [400, 700].map((weight) => ({ weight, italic: false }));
  return [
    ...font.weights.map((weight) => ({ weight, italic: false })),
    ...font.italics.map((weight) => ({ weight, italic: true })),
  ];
}

/** Figma's size menu. */
export const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 32, 36, 40, 48, 64, 96, 128];

/** The line-height, letter-spacing and paragraph-spacing units Figma offers. */
export const AXIS_LABEL = (tag: string) => AXIS_NAMES[tag] ?? tag;

/** The stylesheet URL for a family, with every style it ships. */
export function googleHref(font: FontFace): string | null {
  if (!font.google) return null;
  const family = font.google.replace(/ /g, '+');
  const variable = font.axes.find((axis) => axis.tag === 'wght');
  const hasItalic = font.italics.length > 0;

  // A variable family is one file across its whole range, so ask for the range
  // rather than naming nine weights that would each be a separate download.
  if (variable) {
    const range = variable.min === variable.max ? `${variable.min}` : `${variable.min}..${variable.max}`;
    const spec = hasItalic ? `ital,wght@0,${range};1,${range}` : `wght@${range}`;
    return `https://fonts.googleapis.com/css2?family=${family}:${spec}&display=swap`;
  }

  if (!font.weights.length && !hasItalic) {
    return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  }

  // css2 wants the tuples in ascending order, roman before italic
  const tuples = hasItalic
    ? [
        ...font.weights.map((weight) => `0,${weight}`),
        ...font.italics.map((weight) => `1,${weight}`),
      ]
    : font.weights.map(String);
  const axis = hasItalic ? 'ital,wght' : 'wght';
  return `https://fonts.googleapis.com/css2?family=${family}:${axis}@${tuples.join(';')}&display=swap`;
}

const loaded = new Set<string>();

function addLink(href: string, name: string): void {
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.paperlikeFont = name;
  document.head.appendChild(link);
}

/**
 * Makes sure a family is available to the canvas.
 *
 * Idempotent and safe to call on every render: the set guards the DOM write,
 * and a stack with nothing to fetch returns immediately.
 */
export function ensureFont(stack: string | undefined, extra: FontFace[] = []): void {
  if (typeof document === 'undefined') return;
  const font = fontFor(stack, extra);
  if (!font?.google || loaded.has(font.stack)) return;
  loaded.add(font.stack);
  const href = googleHref(font);
  if (href) addLink(href, font.name);
}

/**
 * Loads a batch of families at one weight, for the picker's previews.
 *
 * The picker shows every name set in its own face, and a screenful is twenty
 * families — twenty stylesheet links would be twenty round trips, so they go in
 * one request. Only the regular is asked for: the list is a specimen, not the
 * design, and the full family arrives when the font is actually chosen.
 */
export function ensurePreviewFonts(fonts: FontFace[]): void {
  if (typeof document === 'undefined') return;
  const wanted = fonts.filter((font) => font.google && !previewed.has(font.name));
  if (!wanted.length) return;
  for (const font of wanted) previewed.add(font.name);
  const families = wanted
    .map((font) => {
      const weight = font.weights.includes(400) ? 400 : (font.weights[0] ?? 400);
      return `family=${font.google!.replace(/ /g, '+')}:wght@${weight}`;
    })
    .join('&');
  addLink(`https://fonts.googleapis.com/css2?${families}&display=swap`, 'preview');
}

const previewed = new Set<string>();

/**
 * The families a search box should show.
 *
 * Matching is on the family name only — Figma's picker does the same, and a
 * substring match anywhere in the name is what makes "mono" find Roboto Mono
 * without having to know it starts with Roboto. Names that *start* with the
 * query come first, though: typing "play" should offer Playfair before it
 * offers the two dozen families with "Display" in their name.
 */
export function searchFonts(fonts: FontFace[], query: string, limit = Infinity): FontFace[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return limit === Infinity ? fonts : fonts.slice(0, limit);
  const starts: FontFace[] = [];
  const contains: FontFace[] = [];
  for (const font of fonts) {
    const name = font.name.toLowerCase();
    if (name.startsWith(needle)) starts.push(font);
    else if (name.includes(needle)) contains.push(font);
  }
  const byName = (a: FontFace, b: FontFace) => a.name.localeCompare(b.name);
  const found = [...starts.sort(byName), ...contains.sort(byName)];
  return limit === Infinity ? found : found.slice(0, limit);
}

/** Every web family used in a document, for the export to carry an @import. */
export function webFontsIn(families: Iterable<string | undefined>): FontFace[] {
  const out = new Map<string, FontFace>();
  for (const stack of families) {
    const font = fontFor(stack);
    if (font?.google) out.set(font.stack, font);
  }
  return [...out.values()];
}
