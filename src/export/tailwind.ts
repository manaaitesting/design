import { toReact } from './toCode';
import type { Doc, Token } from '../document/types';
import { DEFAULT_COLLECTION, type Collection } from '../document/variables';
import type { CustomFont } from '../lib/fonts';

/**
 * The design as Tailwind.
 *
 * This is a rewriting of the React export rather than a fourth walk of the
 * document, and that is deliberate: `toReact` already emits one rule per layer
 * from `nodeStyle()`, so the CSS it produces *is* the design. Re-walking the
 * tree here would mean a second opinion about what a layer looks like, and two
 * opinions is how an exporter drifts. Instead each generated rule is turned
 * into a class list and spliced back into the same markup.
 *
 * The mapping is total. Properties with an idiomatic utility get one — `flex`,
 * `flex-col`, `gap-3`, `p-5`, `rounded-xl`, `bg-[#101828]` — and everything
 * else becomes an arbitrary property, `[mask-image:url(#a)]`, which Tailwind
 * supports natively. Nothing is dropped, which is the property that matters:
 * an export that silently loses a declaration is worse than one that emits an
 * ugly class.
 */

/** Tailwind's spacing scale: 4px to a unit, with the half steps it ships. */
const SPACING: Record<number, string> = {
  0: '0',
  1: 'px',
  2: '0.5',
  4: '1',
  6: '1.5',
  8: '2',
  10: '2.5',
  12: '3',
  14: '3.5',
  16: '4',
  20: '5',
  24: '6',
  28: '7',
  32: '8',
  36: '9',
  40: '10',
  44: '11',
  48: '12',
  56: '14',
  64: '16',
  80: '20',
  96: '24',
  112: '28',
  128: '32',
};

const RADIUS: Record<number, string> = {
  0: 'rounded-none',
  2: 'rounded-sm',
  4: 'rounded',
  6: 'rounded-md',
  8: 'rounded-lg',
  12: 'rounded-xl',
  16: 'rounded-2xl',
  24: 'rounded-3xl',
  9999: 'rounded-full',
};

/**
 * Tailwind's type scale, which is *not* the spacing scale.
 *
 * `text-6` does not exist; 24px is `text-2xl`. Running font-size through the
 * spacing table would emit a class that silently does nothing.
 */
const FONT_SIZE: Record<number, string> = {
  12: 'text-xs',
  14: 'text-sm',
  16: 'text-base',
  18: 'text-lg',
  20: 'text-xl',
  24: 'text-2xl',
  30: 'text-3xl',
  36: 'text-4xl',
  48: 'text-5xl',
  60: 'text-6xl',
  72: 'text-7xl',
  96: 'text-8xl',
  128: 'text-9xl',
};

/** Border widths have their own short scale, likewise. */
const BORDER_WIDTH: Record<number, string> = {
  0: 'border-0',
  1: 'border',
  2: 'border-2',
  4: 'border-4',
  8: 'border-8',
};

const FONT_WEIGHT: Record<string, string> = {
  '100': 'font-thin',
  '200': 'font-extralight',
  '300': 'font-light',
  '400': 'font-normal',
  '500': 'font-medium',
  '600': 'font-semibold',
  '700': 'font-bold',
  '800': 'font-extrabold',
  '900': 'font-black',
};

