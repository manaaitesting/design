'use client';

import { useState, type RefObject } from 'react';
import { Icon } from './ui/Icons';
import { useRects, type Rect } from './Overlay';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';
import { connectionsOn, flowsOn, nextFlowName } from '../document/prototype';
import type { Doc } from '../document/types';

const BLUE = '#0d99ff';

/**
 * Which sides a noodle should leave from and arrive at. Figma runs the curve
 * out of the nearest vertical edge when the frames sit side by side, and out of
 * the top or bottom when one is stacked above the other.
 */
function anchors(from: Rect, to: Rect) {
  const gapX = to.x - (from.x + from.w);
  const gapXLeft = from.x - (to.x + to.w);
  if (gapX >= -from.w / 2 || gapXLeft >= -from.w / 2) {
    const rightwards = gapX >= gapXLeft;
    return rightwards
      ? { sx: from.x + from.w, sy: from.y + from.h / 2, tx: to.x, ty: to.y + to.h / 2, dir: 1 }
      : { sx: from.x, sy: from.y + from.h / 2, tx: to.x + to.w, ty: to.y + to.h / 2, dir: -1 };
  }
  // overlapping horizontally: leave from the side nearest the destination
  const rightwards = to.x + to.w / 2 >= from.x + from.w / 2;
  return rightwards
    ? { sx: from.x + from.w, sy: from.y + from.h / 2, tx: to.x, ty: to.y + to.h / 2, dir: 1 }
    : { sx: from.x, sy: from.y + from.h / 2, tx: to.x + to.w, ty: to.y + to.h / 2, dir: -1 };
}

/** A horizontal-tangent cubic, which is what makes the curve read as a wire. */
function noodle(sx: number, sy: number, tx: number, ty: number, dir: number): string {
  const reach = Math.max(40, Math.min(160, Math.abs(tx - sx) / 2));
  return `M ${sx} ${sy} C ${sx + reach * dir} ${sy}, ${tx - reach * dir} ${ty}, ${tx} ${ty}`;
}

/**
 * The prototype layer of the canvas: connections between hotspots and the
 * frames they open, a badge over every flow starting point, and the drag handle
 * that draws a new connection.
 *
 * It only exists while the Prototype tab is open, the same as in Figma.
 */
export function Connections({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const pageId = useUI((s) => s.page);
  const selection = useUI((s) => s.selection);
  const present = useUI((s) => s.present);
  const [draw, setDraw] = useState<{ from: string; x: number; y: number; over: string | null } | null>(
    null,
  );

  const links = connectionsOn(doc, pageId);
  const flows = flowsOn(doc, pageId);
  const tracked = [
    ...new Set([
      ...links.flatMap((link) => [link.from, link.to]),
      ...flows.map((flow) => flow.id),
      ...selection,
    ]),
  ];
  const rects = useRects(tracked, containerRef);

  const handleFor = selection.length === 1 ? rects[selection[0]] : undefined;

  /** Drags a new connection out of the handle and onto a frame. */
  const startLink = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const source = selection[0];
    const base = containerRef.current?.getBoundingClientRect();
    if (!source || !base) return;

    const move = (e: PointerEvent) => {
      const over = frameUnder(e.clientX, e.clientY, doc, pageId);
      setDraw({ from: source, x: e.clientX - base.left, y: e.clientY - base.top, over });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraw(null);
      const target = frameUnder(e.clientX, e.clientY, doc, pageId);
      if (target && target !== source) {
        store.addInteraction(source, { action: 'navigate', destination: target });
        store.commit();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 24 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <marker
            id="proto-arrow"
            viewBox="0 0 8 8"
            refX="6.5"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0.8 L7 4 L0 7.2 Z" fill={BLUE} />
          </marker>
        </defs>

        {links.map((link) => {
          const from = rects[link.from];
          const to = rects[link.to];
          if (!from || !to) return null;
          const { sx, sy, tx, ty, dir } = anchors(from, to);
          return (
            <g key={`${link.from}:${link.interaction.id}`}>
              <path
                d={noodle(sx, sy, tx, ty, dir)}
                fill="none"
                stroke={BLUE}
                strokeWidth={1.5}
                markerEnd="url(#proto-arrow)"
              />
              <circle cx={sx} cy={sy} r={3.5} fill="#fff" stroke={BLUE} strokeWidth={1.5} />
            </g>
          );
        })}

        {draw &&
          rects[draw.from] &&
          (() => {
            const from = rects[draw.from];
            const dir = draw.x >= from.x + from.w / 2 ? 1 : -1;
            const sx = dir === 1 ? from.x + from.w : from.x;
            const sy = from.y + from.h / 2;
            return (
              <g>
                <path
                  d={noodle(sx, sy, draw.x, draw.y, dir)}
                  fill="none"
                  stroke={BLUE}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  markerEnd="url(#proto-arrow)"
                />
                <circle cx={sx} cy={sy} r={3.5} fill="#fff" stroke={BLUE} strokeWidth={1.5} />
              </g>
            );
          })()}
      </svg>

      {/* the frame a dragged connection would land on */}
      {draw?.over && rects[draw.over] && (
        <div
          style={{
            position: 'absolute',
            left: rects[draw.over].x,
            top: rects[draw.over].y,
            width: rects[draw.over].w,
            height: rects[draw.over].h,
            outline: `2px solid ${BLUE}`,
            background: 'rgba(13,153,255,0.06)',
          }}
        />
      )}

      {flows.map((flow) => {
        const rect = rects[flow.id];
        if (!rect) return null;
        return (
          <button
            key={flow.id}
            type="button"
            className="fig-flow-badge"
            title={`Play ${flow.name}`}
            style={{ left: rect.x, top: rect.y - 26, pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => present(flow.id)}
          >
            <Icon.Play />
            {flow.name}
          </button>
        );
      })}

      {handleFor && !draw && (
        <button
          type="button"
          className="fig-proto-handle"
          title="Drag onto a frame to connect"
          style={{
            left: handleFor.x + handleFor.w,
            top: handleFor.y + handleFor.h / 2,
            pointerEvents: 'auto',
          }}
          onPointerDown={startLink}
        />
      )}

      {/* Figma offers the starting point on the frame you have selected */}
      {selection.length === 1 &&
        doc[selection[0]]?.type === 'frame' &&
        doc[doc[selection[0]].parent ?? '']?.type === 'page' &&
        !doc[selection[0]].flowStart &&
        rects[selection[0]] && (
          <button
            type="button"
            className="fig-flow-badge"
            data-ghost="true"
            title="Make this a flow starting point"
            style={{
              left: rects[selection[0]].x,
              top: rects[selection[0]].y - 26,
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => store.setFlowStart(selection[0], nextFlowName(doc, pageId))}
          >
            <Icon.Plus />
            Flow
          </button>
        )}
    </div>
  );
}

/** The artboard under the pointer, which is all a connection can land on. */
function frameUnder(clientX: number, clientY: number, doc: Doc, pageId: string): string | null {
  const el = document
    .elementsFromPoint(clientX, clientY)
    .find((node) => (node as HTMLElement).dataset?.nodeId) as HTMLElement | undefined;
  if (!el) return null;
  let current = doc[el.dataset.nodeId!];
  while (current && current.parent && current.parent !== pageId) current = doc[current.parent];
  return current && current.parent === pageId && current.type === 'frame' ? current.id : null;
}
