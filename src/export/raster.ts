/**
 * Raster / vector export of a live canvas node.
 *
 * Because the canvas is real DOM, a node can be serialised into an SVG
 * `<foreignObject>` and rendered by the browser itself — no shadow renderer to
 * keep in sync with what you actually see.
 */
import { redrawAll } from '../webgl/renderer';

/** Styles that must be carried across; the rest come from inline styles already. */
const INHERITED = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'text-decoration',
  '-webkit-text-stroke-width',
  '-webkit-text-stroke-color',
];

function elementFor(nodeId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
}

/**
 * Replaces every <canvas> in the clone with a snapshot <img>.
 * foreignObject cannot carry a live WebGL surface across.
 */
function freezeCanvases(source: HTMLElement, clone: HTMLElement): void {
  // The GL contexts do not preserve their drawing buffer, so the surfaces must
  // be redrawn and read in one synchronous run — no await between here and the
  // toDataURL calls below, or the buffer is gone.
  redrawAll();
  const originals = source.querySelectorAll('canvas');
  const clones = clone.querySelectorAll('canvas');
  clones.forEach((canvasClone, index) => {
    const original = originals[index];
    if (!original) return;
    let dataUrl = '';
    try {
      dataUrl = original.toDataURL('image/png');
    } catch {
      return; // tainted context — leave the placeholder
    }
    const img = document.createElement('img');
    img.setAttribute('src', dataUrl);
    img.setAttribute('style', `display:block;width:100%;height:100%;${canvasClone.getAttribute('style') ?? ''}`);
    canvasClone.replaceWith(img);
  });
}

/** Copies the inheritable typography that foreignObject would otherwise lose. */
function inlineInherited(source: HTMLElement, clone: HTMLElement): void {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  sourceNodes.forEach((original, index) => {
    const target = cloneNodes[index];
    if (!target || !(target instanceof HTMLElement)) return;
    const computed = getComputedStyle(original);
    for (const property of INHERITED) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });
}

interface Serialised {
  svg: string;
  width: number;
  height: number;
}

/**
 * Serialises a node into a standalone SVG document.
 *
 * `vars` carries the theme tokens, which are declared on the canvas root — once
 * the node is lifted out of that subtree, `var(--brand)` has nothing to resolve
 * against and every tokenised fill would render transparent.
 */
export function nodeToSvg(
  nodeId: string,
  zoom: number,
  vars: Record<string, string> = {},
  /** Figma's "Contents only": drop the layer's own paint and keep what is in it */
  contentsOnly = false,
): Serialised | null {
  const source = elementFor(nodeId);
  if (!source) return null;
  // a slice exports what is under it, not itself
  if (source.hasAttribute('data-slice')) return sliceToSvg(source, zoom, vars);

  const rect = source.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width / zoom));
  const height = Math.max(1, Math.round(rect.height / zoom));

  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-node-id');
  freezeCanvases(source, clone);
  inlineInherited(source, clone);

  // the node is placed by its parent on the canvas; standalone it starts at 0,0
  clone.style.position = 'static';
  clone.style.left = '';
  clone.style.top = '';
  clone.style.margin = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.transform = clone.style.transform.replace(/scale\([^)]*\)/g, '').trim();

  if (contentsOnly) {
    clone.style.background = 'none';
    clone.style.border = 'none';
    clone.style.boxShadow = 'none';
    clone.style.borderRadius = '0';
  } else if (source.dataset.exportBackground === 'off') {
    // "Show in exports" turned off: the fill goes, the frame itself stays —
    // its stroke, its radius and its shadow are still part of the picture.
    clone.style.background = 'none';
  }

  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${declarations}">` +
    new XMLSerializer().serializeToString(clone) +
    `</div></foreignObject></svg>`;

  return { svg, width, height };
}

/**
 * The whole page, serialised at world scale.
 *
 * Pixel preview needs the design as it *rasterises*, not as the browser draws
 * it at the current zoom — so the stage is lifted out of its transform and
 * measured in world units, exactly as an export would.
 */
export function stageToSvg(
  bounds: { x: number; y: number; w: number; h: number },
  vars: Record<string, string> = {},
): Serialised | null {
  const stage = document.querySelector<HTMLElement>('[data-canvas-root] > div');
  if (!stage) return null;

  const width = Math.max(1, Math.round(bounds.w));
  const height = Math.max(1, Math.round(bounds.h));

  const clone = stage.cloneNode(true) as HTMLElement;
  freezeCanvases(stage, clone);
  inlineInherited(stage, clone);
  // the stage carries the viewport; the raster is in world coordinates, so the
  // transform becomes a plain shift that puts the content's corner at 0,0
  clone.style.position = 'absolute';
  clone.style.inset = '0';
  clone.style.transform = `translate(${-bounds.x}px, ${-bounds.y}px)`;
  clone.style.transformOrigin = '0 0';
  // the live stage is hidden while its raster stands in for it, and a clone
  // taken then inherits that — which is a picture of nothing
  clone.style.visibility = 'visible';

  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;${declarations}">` +
    new XMLSerializer().serializeToString(clone) +
    `</div></foreignObject></svg>`;

  return { svg, width, height };
}

/**
 * A slice exports the region it covers.
 *
 * Everything else here serialises one layer; a slice is the opposite — it has
 * no content of its own and its whole purpose is the artwork underneath. So the
 * page is what gets cloned, shifted so the slice's corner lands at the origin,
 * and cropped to the slice's size.
 */
