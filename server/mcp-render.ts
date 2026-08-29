import fs from 'node:fs';
import path from 'node:path';
import { toHtml } from '../src/export/toCode';
import { fillRuleOf, shapePath } from '../src/document/geometry';
import type { Doc, SceneNode, Token } from '../src/document/types';
import type { CustomFont } from '../src/lib/fonts';
import type { Collection } from '../src/document/variables';

/**
 * Headless rendering for the MCP server.
 *
 * A screenshot tool has to draw the design without a browser tab open, and the
 * canvas is real DOM — so the picture comes from the same `toHtml` export the
 * user downloads, opened in headless Chromium. Nothing here is a second
 * renderer: what the agent sees is what the export produces, which is what the
 * canvas draws.
 *
 * Playwright is a dev dependency, so it is imported lazily and its absence is
 * reported as a missing tool rather than crashing the server at startup.
 */

type Browser = Awaited<ReturnType<typeof launch>>;

async function launch() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch();
}

let browser: Promise<Browser> | null = null;

/** The shared headless browser, for anything else that needs a real DOM. */
export function headless(): Promise<Browser> {
  return chrome();
}

async function chrome(): Promise<Browser> {
  if (!browser) {
    browser = launch().catch((error) => {
      browser = null;
      throw new Error(
        `Headless Chromium is unavailable — run \`npx playwright install chromium\`. (${
          (error as Error).message
        })`,
      );
    });
  }
  return browser;
}

export async function closeRenderer(): Promise<void> {
  const running = browser;
  browser = null;
  if (running) await running.then((b) => b.close()).catch(() => undefined);
}

export interface RenderContext {
  doc: Doc;
  tokens: Token[];
  collections: Collection[];
  fonts: CustomFont[];
}

export interface RenderOptions {
  format?: 'png' | 'jpeg' | 'svg';
  /** resolution multiplier, before `maxDimension` gets a say */
  scale?: number;
  /** caps the longer edge of the result, as Figma's screenshot tool does */
  maxDimension?: number;
  /** drop the layer's own paint and keep what is inside it */
  contentsOnly?: boolean;
}

export interface Rendered {
  data: Buffer;
  format: 'png' | 'jpeg' | 'svg';
  width: number;
  height: number;
  /** the node's own size on the canvas, before any clamping */
  originalWidth: number;
  originalHeight: number;
  scale: number;
}

/** The page `toHtml` writes centres its content and paints a grey ground. */
const STANDALONE = `<style>
  body { display: block !important; min-height: 0 !important; background: transparent !important; }
  body > div:first-of-type { margin: 0 !important; }
</style>`;

/**
 * Serialises the rendered root into an SVG, the way the in-app export does.
 *
 * These run in the page, so they are passed to `evaluate` as functions rather
 * than as source strings: a string that merely looks like a function is not
 * reliably *called*, and the one that measures the root failed silently that
 * way — every hug-sized layer came back at whatever number was last stored on
 * it.
 */
function toSvgInPage(size: { width: number; height: number }): string | null {
  const source = document.querySelector('body > div');
  if (!source) return null;
  const clone = source.cloneNode(true) as HTMLElement;
  document.querySelectorAll('canvas').forEach((canvas, index) => {
    const target = clone.querySelectorAll('canvas')[index];
    if (!target) return;
    try {
      const image = document.createElement('img');
      image.setAttribute('src', canvas.toDataURL('image/png'));
      image.setAttribute('style', 'display:block;width:100%;height:100%');
      target.replaceWith(image);
    } catch {
      /* a tainted context keeps the placeholder */
    }
  });
  clone.style.position = 'static';
  clone.style.margin = '0';
  clone.style.width = `${size.width}px`;
  clone.style.height = `${size.height}px`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}">` +
    `<foreignObject x="0" y="0" width="${size.width}" height="${size.height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${new XMLSerializer().serializeToString(clone)}</div>` +
    `</foreignObject></svg>`
  );
}

