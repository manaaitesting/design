/**
 * Masks.
 *
 * A mask layer shapes the siblings that paint on top of it, and the run ends at
 * the next mask or at the end of the frame — the same rule Figma's masks follow,
 * read off the layer order rather than a separate grouping.
 *
 * The mask itself is CSS. A geometric mask becomes `clip-path` on each layer it
 * covers, and an image mask becomes `mask-image`; both survive export, which is
 * the point of doing it this way rather than compositing on a hidden canvas.
 */

import type { CSSProperties } from 'react';
import { isPlaced, placedPath, translatePath } from './geometry';
import { isInFlow, type Doc, type SceneNode } from './types';

/** The mask layer's own paint is the shape, not something to look at. */
const MASK_LAYER: CSSProperties = { opacity: 0 };

export interface MaskAssignment {
  /** extra style for each child, keyed by id */
  styles: Record<string, CSSProperties>;
  /** ids of the children acting as masks */
  masks: string[];
}

/**
 * Works out what each child of `parent` is masked by.
 *
 * A flowed child is skipped: its position belongs to the auto layout and is not
 * known until the browser has laid it out, so there is no offset to write into
 * a `clip-path` here. Figma has the same restriction in practice — masks live in
 * groups and plain frames, not inside auto layout.
 */
export function maskStyles(parent: SceneNode, doc: Doc): MaskAssignment {
  const children = parent.children.map((id) => doc[id]).filter(Boolean) as SceneNode[];
  const masks = children.filter((child) => child.isMask).map((child) => child.id);
  if (!masks.length) return { styles: {}, masks: [] };

  const styles: Record<string, CSSProperties> = {};
  let active: SceneNode | null = null;

  for (const child of children) {
    if (child.isMask) {
      active = child;
      styles[child.id] = MASK_LAYER;
      continue;
    }
    if (!active) continue;
    if (isInFlow(child, doc)) continue;
    const style = maskFor(active, child);
    if (style) styles[child.id] = style;
  }

  return { styles, masks };
}

/** The style that makes `child` show only where `mask` covers it. */
function maskFor(mask: SceneNode, child: SceneNode): CSSProperties | null {
  const dx = mask.x - child.x;
  const dy = mask.y - child.y;

  // An image used as a luminance mask carries its own greyscale, so the mask
  // is the picture rather than its outline.
  if (mask.maskType === 'luminance' && mask.type === 'image' && mask.src) {
    return {
      maskImage: `url(${mask.src})`,
      maskPosition: `${dx}px ${dy}px`,
      maskSize: `${mask.w}px ${mask.h}px`,
      maskRepeat: 'no-repeat',
      WebkitMaskImage: `url(${mask.src})`,
      WebkitMaskPosition: `${dx}px ${dy}px`,
      WebkitMaskSize: `${mask.w}px ${mask.h}px`,
      WebkitMaskRepeat: 'no-repeat',
    };
  }

  // the mask's outline in the masked layer's own coordinates — turned properly
  // when the mask itself sits at an angle
  const d = translatePath(placedPath(mask), -mask.x + dx, -mask.y + dy);
  if (!d) return null;
  const rule = isPlaced(mask) ? 'evenodd, ' : '';
  return { clipPath: `path(${rule}'${d}')` };
}

/** True when this node is masking something — the layers panel marks it. */
export function isMaskLayer(node: SceneNode): boolean {
  return !!node.isMask;
}
