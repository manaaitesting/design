'use client';

import { useEffect, useRef, useState } from 'react';
import { stageToSvg } from '../export/raster';
import { useDoc, useTokenVars } from './Session';
import { useUI } from '../state/ui';

/**
 * Figma's pixel preview.
 *
 * The canvas is real DOM, so it redraws vectors crisply at any zoom — which is
 * exactly what you do *not* want when you are checking whether a hairline
 * survives, or what a 10px label does to a screen. So the page is rasterised
 * once at the chosen density, and that image is shown back scaled with
 * nearest-neighbour: what you see is the pixels, magnified, not a fresh render.
 *
 * The live stage is hidden underneath rather than unmounted, because the
 * selection, the guides and every other overlay still measure against it.
 */
/**
 * What the page actually occupies, in world units.
 *
 * Measured rather than read off the nodes: a frame that hugs its content is
 * whatever height the layout made it, and the number stored on the node is the
 * last one anybody typed. Offsets are taken against the stage, which is already
 * in world units — going via the screen would drag the live viewport into a
 * sum that has nothing to do with it.
 */
function measureStage(): { x: number; y: number; w: number; h: number } | null {
  const stage = document.querySelector<HTMLElement>('[data-canvas-root] > div');
  if (!stage) return null;
  const tops = [...stage.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.nodeId,
  );
  if (!tops.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of tops) {
    minX = Math.min(minX, element.offsetLeft);
    minY = Math.min(minY, element.offsetTop);
    maxX = Math.max(maxX, element.offsetLeft + element.offsetWidth);
    maxY = Math.max(maxY, element.offsetTop + element.offsetHeight);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function PixelPreview() {
  const doc = useDoc();
  const mode = useUI((state) => state.view.pixelPreview);
  const viewport = useUI((state) => state.viewport);
  const tokenVars = useTokenVars();
  const [shot, setShot] = useState<{ url: string; x: number; y: number; w: number; h: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode === 'off') {
      setShot(null);
      return;
    }

    // rasterising is not cheap, so it waits for the document to settle — the
    // preview is a thing you switch on to look, not to draw through
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const bounds = measureStage();
      if (!bounds) return setShot(null);

      const serialised = stageToSvg(bounds, tokenVars as Record<string, string>);
      if (!serialised) return setShot(null);

      const density = mode === '2x' ? 2 : 1;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(serialised.width * density));
        canvas.height = Math.max(1, Math.round(serialised.height * density));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setShot({
          url: canvas.toDataURL('image/png'),
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
        });
      };
      // a font or an image that will not load leaves the live canvas showing,
      // which is a better answer than a blank rectangle
      image.onerror = () => setShot(null);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised.svg)}`;
    }, 120);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mode, doc, tokenVars]);

  if (mode === 'off' || !shot) return null;

  return (
    <img
      src={shot.url}
      alt=""
      aria-hidden
      data-pixel-preview=""
      style={{
        position: 'absolute',
        left: viewport.x + shot.x * viewport.zoom,
        top: viewport.y + shot.y * viewport.zoom,
        width: shot.w * viewport.zoom,
        height: shot.h * viewport.zoom,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