const KEYWORD: Record<string, Record<string, string>> = {
  display: {
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    block: 'block',
    'inline-block': 'inline-block',
    inline: 'inline',
    none: 'hidden',
    contents: 'contents',
  },
  position: {
    absolute: 'absolute',
    relative: 'relative',
    fixed: 'fixed',
    sticky: 'sticky',
    static: 'static',
  },
  'flex-direction': {
    row: 'flex-row',
    'row-reverse': 'flex-row-reverse',
    column: 'flex-col',
    'column-reverse': 'flex-col-reverse',
  },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'align-items': {
    'flex-start': 'items-start',
    start: 'items-start',
    center: 'items-center',
    'flex-end': 'items-end',
    end: 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline',
  },
  'align-self': {
    auto: 'self-auto',
    'flex-start': 'self-start',
    center: 'self-center',
    'flex-end': 'self-end',
    stretch: 'self-stretch',
  },
  'align-content': {
    'flex-start': 'content-start',
    center: 'content-center',
    'flex-end': 'content-end',
    'space-between': 'content-between',
    stretch: 'content-stretch',
  },
  'justify-content': {
    'flex-start': 'justify-start',
    start: 'justify-start',
    center: 'justify-center',
    'flex-end': 'justify-end',
    end: 'justify-end',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
  },
  'text-align': {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
  },
  overflow: { hidden: 'overflow-hidden', visible: 'overflow-visible', auto: 'overflow-auto', clip: 'overflow-clip', scroll: 'overflow-scroll' },
  'overflow-x': { hidden: 'overflow-x-hidden', auto: 'overflow-x-auto', scroll: 'overflow-x-scroll', visible: 'overflow-x-visible' },
  'overflow-y': { hidden: 'overflow-y-hidden', auto: 'overflow-y-auto', scroll: 'overflow-y-scroll', visible: 'overflow-y-visible' },
  'font-style': { italic: 'italic', normal: 'not-italic' },
  'text-decoration-line': { underline: 'underline', 'line-through': 'line-through', none: 'no-underline' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'white-space': { nowrap: 'whitespace-nowrap', pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap', normal: 'whitespace-normal' },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
  'mix-blend-mode': {
    normal: 'mix-blend-normal',
    multiply: 'mix-blend-multiply',
    screen: 'mix-blend-screen',
    overlay: 'mix-blend-overlay',
    darken: 'mix-blend-darken',
    lighten: 'mix-blend-lighten',
    'color-dodge': 'mix-blend-color-dodge',
    'color-burn': 'mix-blend-color-burn',
    'hard-light': 'mix-blend-hard-light',
    'soft-light': 'mix-blend-soft-light',
    difference: 'mix-blend-difference',
    exclusion: 'mix-blend-exclusion',
  },
};

/** Properties whose value is a length that Tailwind spells with a prefix. */
const LENGTH: Record<string, string> = {
  width: 'w',
  height: 'h',
  'min-width': 'min-w',
  'min-height': 'min-h',
  'max-width': 'max-w',
  'max-height': 'max-h',
  gap: 'gap',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  padding: 'p',
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

/** The four sides of a `padding`/`margin` shorthand, in CSS order. */
const SIDES = ['t', 'r', 'b', 'l'] as const;

/** Properties whose value is a colour. */
const COLOUR: Record<string, string> = {
  color: 'text',
  'background-color': 'bg',
  'border-color': 'border',
  'outline-color': 'outline',
};

/** A length in px, or null when the value is anything else. */
function px(value: string): number | null {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) : null;
}

/** Tailwind rejects spaces inside an arbitrary value; underscores stand in. */
function arbitrary(value: string): string {
  return value.trim().replace(/\s+/g, '_');
}

/** The scale step for a length, or an arbitrary value when it is off-scale. */
function spacing(prefix: string, value: string): string {
  const n = px(value);
  if (n === null) return `${prefix}-[${arbitrary(value)}]`;
  const negative = n < 0;
  const step = SPACING[Math.abs(n)];
  if (step === undefined) return `${negative ? '-' : ''}${prefix}-[${Math.abs(n)}px]`;
  return `${negative ? '-' : ''}${prefix}-${step}`;
}

/**
 * One declaration as one or more utilities.
 *
 * Returning `[prop:value]` rather than nothing for the unrecognised case is
 * what makes this safe to run over the whole stylesheet: a property this table
 * has never heard of still lands in the class list and still renders.
 */
export function toUtilities(property: string, value: string): string[] {
  const raw = value.trim();
  if (!raw) return [];

  const keyword = KEYWORD[property]?.[raw];
  if (keyword) return [keyword];

  switch (property) {
    case 'flex':
      if (raw === '1 1 0' || raw === '1 1 0%' || raw === '1') return ['flex-1'];
      if (raw === 'none') return ['flex-none'];
      return [`flex-[${arbitrary(raw)}]`];
    case 'flex-grow':
      return raw === '0' ? ['grow-0'] : ['grow'];
    case 'flex-shrink':
      return raw === '0' ? ['shrink-0'] : ['shrink'];
    case 'font-weight':
      return [FONT_WEIGHT[raw] ?? `font-[${raw}]`];
    case 'font-family':
      return [`font-[${arbitrary(raw.replace(/"/g, "'"))}]`];
    case 'line-height': {
      const n = px(raw);
      if (n !== null) return [`leading-[${n}px]`];
      return [`leading-[${arbitrary(raw)}]`];
    }
    case 'border-radius': {
      const n = px(raw);
      if (n !== null && RADIUS[n]) return [RADIUS[n]];
      return [`rounded-[${arbitrary(raw)}]`];
    }
    case 'opacity': {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n) && Number.isInteger(n * 100)) return [`opacity-${Math.round(n * 100)}`];
      return [`opacity-[${arbitrary(raw)}]`];
    }
    case 'z-index':
      return [`z-[${arbitrary(raw)}]`];
    case 'font-size': {
      const n = px(raw);
      if (n !== null && FONT_SIZE[n]) return [FONT_SIZE[n]];
      return [`text-[${arbitrary(raw)}]`];
    }
    case 'letter-spacing':
      return raw === '0' || raw === '0em' || raw === 'normal'
        ? ['tracking-normal']
        : [`tracking-[${arbitrary(raw)}]`];
    case 'border-width': {
      const n = px(raw);
      if (n !== null && BORDER_WIDTH[n]) return [BORDER_WIDTH[n]];
      return [`border-[${arbitrary(raw)}]`];
    }
    // `padding: 20px 20px 20px 20px` is one declaration and up to four
    // utilities. Left whole it would become `p-[20px_20px_20px_20px]`, which
    // Tailwind does not accept.
    case 'padding':
    case 'margin': {
      const prefix = property === 'padding' ? 'p' : 'm';
      const parts = raw.split(/\s+/);
      if (parts.length === 1) return [spacing(prefix, parts[0])];
      const [top, right, bottom = top, left = right] = parts;
      if (top === bottom && right === left) {
        const both = [spacing(`${prefix}y`, top), spacing(`${prefix}x`, right)];
        return top === right ? [spacing(prefix, top)] : both;
      }
      return [top, right, bottom, left].map((value, index) =>
        spacing(`${prefix}${SIDES[index]}`, value),
      );
    }
    case 'border-style':
      return [`border-${raw}`];
    case 'background':
    case 'background-image':
      // a gradient or an image paint; Tailwind has no shorthand for either
      return [`bg-[${arbitrary(raw)}]`];
    case 'box-shadow':
      return raw === 'none' ? ['shadow-none'] : [`shadow-[${arbitrary(raw)}]`];
    case 'transform':
      return [`[transform:${arbitrary(raw)}]`];
    case 'filter':
      return [`[filter:${arbitrary(raw)}]`];
    default:
      break;
  }

  const colour = COLOUR[property];
  if (colour) return [`${colour}-[${arbitrary(raw)}]`];

  const length = LENGTH[property];
  if (length) {
    // width and height take Tailwind's keywords before its scale
    if ((property === 'width' || property === 'height') && raw === '100%') {
      return [property === 'width' ? 'w-full' : 'h-full'];
    }
    if (raw === 'fit-content') return [`${length}-fit`];
    if (raw === 'auto') return [`${length}-auto`];
    return [spacing(length, raw)];
  }

  // Anything with no utility at all is still expressible: Tailwind takes a
  // bare property in brackets, so the declaration survives verbatim.
  return [`[${property}:${arbitrary(raw)}]`];
}

