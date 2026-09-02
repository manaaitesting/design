import type { DocStore } from '../document/store';
import { DEFAULT_FONT } from '../document/defaults';
import { newEffect } from '../document/effects';
import type { Effect, EffectType, NodeType, SceneNode } from '../document/types';

/**
 * HTML into the canvas.
 *
 * This canvas *is* HTML and CSS — `nodeStyle()` maps a node onto a declaration
 * block — so the inverse is not a translation to guess at, it is the same
 * mapping read backwards. The reading is done by a browser rather than a
 * parser: lay the markup out, ask `getComputedStyle`, and the cascade,
 * shorthands, inheritance, `em`, `%`, flexbox and the default stylesheet have
 * all been resolved by the engine the canvas renders with.
 *
 * The MCP server runs the walk in headless Chromium; the AI assistant runs the
 * very same function in a hidden iframe. One walk, two hosts.
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

/** The document the markup is laid out in, shared by both hosts. */
export function importDocument(html: string, options: ReadOptions = {}): string {
  const width = Math.min(4096, Math.max(1, Math.round(options.width ?? 1440)));
  return `<!doctype html><html><head><meta charset="utf-8">
       <!-- The walk is transpiled before it is serialised into this page, and the
            transpiler rewrites every named function as \`__name(fn, "fn")\` so
            stack traces keep their names. That helper lives at module scope in
            Node, which the page has no sight of, so it is defined here as the
            identity it effectively is. -->
       <script>window.__name = window.__name || function (fn) { return fn; };</script>
       <!-- the canvas sets type in Inter, so the markup is measured in Inter
            too: a fallback face a few percent narrower would hand every text
            layer a width it then wraps inside -->
       <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block">
       <style>
         *, *::before, *::after { box-sizing: border-box; }
         html, body { margin: 0; padding: 0; }
         /* the root is the frame the markup is measured against, so it must not
            impose a width of its own beyond the one asked for */
         body { width: ${width}px; font-family: Inter, system-ui, sans-serif; }
       </style>
       ${options.css ? `<style>${options.css.replace(/<\/style/gi, '<\\/style')}</style>` : ''}
       </head><body>${html}</body></html>`;
}

/**
 * The walk, as it runs in the page.
 *
 * Every helper in here is a function *declaration*, deliberately. The
 * transpiler rewrites a named function expression as `__name(fn, "fn")` to keep
 * its name, and `__name` is a module-scope helper that does not exist inside a
 * headless page — so `const read = () => {}` would throw `ReferenceError:
 * __name is not defined` the moment Chromium runs it. A declaration already
 * carries its name and is left alone.
 *
 * `doc` is the document to read. Headless Chromium calls this with none and
 * reads its own; the iframe host passes the frame's document in.
 */
