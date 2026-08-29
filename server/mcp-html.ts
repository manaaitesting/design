import { headless } from './mcp-render';

/**
 * HTML into the canvas — the direction that makes an agent cheap.
 *
 * Every other write tool here is one call per layer, which is fine for an edit
 * and hopeless for a build: a login screen is thirty layers and thirty round
 * trips. But this canvas *is* HTML and CSS — `nodeStyle()` maps a node onto a
 * declaration block and `toHtml` maps a subtree onto a document — so the
 * inverse is not a translation to guess at, it is the same mapping read
 * backwards. An agent already knows how to write a card in HTML. Letting it
 * send that is the difference between eighty tool calls and one.
 *
 * The reading is done by a browser rather than by a parser, and that is the
 * whole trick: laying the markup out in headless Chromium and asking
 * `getComputedStyle` means the cascade, shorthands, inheritance, `em`, `%`,
 * flexbox and the default stylesheet have all already been resolved. There is
 * no CSS engine here to disagree with the one the canvas renders with.
 */

/** What the walk produces: a node, its properties, and what is inside it. */
export interface NodeSpec {
  type: 'frame' | 'text' | 'rect' | 'image';
  props: Record<string, unknown>;
  children: NodeSpec[];
  /** the `data-ref` on the source element, echoed back with the id it became */
  ref?: string;
}

export interface ReadOptions {
  /** Layout width. The web is width-driven; height follows from the content. */
  width?: number;
  /** Extra CSS applied to the document — a stylesheet the markup refers to. */
  css?: string;
}

/**
 * Lays the markup out and reads the result back as a node tree.
 *
 * Runs entirely inside the page: one `evaluate` rather than a call per element,
 * because a per-element round trip over CDP is the same mistake at a smaller
 * scale.
 */
export async function readHtml(html: string, options: ReadOptions = {}): Promise<NodeSpec[]> {
  const width = Math.min(4096, Math.max(1, Math.round(options.width ?? 1440)));
  const page = await (await headless()).newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">
       <!-- The walk below is transpiled before it is serialised into this page,
            and the transpiler rewrites every named function as \`__name(fn,
            "fn")\` so stack traces keep their names. That helper lives at module
            scope in Node, which the page has no sight of, so it is defined here
            as the identity it effectively is. Without it the walk throws
            \`ReferenceError: __name is not defined\` before reading anything. -->
       <script>window.__name = window.__name || function (fn) { return fn; };</script>
       <style>
         *, *::before, *::after { box-sizing: border-box; }
         html, body { margin: 0; padding: 0; }
         /* the root is the frame the markup is measured against, so it must not
            impose a width of its own beyond the one asked for */
         body { width: ${width}px; }
       </style>
       ${options.css ? `<style>${options.css.replace(/<\/style/gi, '<\\/style')}</style>` : ''}
       </head><body>${html}</body></html>`,
      { waitUntil: 'domcontentloaded' },
    );
    // web fonts and remote images decide the measurements, so they are worth a
    // moment — but an offline machine still gets a tree, with fallback metrics
    await page.waitForLoadState('load', { timeout: 4000 }).catch(() => undefined);
    return (await page.evaluate(readInPage)) as NodeSpec[];
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * The walk, as it runs in the page.
 *
 * Passed as a function rather than a source string so it is genuinely called —
 * the same reason `mcp-render` does it that way.
 *
 * Every helper in here is a function *declaration*, deliberately. The
 * transpiler rewrites a named function expression as `__name(fn, "fn")` to keep
 * its name, and `__name` is a module-scope helper that does not exist inside
 * the page — so `const read = () => {}` compiles to something that throws
 * `ReferenceError: __name is not defined` the moment Chromium runs it. A
 * declaration already carries its name and is left alone.
 */
