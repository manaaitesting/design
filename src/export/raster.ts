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

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Encoding the PNG failed.'));
    }, 'image/png');
  });
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
