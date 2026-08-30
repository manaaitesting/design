'use client';

import { backgroundOf, imageSizing, shapePaint, withAlpha, type ShapeStroke } from '../document/css';
import { booleanClips } from '../document/geometry';
import { booleanOutlinePath } from '../document/boolean';
import { ShaderSurface } from './ShaderSurface';
import type { Doc, SceneNode } from '../document/types';

/**
 * How a shape paints.
 *
 * The fill is a background clipped to the outline, so every paint the inspector
 * can produce — stacks, gradients, images, blend modes — works on a star or a
 * boolean group exactly as it does on a rectangle. Only the stroke goes through
 * SVG, because CSS has no way to run a line along an arbitrary path.
 *
 * Everything here is plain markup with plain styles, which is what lets the
 * exporter emit the same two layers instead of a screenshot.
 */

const SVG_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
};

/**
 * Draws a stroke along `d`.
 *
 * SVG only strokes down the middle of a path, so Figma's inside and outside
 * alignments are drawn at double width and then clipped to the half that should
 * survive — the standard trick, and the only one that keeps a dash pattern and a
 * line join looking right.
 */
export function StrokePath({
  id,
  d,
  stroke,
  fillRule,
  width,
  height,
}: {
  id: string;
  d: string;
  stroke: ShapeStroke;
  fillRule?: 'nonzero' | 'evenodd';
  width: number;
  height: number;
}) {
  const clipped = stroke.align !== 'center';
  const drawWidth = clipped ? stroke.width * 2 : stroke.width;
  const clipId = `${id}-stroke-clip`;
  const maskId = `${id}-stroke-mask`;
  // the stroke can sit outside the box, so the mask has to be roomier than it
  const pad = Math.max(stroke.width * 2, 8);

  return (
    <svg
      style={SVG_STYLE}
      viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {stroke.align === 'inside' && (
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={d} clipRule={fillRule} />
          </clipPath>
        </defs>
      )}
      {stroke.align === 'outside' && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect
              x={-pad}
              y={-pad}
              width={Math.max(width, 1) + pad * 2}
              height={Math.max(height, 1) + pad * 2}
              fill="#fff"
            />
            <path d={d} fill="#000" fillRule={fillRule} />
          </mask>
        </defs>
      )}
      <path
        d={d}
        fill="none"
        stroke={stroke.color}
        strokeWidth={drawWidth}
        strokeDasharray={stroke.dash ?? undefined}
        strokeLinecap={stroke.cap}
        strokeLinejoin={stroke.join}
        strokeMiterlimit={stroke.join === 'miter' ? stroke.miterLimit : undefined}
        vectorEffect="non-scaling-stroke"
        clipPath={stroke.align === 'inside' ? `url(#${clipId})` : undefined}
        mask={stroke.align === 'outside' ? `url(#${maskId})` : undefined}
      />
    </svg>
  );
}

/** A vector, polygon, star, line, arrow or arc — fill layer plus stroke. */
export function PathShape({ node }: { node: SceneNode }) {
  const paint = shapePaint(node);
  if (!paint) return null;
  return (
    <>
      {paint.fill && (
        // the shader draws inside the clipped layer, so it is the shape that is
        // filled rather than the box the shape happens to sit in
        //
        // `data-paint` is how a timeline reaches it: a star's colour lives on
        // this layer rather than on the box, so a fill track has to animate
        // this element and not its parent. See `document/motion`.
        <div data-paint={node.id} aria-hidden style={paint.fill}>
          {paint.shader && <ShaderSurface shaderId={paint.shader.id} params={paint.shader.params} />}
        </div>
      )}
      {paint.stroke && paint.band && (
        // a variable-width stroke is a filled band, not a stroked line — the
        // only way SVG can taper
        <svg
          style={SVG_STYLE}
          viewBox={`0 0 ${Math.max(node.w, 1)} ${Math.max(node.h, 1)}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={paint.band} fill={paint.stroke.color} fillRule="evenodd" />
        </svg>
      )}
      {paint.stroke && !paint.band && (
        <StrokePath
          id={node.id}
          d={paint.d}
          stroke={paint.stroke}
          fillRule={paint.fillRule}
          width={node.w}
          height={node.h}
        />
      )}
    </>
  );
}

/**
 * A live boolean group.
 *
 * The four operations are all expressible as nested clips, which is why this
 * stays live: nothing is baked, the children keep their own geometry, and
 * dragging one re-evaluates the result on the next paint. `booleanClips` says
 * what the nesting is; here it is only turned into elements.
 */
export function BooleanShape({ node, doc }: { node: SceneNode; doc: Doc }) {
  const children = node.children.map((id) => doc[id]).filter((child) => child?.visible);
  if (children.length === 0) return null;

  const clips = booleanClips(node, children);
  if (!clips.length) return null;

  const background = backgroundOf(node);
  const shader = node.shader;
  // the innermost element carries the paint; every clip above it narrows what
  // is left of it, which is exactly what an intersection is
  let content: React.ReactNode =
    background || shader ? (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          ...(background ? { background } : null),
          ...(background.includes('url(') ? imageSizing(node) : null),
        }}
      >
        {shader && <ShaderSurface shaderId={shader.id} params={shader.params} />}
      </div>
    ) : null;
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i];
    content = (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `path(${clip.rule === 'evenodd' ? 'evenodd, ' : ''}'${clip.d}')`,
        }}
      >
        {content}
      </div>
    );
  }

  const stroke = strokeOf(node);
  return (
    <>
      {content}
      {stroke && <BooleanStroke node={node} parts={children} stroke={stroke} />}
    </>
  );
}

/**
 * The outline of a boolean result.
 *
 * The fill is drawn by nested clips, which cannot be stroked; a stroke needs
 * the edge as a path. `booleanOutlinePath` computes it through the geometry
 * kernel and caches it, so this is the ordinary stroke renderer with the
 * combination's own outline handed to it — which is why inside, centre and
 * outside all behave here exactly as they do on any other shape.
 */
function BooleanStroke({
  node,
  parts,
  stroke,
}: {
  node: SceneNode;
  parts: SceneNode[];
  stroke: ShapeStroke;
}) {
  const d = booleanOutlinePath(node, parts);
  if (!d) return null;
  return (
    <StrokePath
      id={node.id}
      d={d}
      stroke={stroke}
      fillRule="evenodd"
      width={node.w}
      height={node.h}
    />
  );
}

function strokeOf(node: SceneNode): ShapeStroke | null {
  const border = node.border;
  if (!border || border.visible === false || border.width <= 0) return null;
  return {
    color: withAlpha(border.color, border.opacity ?? 1),
    width: border.width,
    dash: border.dash ? `${border.dash} ${border.gap ?? border.dash}` : null,
    cap: border.cap ?? 'butt',
    join: border.join ?? 'miter',
    // Figma states the limit as the angle a mitre gives up at; SVG wants the
    // ratio it corresponds to
    miterLimit: 1 / Math.sin((((border.miterAngle ?? 28.96) * Math.PI) / 180) / 2),
    align: border.position ?? 'center',
  };
}
