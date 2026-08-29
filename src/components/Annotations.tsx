'use client';

import { type RefObject } from 'react';
import { useRects } from './Overlay';
import { useDoc } from './Session';
import { useUI } from '../state/ui';

/**
 * Handoff notes, on the canvas.
 *
 * A note that only exists in a panel is a note nobody reads: you have to select
 * the layer to find out it has one. Figma draws a marker beside every annotated
 * layer so the design itself says where the guidance is, and the view menu turns
 * them off when you want to look at the design instead.
 */
export function Annotations({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const shown = useUI((state) => state.view.annotations);
  const select = useUI((state) => state.select);
  const setTab = useUI((state) => state.setInspectorTab);

  const annotated = Object.values(doc).filter((node) => node.annotations?.length);
  const rects = useRects(
    shown ? annotated.map((node) => node.id) : [],
    containerRef,
  );

  if (!shown || !annotated.length) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 18 }}>
      {annotated.map((node) => {
        const rect = rects[node.id];
        if (!rect) return null;
        const first = node.annotations![0];
        return (
          <button
            key={node.id}
            type="button"
            className="fig-annotation-pin"
            title={first.label ? `${first.label}: ${first.note}` : first.note}
            style={{ left: rect.x + rect.w + 6, top: rect.y - 2 }}
            onClick={() => {
              select([node.id]);
              setTab('inspect');
            }}
          >
            {node.annotations!.length}
          </button>
        );
      })}
    </div>
  );
}