function sliceToSvg(
  slice: HTMLElement,
  zoom: number,
  vars: Record<string, string>,
): Serialised | null {
  const stage = document.querySelector<HTMLElement>('[data-canvas-root] > div');
  if (!stage) return null;
  // "Show in exports": the page colour is painted on the canvas root, so a crop
  // taken out of the stage alone comes out transparent behind the artwork.
  // Reading it back off the root is what puts the page under the slice.
  const root = stage.parentElement;
  const background =
    root && root.dataset.exportBackground !== 'off' ? getComputedStyle(root).backgroundColor : '';

  const stageRect = stage.getBoundingClientRect();
  const sliceRect = slice.getBoundingClientRect();
  const width = Math.max(1, Math.round(sliceRect.width / zoom));
  const height = Math.max(1, Math.round(sliceRect.height / zoom));
  // where the slice sits on the page, in world units
  const x = (sliceRect.left - stageRect.left) / zoom;
  const y = (sliceRect.top - stageRect.top) / zoom;

  const clone = stage.cloneNode(true) as HTMLElement;
  freezeCanvases(stage, clone);
  inlineInherited(stage, clone);
  // the slices themselves are chrome, and must not appear in what they export
  clone.querySelectorAll('[data-slice]').forEach((element) => element.remove());

  clone.style.position = 'absolute';
  clone.style.transform = `translate(${-x}px, ${-y}px)`;
  clone.style.transformOrigin = '0 0';
  clone.style.left = '0';
  clone.style.top = '0';

  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;overflow:hidden;width:${width}px;height:${height}px;${background ? `background:${background};` : ''}${declarations}">` +
    new XMLSerializer().serializeToString(clone) +
    `</div></foreignObject></svg>`;

  return { svg, width, height };
}

/** Draws a serialised node onto a canvas at the requested pixel scale. */
async function rasterise(serialised: Serialised, scale: number): Promise<HTMLCanvasElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised.svg)}`;
  const image = new Image();
  image.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error('Could not rasterise — an external image or font blocked the render.'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(serialised.width * scale);
  canvas.height = Math.round(serialised.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, message: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(message));
    }, type, type === 'image/jpeg' ? 0.92 : undefined);
  });
}

/** Renders the node to a PNG at the requested pixel scale. */
export async function nodeToPng(
  nodeId: string,
  zoom: number,
  scale: number,
  vars: Record<string, string> = {},
  contentsOnly = false,
): Promise<Blob> {
  const serialised = nodeToSvg(nodeId, zoom, vars, contentsOnly);
  if (!serialised) throw new Error('That layer is not on screen — scroll it into view and try again.');
  return encode(await rasterise(serialised, scale), 'image/png', 'Encoding the PNG failed.');
}

/**
 * Renders the node to a JPG at the requested pixel scale.
 *
 * JPEG has no alpha, so anything transparent in the layer comes out black
 * unless something is painted behind it — which is exactly what Figma's JPG
 * export does, and the reason PNG stays the default.
 */
export async function nodeToJpg(
  nodeId: string,
  zoom: number,
  scale: number,
  vars: Record<string, string> = {},
  contentsOnly = false,
): Promise<Blob> {
  const serialised = nodeToSvg(nodeId, zoom, vars, contentsOnly);
  if (!serialised) throw new Error('That layer is not on screen — scroll it into view and try again.');
  return encode(await rasterise(serialised, scale), 'image/jpeg', 'Encoding the JPG failed.');
}

/**
 * Renders the node to a one-page PDF.
 *
 * The page is the layer's own size in points — PDF's unit is 1/72", which is
 * what a CSS pixel is measured against, so a 600-wide frame comes out 600pt and
 * lands in a layout at the size it was drawn.
 *
 * The artwork inside it is a raster, not vector: the canvas is real DOM, and
 * what turns that into a picture here is the browser's own SVG renderer, which
 * hands back pixels. `scale` is therefore the resolution of the result rather
 * than its size. A vector PDF would mean a second renderer walking the document
 * — the one thing the style invariant exists to prevent — so this stays honest
 * about being a raster and the ledger says so.
 */
export async function nodeToPdf(
  nodeId: string,
  zoom: number,
  scale: number,
  vars: Record<string, string> = {},
  contentsOnly = false,
): Promise<Blob> {
  const serialised = nodeToSvg(nodeId, zoom, vars, contentsOnly);
  if (!serialised) throw new Error('That layer is not on screen — scroll it into view and try again.');
  const canvas = await rasterise(serialised, scale);
  const jpeg = await encode(canvas, 'image/jpeg', 'Encoding the PDF image failed.');
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  return pdfWithImage(bytes, canvas.width, canvas.height, serialised.width, serialised.height);
}

/**
 * The smallest valid PDF that holds one JPEG: catalogue, page tree, page,
 * image, content stream, and the cross-reference table that says where each of
 * them starts.
 *
 * Written by hand rather than with a library because the whole of it is these
 * forty lines, and every byte offset in the table has to be counted as the file
 * is built — which is the only part a library would actually be doing.
 */
function pdfWithImage(
  jpeg: Uint8Array,
  pixelW: number,
  pixelH: number,
  pointW: number,
  pointH: number,
): Blob {
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let at = 0;
  // every string written here is ASCII, so its length is its byte count
  const push = (chunk: string | Uint8Array) => {
    parts.push(chunk as BlobPart);
    at += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
  };
  const object = (n: number, body: string) => {
    offsets[n] = at;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pointW} ${pointH}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );

  // the image is written out by hand: its stream is the JPEG's own bytes
  offsets[4] = at;
  push(
    '4 0 obj\n<< /Type /XObject /Subtype /Image ' +
      `/Width ${pixelW} /Height ${pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');

  // the unit square the image is drawn into, stretched to fill the page
  const content = `q ${pointW} 0 0 ${pointH} 0 0 cm /Im0 Do Q\n`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const startxref = at;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a beat to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'export';
}
