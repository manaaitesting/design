'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useDoc, useStore } from './Session';
import { toScreen, toWorld, useUI } from '../state/ui';

/**
 * Rulers and the guides you drag off them.
 *
 * The guides live on the page in the CRDT rather than in local state: they are
 * part of how a board is set up, so they sync to everyone in the file and come
 * back after a reload — the same treatment Figma gives them.
 *
 * Ticks are chosen from a 1-2-5 ladder against the current zoom, so the spacing
 * on screen stays in a readable band from 2% to 6400%.
 */

const SIZE = 20;
const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/** The smallest round step that leaves at least 64px between labels. */
function tickStep(zoom: number): number {
  for (const step of LADDER) if (step * zoom >= 64) return step;
  return LADDER[LADDER.length - 1];
}

export function Rulers({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const viewport = useUI((s) => s.viewport);
  const pageId = useUI((s) => s.page);
  const selection = useUI((s) => s.selection);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState<{ axis: 'x' | 'y'; at: number } | null>(null);

  // the ruler only needs to know how long to draw itself, and that changes with
  // the window and with either panel being dragged
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const box = container.getBoundingClientRect();
      setSize((current) =>
        Math.abs(box.width - current.w) > 1 || Math.abs(box.height - current.h) > 1
          ? { w: box.width, h: box.height }
          : current,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  const page = doc[pageId];
  const guides = page?.rulerGuides ?? [];
  const step = tickStep(viewport.zoom);

  /** Where the selection sits, so the ruler can shade its extent like Figma's. */
  const highlight = (() => {
    const nodes = selection.map((id) => doc[id]).filter(Boolean);
    if (!nodes.length) return null;
    return {
      x0: Math.min(...nodes.map((n) => n.x)),
      x1: Math.max(...nodes.map((n) => n.x + n.w)),
      y0: Math.min(...nodes.map((n) => n.y)),
      y1: Math.max(...nodes.map((n) => n.y + n.h)),
    };
  })();

  const ticks = (axis: 'x' | 'y') => {
    const extent = axis === 'x' ? size.w : size.h;
    if (!extent) return [];
    const origin = axis === 'x' ? viewport.x : viewport.y;
    const first = Math.floor(-origin / viewport.zoom / step) * step;
    const out: { at: number; screen: number }[] = [];
    for (let value = first; value * viewport.zoom + origin < extent; value += step) {
      out.push({ at: value, screen: value * viewport.zoom + origin });
    }
    return out;
  };

  /** Pulls a new guide out of a ruler, and keeps dragging it until released. */
  const pullGuide = (axis: 'x' | 'y', event: React.PointerEvent) => {
    event.preventDefault();
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;
    const world = toWorld(viewport, event.clientX - base.left, event.clientY - base.top);
    const at = Math.round(axis === 'x' ? world.x : world.y);
    setDragging({ axis, at });

    const move = (e: PointerEvent) => {
      const next = toWorld(viewport, e.clientX - base.left, e.clientY - base.top);
      setDragging({ axis, at: Math.round(axis === 'x' ? next.x : next.y) });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      // released back over the ruler: the guide was never wanted
      const insideX = e.clientX - base.left;
      const insideY = e.clientY - base.top;
      if (insideX < SIZE || insideY < SIZE) return;
      const world2 = toWorld(viewport, insideX, insideY);
      store.addRulerGuide(pageId, axis, axis === 'x' ? world2.x : world2.y);
      store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drags an existing guide; dropping it on the ruler removes it. */
  const moveGuide = (index: number, axis: 'x' | 'y', event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const base = containerRef.current?.getBoundingClientRect();
    if (!base) return;

    const move = (e: PointerEvent) => {
      const world = toWorld(viewport, e.clientX - base.left, e.clientY - base.top);
      store.moveRulerGuide(pageId, index, axis === 'x' ? world.x : world.y);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const insideX = e.clientX - base.left;
      const insideY = e.clientY - base.top;
      if (insideX < SIZE || insideY < SIZE) store.removeRulerGuide(pageId, index);
      store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {/* guides: drawn over the canvas, under the selection chrome */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}>
        {guides.map((guide, index) => {
          const point = toScreen(viewport, guide.at, guide.at);
          const vertical = guide.axis === 'x';
          return (
            <div
              key={`${guide.axis}-${index}`}
              onPointerDown={(event) => moveGuide(index, guide.axis, event)}
              title={`${guide.axis.toUpperCase()} ${guide.at} — drag onto the ruler to remove`}
              style={{
                position: 'absolute',
                left: vertical ? point.x - 3 : 0,
                top: vertical ? 0 : point.y - 3,
                width: vertical ? 6 : '100%',
                height: vertical ? '100%' : 6,
                cursor: vertical ? 'ew-resize' : 'ns-resize',
                pointerEvents: 'auto',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: vertical ? 3 : 0,
                  top: vertical ? 0 : 3,
                  width: vertical ? 1 : '100%',
                  height: vertical ? '100%' : 1,
                  background: '#FF3B30',
                  opacity: 0.75,
                }}
              />
            </div>
          );
        })}
        {dragging && (
          <div
            style={{
              position: 'absolute',
              left: dragging.axis === 'x' ? toScreen(viewport, dragging.at, 0).x : 0,
              top: dragging.axis === 'x' ? 0 : toScreen(viewport, 0, dragging.at).y,
              width: dragging.axis === 'x' ? 1 : '100%',
              height: dragging.axis === 'x' ? '100%' : 1,
              background: '#FF3B30',
            }}
          />
        )}
      </div>

      {/* the rulers themselves */}
      <div
        className="fig-ruler fig-ruler-top"
        style={{ height: SIZE, left: SIZE }}
        onPointerDown={(event) => pullGuide('y', event)}
      >
        {highlight && (
          <div
            className="fig-ruler-range"
            style={{
              left: toScreen(viewport, highlight.x0, 0).x - SIZE,
              width: (highlight.x1 - highlight.x0) * viewport.zoom,
            }}
          />
        )}
        {ticks('x').map((tick) => (
          <span key={tick.at} className="fig-ruler-tick" style={{ left: tick.screen - SIZE + 3 }}>
            {tick.at}
          </span>
        ))}
      </div>
      <div
        className="fig-ruler fig-ruler-left"
        style={{ width: SIZE, top: SIZE }}
        onPointerDown={(event) => pullGuide('x', event)}
      >
        {highlight && (
          <div
            className="fig-ruler-range fig-ruler-range-v"
            style={{
              top: toScreen(viewport, 0, highlight.y0).y - SIZE,
              height: (highlight.y1 - highlight.y0) * viewport.zoom,
            }}
          />
        )}
        {ticks('y').map((tick) => (
          <span
            key={tick.at}
            className="fig-ruler-tick fig-ruler-tick-v"
            style={{ top: tick.screen - SIZE + 3 }}
          >
            {tick.at}
          </span>
        ))}
      </div>
      <div className="fig-ruler fig-ruler-corner" style={{ width: SIZE, height: SIZE }} />
    </>
  );
}
