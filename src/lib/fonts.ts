/**
 * Fonts.
 *
 * A design tool with three hard-coded families is a design tool you cannot use
 * for real work, so the list below is real — the system stacks plus the web
 * faces most interfaces are actually set in. Each one knows the weights it
 * ships, because offering Bold on a family that has no bold is how a design
 * ends up looking different everywhere it is opened.
 *
 * Web faces load from Google Fonts through an ordinary stylesheet link, added
 * once per family and never removed: a face that has been used somewhere in the
 * document has to keep rendering, and a link element is a few hundred bytes.
 */

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
      if (!existing.weights.includes(font.weight)) existing.weights.push(font.weight);
      continue;
    }
    byName.set(font.name, {
      name: font.name,
      stack: `"${font.name}", system-ui, sans-serif`,
      weights: [font.weight],
      google: null,
    });
  }
  return [...byName.values()].map((font) => ({ ...font, weights: [...font.weights].sort((a, b) => a - b) }));
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

export interface FontFace {
  /** what the menu shows */
  name: string;
  /** the CSS `font-family` value, fallbacks included */
  stack: string;
  weights: number[];
  /** null for the system stacks — nothing to fetch */
  google: string | null;
}

export const FONTS: FontFace[] = [
  {
    name: 'Inter',
    stack: 'Inter, system-ui, sans-serif',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    google: 'Inter',
  },
  {
    name: 'System UI',
    stack: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [300, 400, 500, 600, 700],
    google: null,
  },
  {
    name: 'Georgia',
    stack: 'ui-serif, Georgia, serif',
    weights: [400, 700],
    google: null,
  },
  {
    name: 'SF Mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    weights: [400, 500, 600, 700],
    google: null,
  },
  {
    name: 'Roboto',
    stack: 'Roboto, system-ui, sans-serif',
    weights: [100, 300, 400, 500, 700, 900],
    google: 'Roboto',
  },
  {
    name: 'Roboto Mono',
    stack: '"Roboto Mono", ui-monospace, monospace',
    weights: [100, 200, 300, 400, 500, 600, 700],
    google: 'Roboto Mono',
  },
  {
    name: 'Source Serif 4',
    stack: '"Source Serif 4", ui-serif, Georgia, serif',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    google: 'Source Serif 4',
  },
  {
    name: 'Playfair Display',
    stack: '"Playfair Display", ui-serif, Georgia, serif',
    weights: [400, 500, 600, 700, 800, 900],
    google: 'Playfair Display',
  },
  {
    name: 'Space Grotesk',
    stack: '"Space Grotesk", system-ui, sans-serif',
    weights: [300, 400, 500, 600, 700],
    google: 'Space Grotesk',
  },
  {
    name: 'IBM Plex Sans',
    stack: '"IBM Plex Sans", system-ui, sans-serif',
    weights: [100, 200, 300, 400, 500, 600, 700],
    google: 'IBM Plex Sans',
  },
  {
    name: 'DM Sans',
    stack: '"DM Sans", system-ui, sans-serif',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    google: 'DM Sans',
  },
  {
    name: 'Lora',
    stack: 'Lora, ui-serif, Georgia, serif',
    weights: [400, 500, 600, 700],
    google: 'Lora',
  },
  {
    name: 'Fira Code',
    stack: '"Fira Code", ui-monospace, monospace',
    weights: [300, 400, 500, 600, 700],
    google: 'Fira Code',
  },
];

const BY_STACK = new Map(FONTS.map((font) => [font.stack, font]));

export function fontFor(stack: string | undefined): FontFace | undefined {
  if (!stack) return undefined;
  return BY_STACK.get(stack) ?? FONTS.find((font) => stack.startsWith(font.name));
}

/** The weights a family actually ships, for the weight menu. */
export function weightsFor(stack: string | undefined): number[] {
  return fontFor(stack)?.weights ?? [400, 700];
}

/** The nearest weight a family has to the one asked for. */
export function nearestWeight(stack: string | undefined, weight: number): number {
  const weights = weightsFor(stack);
  return weights.reduce((best, entry) =>
    Math.abs(entry - weight) < Math.abs(best - weight) ? entry : best,
  );
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
};

/** The stylesheet URL for a family, with every weight it ships. */
export function googleHref(font: FontFace): string | null {
  if (!font.google) return null;
  const family = font.google.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${font.weights.join(';')}&display=swap`;
}

const loaded = new Set<string>();

/**
 * Makes sure a family is available to the canvas.
 *
 * Idempotent and safe to call on every render: the set guards the DOM write,
 * and a stack with nothing to fetch returns immediately.
 */
export function ensureFont(stack: string | undefined): void {
  if (typeof document === 'undefined') return;
  const font = fontFor(stack);
  if (!font?.google || loaded.has(font.stack)) return;
  loaded.add(font.stack);
  const href = googleHref(font);
  if (!href) return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.paperlikeFont = font.name;
  document.head.appendChild(link);
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