/** `.name {\n  prop: value;\n}` — the shape `styleToCss` writes. */
const RULE = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;

/** Splits a declaration block, keeping `;` inside `url(…)` and `rgba(…)`. */
function declarationsOf(block: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of block.split('\n')) {
    const text = line.trim().replace(/;$/, '');
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    out.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()]);
  }
  return out;
}

export interface Tailwind {
  markup: string;
  /** Rules that could not become classes — at-rules, fonts, `:root` variables. */
  css: string;
}

/**
 * The subtree as JSX with Tailwind classes.
 *
 * Font `@import`s and the `:root` block of variables stay as CSS, because they
 * are not properties on an element and have nowhere to go in a class list. The
 * variables still work: `bg-[var(--brand)]` resolves against them.
 */
export function toTailwind(
  rootId: string,
  doc: Doc,
  tokens: Token[] = [],
  collections: Collection[] = [DEFAULT_COLLECTION],
  customFonts: CustomFont[] = [],
): Tailwind {
  const { markup, css: sheet } = toReact(rootId, doc, tokens, collections, customFonts);
  // The border-box reset is a rule over `.root, .root *` — a selector rather
  // than a layer, so it has no class list to join, and Tailwind's preflight
  // already does it. Dropped before the scan rather than after, because its
  // two-selector head is exactly what the single-class pattern cannot see.
  const css = sheet.replace(
    /\.[A-Za-z0-9_-]+,\s*\n\.[A-Za-z0-9_-]+ \*\s*\{[^}]*\}\n*/g,
    '',
  );

  const classes = new Map<string, string>();
  const leftover: string[] = [];

  // Everything that is not a single-class rule: `@import` lines for the web
  // faces the design uses, and the `:root` block of variables. Neither is a
  // property on an element, so neither has a class list to live in.
  let cursor = 0;
  RULE.lastIndex = 0;
  for (let match = RULE.exec(css); match; match = RULE.exec(css)) {
    const before = css.slice(cursor, match.index).trim();
    if (before) leftover.push(before);
    cursor = match.index + match[0].length;

    const [, name, block] = match;
    // the border-box reset is a rule over `.root *`, which is a selector rather
    // than a layer, and Tailwind's preflight already does it
    const utilities = declarationsOf(block).flatMap(([property, value]) =>
      toUtilities(property, value),
    );
    // one layer can be matched by several rules; later ones win, as in CSS
    classes.set(name, [classes.get(name), ...utilities].filter(Boolean).join(' '));
  }
  const tail = css.slice(cursor).trim();
  if (tail) leftover.push(tail);

  const swapped = markup
    // the stylesheet import has nothing to import any more
    .replace(/^import '\.\/[^']+\.css';\n/, '')
    .replace(/className="([A-Za-z0-9_-]+)"/g, (whole, name: string) => {
      const utilities = classes.get(name);
      return utilities ? `className="${utilities}"` : whole;
    });

  return { markup: swapped.trimStart(), css: leftover.join('\n\n') };
}
