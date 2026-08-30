'use client';

import { type RefObject } from 'react';
import { unionRect, useRects, type Rect } from './Overlay';
import { useDoc } from './Session';
import { useUI } from '../state/ui';

/**
 * Hold ⌥ and point at something: Figma tells you how far it is from what you
 * have selected. It is the fastest ruler in the app, and its absence is felt
 * every time you try to line two things up by eye.
 *
 * Distances are read off the measured rectangles, so a flowed child reports the
 * gap the browser actually laid out rather than a number recomputed from the
 * layout rules.
 */
export function Measure({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const measuring = useUI((s) => s.measuring);
  const selection = useUI((s) => s.selection);
  const hover = useUI((s) => s.hover);
  const zoom = useUI((s) => s.viewport.zoom);

  const active = measuring && selection.length > 0 && !!hover && !selection.includes(hover);
  const rects = useRects(active ? [...selection, hover] : [], containerRef);

  if (!active || !doc[hover]) return null;
  // the ruler is about the selection — the box the chrome draws — rather than
  // about whichever layer happens to be first in it
  const a = unionRect(selection.map((id) => rects[id]).filter(Boolean) as Rect[]);
  const b = rects[hover];
  if (!a || !b) return null;

  const spans = [...axisSpans(a, b, 'x', zoom), ...axisSpans(a, b, 'y', zoom)];

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22 }}>
      {/* the layer being measured against, outlined the way Figma outlines it */}
      <div
        style={{
          position: 'absolute',
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          outline: '1px solid #FF3B30',
          outlineOffset: -0.5,
        }}
      />
      {spans.map((span, index) => (
        <div key={index}>
          <div
            data-measure={span.dashed ? 'extension' : 'span'}
            style={{
              position: 'absolute',
              left: span.x,
              top: span.y,
              width: span.horizontal ? span.length : span.dashed ? 0 : 1,
              height: span.horizontal ? (span.dashed ? 0 : 1) : span.length,
              background: span.dashed ? undefined : '#FF3B30',
              borderTop: span.dashed && span.horizontal ? '1px dashed #FF3B30' : undefined,
              borderLeft: span.dashed && !span.horizontal ? '1px dashed #FF3B30' : undefined,
            }}
          />
          {span.label && (
            <span
              style={{
                position: 'absolute',
                left: span.horizontal ? span.x + span.length / 2 : span.x + 4,
                top: span.horizontal ? span.y - 9 : span.y + span.length / 2 - 8,
                transform: span.horizontal ? 'translateX(-50%)' : undefined,
                fontSize: 10,
                fontWeight: 500,
                color: '#fff',
                background: '#FF3B30',
                borderRadius: 3,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
              }}
            >
              {span.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface Span {
  x: number;
  y: number;
  length: number;
  horizontal: boolean;
  label: string;
  /** an extension: it carries no number, it says which edge the number is about */
  dashed?: boolean;
}

/**
 * The measurements on one axis.
 *
 * Two boxes that miss each other have one number between them — the gap. Two
 * that overlap have two — how far each pair of edges is apart — which is what
 * you are asking when you hold ⌥ over a layer inside a frame.
 *
 * The line runs across the middle of the selection, so when the hovered layer
 * is offset on the other axis the number hangs at a height where that layer is
 * not. Figma runs a dashed line from the layer's near edge out to meet it,
 * which is what makes the reading visibly about those two boxes.
 */
function axisSpans(a: Rect, b: Rect, axis: 'x' | 'y', zoom: number): Span[] {
  const horizontal = axis === 'x';
  const a0 = horizontal ? a.x : a.y;
  const a1 = a0 + (horizontal ? a.w : a.h);
  const b0 = horizontal ? b.x : b.y;
  const b1 = b0 + (horizontal ? b.w : b.h);
  // the line is drawn across the middle of the other axis
  const cross = horizontal ? a.y + a.h / 2 : a.x + a.w / 2;
  // and the hovered layer's extent along that same other axis
  const near = horizontal ? b.y : b.x;
  const far = near + (horizontal ? b.h : b.w);

  const span = (start: number, end: number): Span | null => {
    const length = Math.abs(end - start);
    if (length < 1) return null;
    return {
      x: horizontal ? Math.min(start, end) : cross,
      y: horizontal ? cross : Math.min(start, end),
      length,
      horizontal,
      label: String(Math.round(length / zoom)),
    };
  };

  /** The dashed run from the hovered layer's edge out to the measurement line. */
  const extension = (at: number): Span | null => {
    if (cross >= near && cross <= far) return null;
    const edge = cross < near ? near : far;
    const length = Math.abs(edge - cross);
    if (length < 1) return null;
    return {
      x: horizontal ? at : Math.min(edge, cross),
      y: horizontal ? Math.min(edge, cross) : at,
      length,
      horizontal: !horizontal,
      label: '',
      dashed: true,
    };
  };

  const drawn = (measure: Span | null, at: number): Span[] =>
    measure ? ([measure, extension(at)].filter(Boolean) as Span[]) : [];

  if (a1 <= b0) return drawn(span(a1, b0), b0);
  if (b1 <= a0) return drawn(span(b1, a0), b1);
  return [...drawn(span(a0, b0), b0), ...drawn(span(a1, b1), b1)];
}