export function readInPage(doc?: Document): unknown {
  const root: Document = doc || document;
  const view = root.defaultView || window;

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
  const ELEMENT_NODE = 1;

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
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(function (p) {
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

  /** A url() background on a box: the picture becomes the layer's image. */
  function backgroundUrl(style: CSSStyleDeclaration): string | null {
    // greedy: a data url can carry parentheses of its own
    const match = /^url\((["']?)(.*)\1\)$/.exec(style.backgroundImage || '');
    return match ? match[2] : null;
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
    if (/flex|grid/.test(style.display) && el.children.length > 0) return false;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (!INLINE.test((child as Element).tagName)) return false;
    }
    return true;
  }

  /**
   * A flex box holding nothing but words — a button, a pill, a badge — is two
   * layers, not one: the box keeps its background, padding and centring, and
   * the words become a text layer inside it. Read as a single text layer the
   * box would lose its fill; read as a frame it would lose its words.
   */
  function isLabelledBox(el: Element, style: CSSStyleDeclaration): boolean {
    if (!/flex|grid/.test(style.display) || el.children.length > 0) return false;
    if (!el.textContent || !el.textContent.trim()) return false;
    return px(style.paddingLeft) > 0 || px(style.paddingTop) > 0 || background(style) !== null || px(style.borderTopWidth) > 0;
  }

  function fontOf(style: CSSStyleDeclaration): Record<string, unknown> {
    const size = px(style.fontSize);
    const lineHeight = style.lineHeight === 'normal' ? 0 : px(style.lineHeight);
    const spacing = style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing);
    return {
      family: (style.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim() || 'Inter',
      size: round(size),
      weight: Number.parseInt(style.fontWeight, 10) || 400,
      // stored as a multiple, the way Figma's panel shows it
      lineHeight: lineHeight && size ? round(lineHeight / size) : 1.2,
      // stored in em: the canvas writes `${letterSpacing}em`
      letterSpacing: spacing && size ? Math.round((spacing / size) * 1000) / 1000 : 0,
      align: TEXT_ALIGN[style.textAlign] || 'left',
      color: colour(style.color) || '#000000',
    };
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
    // an anonymous box is named for what it is, the way Figma names a new
    // frame, rather than for the tag it happened to be written with
    const tag = el.tagName.toLowerCase();
    if (type === 'image') return 'Image';
    if (/^(div|section|article|main|aside|li|ul|ol|form|figure)$/.test(tag)) return 'Frame';
    if (/^h[1-6]$/.test(tag)) return 'Heading';
    return { header: 'Header', footer: 'Footer', nav: 'Nav', button: 'Button', a: 'Link', label: 'Label', input: 'Input', p: 'Paragraph' }[tag] ?? tag;
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
    // scripts and styles lay out to nothing, and an <svg> is a picture, not a tree
    if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) return null;
    const style = view.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const isImg = el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'svg';
    const labelled = !isImg && isLabelledBox(el, style);
    const pictured = !isImg && !labelled && !isTextish(el, style) && el.children.length === 0 ? backgroundUrl(style) : null;
    const type = isImg || pictured ? 'image' : !labelled && isTextish(el, style) ? 'text' : 'frame';

    const props: Record<string, unknown> = {
      name: named(el, type),
      // a text box is rounded up: a width a hair short of the glyphs wraps
      // the last word onto a line of its own
      w: type === 'text' ? Math.ceil(rect.width) + 1 : round(rect.width),
      h: round(rect.height),
    };

    // A flowed child is placed by the layout, so its own offset means nothing —
    // writing the measured position in as well would double the padding.
    if (parentIsFlow && style.position !== 'absolute') {
      props.x = 0;
      props.y = 0;
    } else {
      props.x = round(rect.left - (parentRect ? parentRect.left : 0));
      props.y = round(rect.top - (parentRect ? parentRect.top : 0));
      if (parentIsFlow) props.absolute = true;
    }

    // Sizing, which is the inverse of the three SizeModes: a flex child that
    // grows fills, text hugs its height, everything else is the measured box.
    if (parentIsFlow && Number.parseFloat(style.flexGrow) > 0) props.wMode = 'fill';
    if (type === 'text') props.hMode = 'fit';

    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity < 1) props.opacity = round(opacity);

    const radius = px(style.borderTopLeftRadius);
    if (radius > 0) props.radius = round(Math.min(radius, Math.min(rect.width, rect.height) / 2));

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
      if (el.tagName === 'IMG') {
        const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
        if (src) props.src = src;
      } else if (pictured) {
        props.src = pictured;
      } else {
        // an inline svg is serialised into a data url so it paints as drawn
        const xml = new (view as Window & typeof globalThis).XMLSerializer().serializeToString(el);
        props.src = `data:image/svg+xml;utf8,${encodeURIComponent(xml)}`;
      }
      const fill = colour(style.backgroundColor);
      if (fill) props.fill = fill;
    } else {
      // written even when there is none: a frame made with no fill named
      // would otherwise take the store's default, and come out white
      props.fill = background(style);
    }

    if (type === 'text') {
      props.text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      props.font = fontOf(style);
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
    if (labelled) {
      // the words, measured on their own so the text layer is the size of the
      // text rather than of the box around it
      const range = root.createRange();
      range.selectNodeContents(el);
      const words = range.getBoundingClientRect();
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      children.push({
        type: 'text',
        props: {
          name: text.slice(0, 40) || 'Text',
          text,
          x: flow ? 0 : round(words.left - rect.left),
          y: flow ? 0 : round(words.top - rect.top),
          w: round(words.width),
          h: round(words.height),
          hMode: 'fit',
          font: fontOf(style),
        },
        children: [],
      });
    } else if (type === 'frame') {
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
  const bodyRect = root.body.getBoundingClientRect();
  for (const child of Array.from(root.body.children)) {
    const spec = read(child, bodyRect, false);
    if (spec) roots.push(spec);
  }
  return roots;
}

/**
 * Lays the markup out in a hidden iframe and reads it back — the browser host
 * of the walk above. Web fonts and remote pictures decide the measurements, so
 * the frame is given a moment to load them; an offline machine still gets a
 * tree, with fallback metrics.
 */
export async function readHtmlInBrowser(html: string, options: ReadOptions = {}): Promise<NodeSpec[]> {
  const width = Math.min(4096, Math.max(1, Math.round(options.width ?? 1440)));
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:900px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(frame);
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return [];
    doc.open();
    doc.write(importDocument(html, options));
    doc.close();
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (doc.readyState === 'complete') done();
      else win.addEventListener('load', done, { once: true });
      window.setTimeout(done, 4000);
    });
    if ('fonts' in doc) await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    return readInPage(doc) as NodeSpec[];
  } finally {
    frame.remove();
  }
}

const DEFAULT_BORDER = { width: 1, color: '#000000', style: 'solid', position: 'inside' } as const;

/**
 * A spec's properties as a node patch: font and border are whole objects on a
 * node, so they are merged over the defaults rather than replacing them, and a
 * list of effects is given ids and every field the renderer reads.
 */
export function specProps(props: Record<string, unknown>): Partial<SceneNode> {
  const out: Record<string, unknown> = { ...props };
  if (out.font) out.font = { ...DEFAULT_FONT, ...(out.font as object) };
  if (out.border) out.border = { ...DEFAULT_BORDER, ...(out.border as object) };
  if (Array.isArray(out.effects)) {
    out.effects = (out.effects as { type: EffectType }[]).map(
      (effect, index): Effect => ({ ...newEffect(effect.type), id: `html-${index}-${Math.random().toString(36).slice(2, 6)}`, ...effect }),
    );
    Object.assign(out, { shadow: null, innerShadow: null, shadows: [] });
  }
  return out as Partial<SceneNode>;
}

/**
 * Writes a spec tree into the document, depth first.
 *
 * `data-ref` on the source markup comes back out as a name → id mapping, so
 * whoever built a screen from HTML can address the pieces of it afterwards
 * without reading the tree back.
 */
export function writeSpecs(
  store: DocStore,
  specs: NodeSpec[],
  parentId: string,
  refs: Map<string, string> = new Map(),
): { count: number; top: string[]; refs: Map<string, string> } {
  let count = 0;
  const top: string[] = [];
  for (const spec of specs) {
    const id = store.create(spec.type as NodeType, parentId, specProps(spec.props));
    top.push(id);
    count += 1;
    if (spec.ref) refs.set(spec.ref, id);
    if (spec.children.length) count += writeSpecs(store, spec.children, id, refs).count;
  }
  return { count, top, refs };
}
