/**
 * Image adjustments.
 *
 * Figma gives an image paint seven sliders. Three of them — exposure, contrast
 * and saturation — are CSS filter functions and are exact. The other four have
 * no CSS equivalent, so they are built as a small SVG filter: a colour matrix
 * for temperature and tint, and transfer functions for highlights and shadows.
 *
 * Those four are approximations, and deliberately gentle ones. A slider that
 * moves the image a little in the right direction is honest; one that claims to
 * be a raw developer is not, and this is a design tool rather than a darkroom.
 * Everything here is ordinary markup and CSS, so an adjusted image exports
 * looking the way it looked on the canvas.
 */

export interface ImageAdjust {
  /** −1 … 1, where 0 is the image as it came */
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
}

export const NO_ADJUST: ImageAdjust = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
};

export const ADJUST_LABEL: Record<keyof ImageAdjust, string> = {
  exposure: 'Exposure',
  contrast: 'Contrast',
  saturation: 'Saturation',
  temperature: 'Temperature',
  tint: 'Tint',
  highlights: 'Highlights',
  shadows: 'Shadows',
};

export function isNeutral(adjust: ImageAdjust | undefined): boolean {
  if (!adjust) return true;
  return (Object.keys(NO_ADJUST) as (keyof ImageAdjust)[]).every((key) => !adjust[key]);
}

/** The part CSS can do exactly. */
export function cssFilter(adjust: ImageAdjust): string {
  const parts: string[] = [];
  if (adjust.exposure) parts.push(`brightness(${(1 + adjust.exposure).toFixed(3)})`);
  if (adjust.contrast) parts.push(`contrast(${(1 + adjust.contrast).toFixed(3)})`);
  if (adjust.saturation) parts.push(`saturate(${(1 + adjust.saturation).toFixed(3)})`);
  return parts.join(' ');
}

/** True when the SVG half of the filter is needed at all. */
export function needsSvgFilter(adjust: ImageAdjust | undefined): boolean {
  if (!adjust) return false;
  return !!(adjust.temperature || adjust.tint || adjust.highlights || adjust.shadows);
}

/**
 * The colour matrix for temperature and tint.
 *
 * Temperature trades red against blue — warmer is more red, cooler more blue.
 * Tint trades green against the other two, which is the magenta–green axis a
 * white balance control moves along.
 */
export function colourMatrix(adjust: ImageAdjust): number[] {
  const t = adjust.temperature * 0.25;
  const g = adjust.tint * 0.2;
  return [
    1 + t, 0, 0, 0, 0,
    0, 1 + g, 0, 0, 0,
    0, 0, 1 - t, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/**
 * Transfer functions for highlights and shadows.
 *
 * A gamma below one lifts the middle and top of the range, which is what
 * "highlights" moves; a linear intercept lifts the floor, which is what
 * "shadows" does. Both are applied to every channel, so neither shifts the
 * colour balance.
 */
export function transferFunctions(adjust: ImageAdjust): {
  exponent: number;
  intercept: number;
  slope: number;
} {
  return {
    exponent: Math.max(0.2, 1 - adjust.highlights * 0.5),
    intercept: adjust.shadows * 0.12,
    slope: 1 - Math.abs(adjust.shadows) * 0.08,
  };
}

/** A stable id for the filter element belonging to one paint on one layer. */
export function filterId(nodeId: string, paintId: string): string {
  return `adj-${nodeId}-${paintId}`;
}

/** How an image paint is turned to fit — Figma rotates in right angles. */
export type PaintRotation = 0 | 90 | 180 | 270;

/**
 * A rotated image paint has to be drawn on an element of its own.
 *
 * Backgrounds cannot be rotated, so the layer carrying the picture is turned
 * instead — and at a quarter turn its width and height swap, or the picture
 * would be rotated inside a box the wrong way round.
 */
export function rotationStyle(rotation: PaintRotation, w: number, h: number) {
  if (!rotation) return null;
  const quarter = rotation === 90 || rotation === 270;
  return {
    position: 'absolute' as const,
    left: quarter ? (w - h) / 2 : 0,
    top: quarter ? (h - w) / 2 : 0,
    width: quarter ? h : w,
    height: quarter ? w : h,
    transform: `rotate(${rotation}deg)`,
    transformOrigin: 'center',
  };
}