function readInPage(): unknown {
  interface Spec {
    type: string;
    props: Record<string, unknown>;
    children: Spec[];
    ref?: string;
  }

  const ALIGN: Record<string, string> = {
    'flex-start': 'start',
    start: 'start',
    center: 'center',
    'flex-end': 'end',
    end: 'end',
    stretch: 'stretch',
    baseline: 'start',
    normal: 'stretch',
  };
  const JUSTIFY: Record<string, string> = {
    'flex-start': 'start',
    start: 'start',
    center: 'center',
    'flex-end': 'end',
    end: 'end',
    'space-between': 'between',
    normal: 'start',
  };
  const TEXT_ALIGN: Record<string, string> = {
    left: 'left',
    start: 'left',
    center: 'center',
    right: 'right',
    end: 'right',
    justify: 'left',
  };
  /** A run inside a paragraph, not a layer of its own. */
  const INLINE = /^(SPAN|B|STRONG|I|EM|U|A|SMALL|CODE|BR|MARK|SUB|SUP)$/;

  function px(value: string): number {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  function hex(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  }

  /** rgb()/rgba() as the hex or rgba() string the canvas stores. */
  function colour(value: string): string | null {
    if (!value || value === 'transparent') return null;
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return value;
    const parts = match[1].split(',').map(function (p) {
      return Number.parseFloat(p.trim());
    });
    const r = parts[0];
    const g = parts[1];
    const b = parts[2];
    const a = parts.length > 3 ? parts[3] : 1;
    if (a === 0) return null;
    if (a < 1) return `rgba(${r}, ${g}, ${b}, ${round(a)})`;
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  /** A background is a gradient, then a colour, then nothing. */
  function background(style: CSSStyleDeclaration): string | null {
    const image = style.backgroundImage;
    // a url() background belongs on an image node; a gradient is CSS the canvas
    // stores verbatim, because `fill` already speaks CSS
    if (image && image !== 'none' && /gradient\(/.test(image)) return image;
    return colour(style.backgroundColor);
  }

  /**
   * An element whose children are all inline is a text layer, not a frame.
   *
   * Unless it lays its children out. `display: flex` blockifies its children,
   * so a row of `<span>`s is a row of layers however inline the tags look —
   * reading it as one text layer would swallow the spans and the layout with
   * them.
   */
  function isTextish(el: Element, style: CSSStyleDeclaration): boolean {
    if (!el.textContent || !el.textContent.trim()) return false;
    if (/flex|grid/.test(style.display)) return false;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (!INLINE.test((child as Element).tagName)) return false;
    }
    return true;
  }

  function named(el: Element, type: string): string {
    const explicit = el.getAttribute('data-name');
    if (explicit) return explicit.slice(0, 60);
    if (type === 'text') {
      const label = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return label || 'Text';
    }
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
    if (cls) return cls.slice(0, 40);
    return el.tagName.toLowerCase();
  }

  /** Every box-shadow on the layer, as the effects the canvas paints. */
  function shadowsOf(value: string): Record<string, unknown>[] {
    if (!value || value === 'none') return [];
    const entries = value.match(/(?:[^,(]|\([^)]*\))+/g) || [];
    const out: Record<string, unknown>[] = [];
    for (const entry of entries) {
      const found = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(entry);
      const numbers = entry
        .replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|inset/g, ' ')
        .trim()
        .split(/\s+/)
        .map(function (n) {
          return Number.parseFloat(n);
        })
        .filter(function (n) {
          return Number.isFinite(n);
        });
      if (numbers.length < 2) continue;
      out.push({
        type: /inset/.test(entry) ? 'inner-shadow' : 'drop-shadow',
        x: round(numbers[0]),
        y: round(numbers[1]),
        blur: round(numbers.length > 2 ? numbers[2] : 0),
        spread: round(numbers.length > 3 ? numbers[3] : 0),
        color: found ? found[0] : 'rgba(0,0,0,0.2)',
      });
    }
    return out;
  }

  function read(el: Element, parentRect: DOMRect | null, parentIsFlow: boolean): Spec | null {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    const rect = el.getBoundingClientRect();
    const type = el.tagName === 'IMG' ? 'image' : isTextish(el, style) ? 'text' : 'frame';

    const props: Record<string, unknown> = {
      name: named(el, type),
      w: round(rect.width),
      h: round(rect.height),
    };

    // A flowed child is placed by the layout, so its own offset means nothing —
    // writing the measured position in as well would double the padding.
    if (parentIsFlow) {
      props.x = 0;
      props.y = 0;
    } else {
      props.x = round(rect.left - (parentRect ? parentRect.left : 0));
      props.y = round(rect.top - (parentRect ? parentRect.top : 0));
    }

    // Sizing, which is the inverse of the three SizeModes: a flex child that
    // grows fills, text hugs its height, everything else is the measured box.
    if (parentIsFlow && Number.parseFloat(style.flexGrow) > 0) props.wMode = 'fill';
    if (type === 'text') props.hMode = 'fit';

    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity < 1) props.opacity = round(opacity);

    const radius = px(style.borderTopLeftRadius);
    if (radius > 0) props.radius = round(radius);

    if (style.overflow === 'hidden' || style.overflow === 'clip') props.clip = true;

    const borderWidth = px(style.borderTopWidth);
    if (borderWidth > 0 && style.borderTopStyle !== 'none') {
      props.border = {
        width: round(borderWidth),
        color: colour(style.borderTopColor) || '#000000',
        style: /dashed|dotted/.test(style.borderTopStyle) ? style.borderTopStyle : 'solid',
        position: 'inside',
      };
    }

    const effects = shadowsOf(style.boxShadow);
    if (effects.length) props.effects = effects;

    if (type === 'image') {
      const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      if (src) props.src = src;
    } else {
      const fill = background(style);
      if (fill) props.fill = fill;
    }

    if (type === 'text') {
      props.text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const size = px(style.fontSize);
      const lineHeight = style.lineHeight === 'normal' ? 0 : px(style.lineHeight);
      props.font = {
        family: (style.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim() || 'Inter',
        size: round(size),
        weight: Number.parseInt(style.fontWeight, 10) || 400,
        // stored as a multiple, the way Figma's panel shows it
        lineHeight: lineHeight && size ? round(lineHeight / size) : 1.2,
        letterSpacing: style.letterSpacing === 'normal' ? 0 : round(px(style.letterSpacing)),
        align: TEXT_ALIGN[style.textAlign] || 'left',
        color: colour(style.color) || '#000000',
      };
    }

    // Flow: a flex container becomes an auto layout and its children stop
    // carrying coordinates. Everything else keeps absolute children.
    const flow = style.display === 'flex' || style.display === 'inline-flex';
    if (flow && type === 'frame') {
      const column = style.flexDirection.indexOf('column') === 0;
      props.flex = {
        mode: 'flex',
        direction: column ? 'column' : 'row',
        gap: round(px(column ? style.rowGap : style.columnGap)),
        padding: [
          round(px(style.paddingTop)),
          round(px(style.paddingRight)),
          round(px(style.paddingBottom)),
          round(px(style.paddingLeft)),
        ],
        align: ALIGN[style.alignItems] || 'start',
        justify: JUSTIFY[style.justifyContent] || 'start',
        wrap: style.flexWrap === 'wrap',
      };
    }

    const children: Spec[] = [];
    if (type === 'frame') {
      for (const child of Array.from(el.children)) {
        const spec = read(child, rect, flow);
        if (spec) children.push(spec);
      }
    }

    const ref = el.getAttribute('data-ref');
    const out: Spec = { type, props, children };
    if (ref) out.ref = ref;
    return out;
  }

  const roots: Spec[] = [];
  const bodyRect = document.body.getBoundingClientRect();
  for (const child of Array.from(document.body.children)) {
    const spec = read(child, bodyRect, false);
    if (spec) roots.push(spec);
  }
  return roots;
}