/** What the root element actually rendered as, whatever the node claimed. */
function measureInPage(): { width: number; height: number } | null {
  const root = document.querySelector('body > div');
  if (!root) return null;
  const box = root.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

/** Strips the root layer's own paint — Figma's "Contents only". */
function contentsOnlyInPage(): void {
  const root = document.querySelector('body > div') as HTMLElement | null;
  if (!root) return;
  root.style.background = 'none';
  root.style.border = 'none';
  root.style.boxShadow = 'none';
  root.style.borderRadius = '0';
}

/** The size the design says, which is only a guess for a layer that hugs. */
function statedSize(node: SceneNode, doc: Doc): { width: number; height: number } {
  if (node.type === 'page') {
    return { width: Math.round(pageWidth(node, doc)), height: Math.round(pageHeight(node, doc)) };
  }
  return { width: Math.round(node.w), height: Math.round(node.h) };
}

/** Loads the export and reports what the root actually came out as. */
async function open(
  html: string,
  size: { width: number; height: number },
  scale: number,
  contentsOnly = false,
) {
  const page = await (await chrome()).newPage({
    viewport: {
      width: Math.min(4096, Math.max(1, size.width)),
      height: Math.min(4096, Math.max(1, size.height)),
    },
    deviceScaleFactor: Math.max(0.01, scale),
  });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  // web fonts and remote images are best-effort: an offline machine still gets
  // a picture, it just gets the fallback face
  await page.waitForLoadState('load', { timeout: 3000 }).catch(() => undefined);
  if (contentsOnly) await page.evaluate(contentsOnlyInPage);
  // shader surfaces draw on a frame loop; give them one
  await page.waitForTimeout(250);
  return { page, measured: await page.evaluate(measureInPage) };
}

export async function renderNode(
  nodeId: string,
  context: RenderContext,
  options: RenderOptions = {},
): Promise<Rendered> {
  const node = context.doc[nodeId];
  if (!node) throw new Error(`No node "${nodeId}".`);

  const format = options.format ?? 'png';
  const cap = options.maxDimension ?? 1024;
  const wanted = options.scale ?? 1;

  const html = toHtml(nodeId, context.doc, context.tokens, context.collections, context.fonts)
    .replace('</head>', `${STANDALONE}</head>`);

  /**
   * A frame that hugs its content, or fills its parent, is whatever size the
   * layout makes it — the number on the node is the last one anybody typed. So
   * the picture is measured, not assumed, and the scale is worked out from what
   * came back. The layout is width-driven, so the first pass is opened at the
   * stated width and only the height is a genuine unknown.
   */
  const stated = statedSize(node, context.doc);
  const first = await open(html, { width: stated.width, height: Math.max(stated.height, 900) }, 1, options.contentsOnly);
  const originalWidth = Math.max(1, first.measured?.width ?? stated.width);
  const originalHeight = Math.max(1, first.measured?.height ?? stated.height);

  const longest = Math.max(originalWidth, originalHeight);
  const scale = longest * wanted > cap ? cap / longest : wanted;

  let page = first.page;
  if (format !== 'svg' && Math.abs(scale - 1) > 0.001) {
    // deviceScaleFactor is fixed when the page opens, so the real render is a
    // second pass — now that there is a measured size to open it at
    await first.page.close().catch(() => undefined);
    page = (await open(html, { width: originalWidth, height: originalHeight }, scale, options.contentsOnly)).page;
  } else if (first.measured) {
    await page.setViewportSize({
      width: Math.min(4096, originalWidth),
      height: Math.min(4096, originalHeight),
    });
  }

  try {
    if (format === 'svg') {
      const svg = await page.evaluate(toSvgInPage, {
        width: originalWidth,
        height: originalHeight,
      });
      if (!svg) throw new Error('Nothing rendered — the layer may be hidden.');
      return {
        data: Buffer.from(svg, 'utf8'),
        format,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        scale: 1,
      };
    }

    const element = page.locator('body > div').first();
    const data = await element.screenshot({
      type: format,
      ...(format === 'png' ? { omitBackground: true } : {}),
    });
    return {
      data,
      format,
      width: Math.round(originalWidth * scale),
      height: Math.round(originalHeight * scale),
      originalWidth,
      originalHeight,
      scale,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A page has no box of its own; it is as big as what is on it. */
function pageWidth(page: SceneNode, doc: Doc): number {
  const kids = page.children.map((id) => doc[id]).filter(Boolean);
  if (!kids.length) return 1;
  return Math.max(...kids.map((k) => k.x + k.w)) - Math.min(...kids.map((k) => k.x));
}

function pageHeight(page: SceneNode, doc: Doc): number {
  const kids = page.children.map((id) => doc[id]).filter(Boolean);
  if (!kids.length) return 1;
  return Math.max(...kids.map((k) => k.y + k.h)) - Math.min(...kids.map((k) => k.y));
}

export interface Asset {
  kind: 'export' | 'raw-image' | 'svg';
  nodeId: string;
  name: string;
  format: string;
  file: string;
  bytes: number;
  /** set when the source is a remote address rather than something we hold */
  url?: string;
}

const VECTOR_TYPES = new Set(['vector', 'polygon', 'star', 'line', 'arrow', 'boolean', 'ellipse']);

/** Every image paint under a node, and every layer that is really an icon. */
export function assetsIn(nodeId: string, doc: Doc): { images: SceneNode[]; vectors: SceneNode[] } {
  const images: SceneNode[] = [];
  const vectors: SceneNode[] = [];
  const walk = (id: string): void => {
    const node = doc[id];
    if (!node) return;
    if (node.src) images.push(node);
    if (VECTOR_TYPES.has(node.type) && shapePath(node)) vectors.push(node);
    for (const child of node.children) walk(child);
  };
  walk(nodeId);
  return { images: images.slice(0, 20), vectors: vectors.slice(0, 20) };
}

/** A vector layer as a real `<path>`, not a picture of one. */
export function svgOfShape(node: SceneNode): string | null {
  const d = shapePath(node);
  if (!d) return null;
  const fill = node.fill && node.fill !== 'none' ? node.fill : 'none';
  const stroke = node.border
    ? ` stroke="${node.border.color}" stroke-width="${node.border.width}"`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(node.w)}" height="${Math.round(node.h)}" ` +
    `viewBox="0 0 ${Math.round(node.w)} ${Math.round(node.h)}">` +
    `<path d="${d}" fill="${fill}" fill-rule="${fillRuleOf(node)}"${stroke}/></svg>`
  );
}

/** Writes bytes next to the others and reports what landed where. */
export function writeAsset(dir: string, name: string, data: Buffer | string): { file: string; bytes: number } {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return { file, bytes: Buffer.byteLength(data as string) };
}

/** `data:` payloads are ours to save; anything else stays a reference. */
export function decodeDataUrl(src: string): { data: Buffer; format: string } | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!match) return null;
  const [, mime, base64, body] = match;
  const data = base64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  const format = mime.split('/')[1]?.split('+')[0] ?? 'bin';
  return { data, format };
}
