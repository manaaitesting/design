'use client';

import { needsPaintLayers, paintLayers } from '../document/css';
import { colourMatrix, transferFunctions, type ImageAdjust } from '../document/adjust';
import type { SceneNode } from '../document/types';

/**
 * Image paints that need an element of their own.
 *
 * An adjusted or rotated picture cannot be a `background` on the layer — a
 * filter applies to a whole element and a background cannot be turned — so
 * those paints are drawn as their own stacked layers, in the order they would
 * have composed in. Everything else still takes the cheap path.
 */
export function PaintLayers({ node }: { node: SceneNode }) {
  if (!needsPaintLayers(node)) return null;
  const layers = paintLayers(node);

  return (
    <>
      {layers.map((layer) => (
        <div key={layer.id} aria-hidden style={layer.style}>
          {layer.filter && <AdjustFilter id={layer.filter.id} adjust={layer.filter.adjust} />}
        </div>
      ))}
    </>
  );
}

/**
 * The half of an image adjustment CSS cannot express.
 *
 * Temperature and tint are a colour matrix; highlights and shadows are transfer
 * functions over every channel. The filter is defined inside the layer it
 * belongs to, with an id derived from the layer and the paint, so it travels
 * with the markup when the design is exported.
 */
export function AdjustFilter({ id, adjust }: { id: string; adjust: ImageAdjust }) {
  const matrix = colourMatrix(adjust);
  const { exponent, intercept, slope } = transferFunctions(adjust);

  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix.join(' ')} />
        <feComponentTransfer>
          <feFuncR type="gamma" exponent={exponent} amplitude={1} offset={0} />
          <feFuncG type="gamma" exponent={exponent} amplitude={1} offset={0} />
          <feFuncB type="gamma" exponent={exponent} amplitude={1} offset={0} />
        </feComponentTransfer>
        <feComponentTransfer>
          <feFuncR type="linear" slope={slope} intercept={intercept} />
          <feFuncG type="linear" slope={slope} intercept={intercept} />
          <feFuncB type="linear" slope={slope} intercept={intercept} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
