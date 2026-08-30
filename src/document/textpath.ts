import { outlinePath } from './geometry';
import { isPlain, plainText, runsOf } from './text';
import type { Doc, SceneNode, TextRun } from './types';

/**
 * Text on a path.
 *
 * SVG already knows how to run type along a curve, and the browser's own layout
 * engine is what does it — the same bargain the rest of this canvas makes, and
 * the reason this can exist here at all. The alternative, placing glyphs one at
 * a time, would be a second text renderer, and the invariant that the canvas
 * and the export cannot drift only holds while there is one.
 *
 * This module builds the *description* of that SVG. `NodeView` turns it into
 * React and `toCode` turns it into markup, so the two cannot disagree about
 * where a letter sits.
 */

export interface PathTextSpec {
  /** the outline the glyphs run along, in the text layer's own coordinates */
  d: string;
  /** the box the SVG draws into */
  width: number;
  height: number;
  /** how far along the path the text starts */
  startOffset: string;
  /** which side of the line the glyphs sit on */
  side: 'left' | 'right';
  /** the runs, so styled text keeps its styling along the curve */
  runs: TextRun[];
  plain: boolean;
  /** `text-anchor`, from the layer's own alignment */
  anchor: 'start' | 'middle' | 'end';
}

/**
 * What to draw for a text layer that follows a path, or null when it does not.
 *
 * A path holds one line, so newlines collapse to spaces: there is nowhere for a
 * second line to go, and dropping everything after the first break would lose
 * it silently.
 */
export function pathTextSpec(node: SceneNode, doc: Doc): PathTextSpec | null {
  const on = node.textPath;
  const source = on ? doc[on.source] : null;
  if (!on || !source) return null;

  const runs = runsOf(node).map((run) => ({ ...run, text: run.text.replace(/\n/g, ' ') }));
  if (!plainText(runs)) return null;

  return {
    d: outlinePath(source),
    width: Math.max(node.w, 1),
    height: Math.max(node.h, 1),
    startOffset: `${Math.max(0, Math.min(100, on.offset))}%`,
    // `side` is SVG's own word for it, and its two values are the two sides
    side: on.side === 'bottom' ? 'right' : 'left',
    runs,
    plain: isPlain(runs),
    anchor:
      node.font?.align === 'center' ? 'middle' : node.font?.align === 'right' ? 'end' : 'start',
  };
}
