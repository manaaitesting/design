'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import { useDoc, usePresence, useStore } from './Session';
import { FlexHandles } from './FlexHandles';
import { toScreen, useUI } from '../state/ui';
import { isInFlow, type Doc, type SceneNode } from '../document/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { id: HandleId; cx: number; cy: number; cursor: string }[] = [
  { id: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { id: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { id: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { id: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { id: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' },
  { id: 's', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { id: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { id: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

/** The dimension pill shown under a box — shared with the draw preview. */
export const SIZE_BADGE: React.CSSProperties = {
  position: 'absolute',
  transform: 'translateX(-50%)',
  fontSize: 10,
  fontWeight: 500,
  color: '#fff',
  background: 'var(--color-select-line)',
  borderRadius: 3,
  padding: '1px 5px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

/**
 * Measures rendered nodes rather than recomputing layout.
 *
 * Because the canvas is real DOM, the browser has already resolved flex sizing
 * by the time this runs — so selection chrome is correct for flowed children
 * without the editor duplicating the layout algorithm.
 */
export function useRects(ids: string[], containerRef: RefObject<HTMLDivElement | null>): Record<string, Rect> {
  const doc = useDoc();
  const viewport = useUI((s) => s.viewport);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const key = ids.join(',');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }
    setRects(next);
    // `key` stands in for `ids`; doc and viewport re-measure on any change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc, viewport, containerRef]);

  return rects;
}

export function Overlay({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const page = useUI((s) => s.page);
  const labels = useUI((s) => s.view.labels);
  const hover = useUI((s) => s.hover);
  const viewport = useUI((s) => s.viewport);
  const editing = useUI((s) => s.editing);
  const entered = useUI((s) => s.entered);
  const lockedHint = useUI((s) => s.lockedHint);
  const guides = useUI((s) => s.guides);
  // point editing replaces the selection chrome with the anchors themselves,
  // exactly as Figma's does — two sets of handles would fight for the pointer
  const vectorEdit = useUI((s) => s.vectorEdit);
  const pageId = useUI((s) => s.page);
  const select = useUI((s) => s.select);
  const presence = usePresence();

  const remoteIds = presence.flatMap((p) => p.selection);
  // Figma keeps a section's name on the canvas at all times — it is how you
  // tell one board from another without selecting anything
  const sections = (doc[pageId]?.children ?? []).filter((id) => doc[id]?.type === 'section');
  // a slice is invisible by design, so its outline has to be permanent chrome
  const slices = Object.values(doc)
    .filter((node) => node.type === 'slice' && node.visible)
    .map((node) => node.id);
  const tracked = [...new Set([
    ...selection,
    ...(hover ? [hover] : []),
    ...(entered ? [entered] : []),
    ...(lockedHint ? [lockedHint] : []),
    ...remoteIds,
    ...sections,
    ...slices,
    // "Additional labels" writes a size under every frame, so every frame has
    // to be measured — not only the ones the pointer is on
    ...(labels ? (doc[page]?.children ?? []) : []),
  ])];
  const rects = useRects(tracked, containerRef);

  /** Screen-space union of the selected nodes. */
  const bounds = (() => {
    const boxes = selection.map((id) => rects[id]).filter(Boolean) as Rect[];
    if (boxes.length < 2) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
      h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
    };
  })();

  /**
   * Dragging a handle on a multi-selection scales every node about the box's
   * opposite corner, which is what Figma does — each layer keeps its relative
   * position and proportion inside the group.
   */
  const startGroupResize = (event: React.PointerEvent, handle: HandleId) => {
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();

    const zoom = viewport.zoom;
    const originWorld = {
      x: bounds.x / zoom,
      y: bounds.y / zoom,
      w: bounds.w / zoom,
      h: bounds.h / zoom,
    };
    const start = selection.map((id) => ({ id, node: doc[id] })).filter((entry) => entry.node);

    const move = (e: PointerEvent) => {
      const dx = (e.clientX - event.clientX) / zoom;
      const dy = (e.clientY - event.clientY) / zoom;
      const scaleX = handle.includes('e')
        ? (originWorld.w + dx) / originWorld.w
        : handle.includes('w')
          ? (originWorld.w - dx) / originWorld.w
          : 1;
      const scaleY = handle.includes('s')
        ? (originWorld.h + dy) / originWorld.h
        : handle.includes('n')
          ? (originWorld.h - dy) / originWorld.h
          : 1;
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;

      const anchorX = handle.includes('w') ? originWorld.x + originWorld.w : originWorld.x;
      const anchorY = handle.includes('n') ? originWorld.y + originWorld.h : originWorld.y;

      store.updateMany(
        start.map((entry) => entry.id),
        (n) => {
          const source = start.find((entry) => entry.id === n.id)!.node;
          return {
            x: Math.round(anchorX + (source.x - anchorX) * Math.max(scaleX, 0.01)),
            y: Math.round(anchorY + (source.y - anchorY) * Math.max(scaleY, 0.01)),
            w: Math.max(1, Math.round(source.w * Math.max(scaleX, 0.01))),
            h: Math.max(1, Math.round(source.h * Math.max(scaleY, 0.01))),
            wMode: 'fixed' as const,
            hMode: 'fixed' as const,
          };
        },
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.commit(); // one gesture, one undo step
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (event: React.PointerEvent, handle: HandleId, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const node = doc[id];
    if (!node) return;
    const origin = { x: node.x, y: node.y, w: node.w, h: node.h };
    const rect = rects[id];
    const startW = rect?.w ? rect.w / viewport.zoom : node.w;
    const startH = rect?.h ? rect.h / viewport.zoom : node.h;

    const ratio = startH ? startW / startH : 1;

    const move = (e: PointerEvent) => {
      const dx = (e.clientX - event.clientX) / viewport.zoom;
      const dy = (e.clientY - event.clientY) / viewport.zoom;
      // which way each axis grows: away from the far edge, or back from the near
      // one. A middle handle contributes nothing on its cross axis.
      const ex = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
      const ey = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
      // ⌥ resizes about the centre, which means each edge takes the whole delta
      // and the opposite edge takes it too
      const reach = e.altKey ? 2 : 1;

      let w = ex ? startW + ex * dx * reach : startW;
      let h = ey ? startH + ey * dy * reach : startH;

      // ⇧ keeps the proportion — on an edge handle as well as a corner, which is
      // where this used to give up
      if (e.shiftKey || node.aspectLocked) {
        if (ex && ey) {
          // a corner follows whichever axis was pulled harder, so the box does
          // not lurch when the drag is mostly along one of them
          if (Math.abs(w / startW - 1) >= Math.abs(h / startH - 1)) h = w / ratio;
          else w = h * ratio;
        } else if (ex) h = w / ratio;
        else if (ey) w = h * ratio;
      }
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));

      // The point the box grows away from, decided *after* the size is final —
      // computing it first is what made a ⇧-drag on a north or west handle slide
      // the box while it scaled.
      const x = e.altKey
        ? Math.round(origin.x + (startW - w) / 2)
        : ex < 0
          ? Math.round(origin.x + (startW - w))
          : origin.x;
      const y = e.altKey
        ? Math.round(origin.y + (startH - h) / 2)
        : ey < 0
          ? Math.round(origin.y + (startH - h))
          : origin.y;

      const patch: Partial<SceneNode> = { w, h, wMode: 'fixed', hMode: 'fixed' };
      // only write a coordinate that actually moved: a no-op write still pins
      // the field as an override on a layer inside an instance
      const live = store.getSnapshot()[id];
      if (live && live.x !== x) patch.x = x;
      if (live && live.y !== y) patch.y = y;
      store.update(id, patch);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.commit(); // one gesture, one undo step
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {/* someone else's selection */}
      {presence.map((p) =>
        p.selection.map((id) => {
          const rect = rects[id];
          if (!rect || selection.includes(id)) return null;
          return (
            <div
              key={`${p.clientId}-${id}`}
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                outline: `1.5px solid ${p.identity.color}`,
                outlineOffset: -0.75,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: -17,
                  fontSize: 10,
                  fontWeight: 500,
                  color: '#fff',
                  background: p.identity.color,
                  borderRadius: 3,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.identity.name}
              </span>
            </div>
          );
        }),
      )}

      {/* alignment guides, in Figma's red, drawn in screen space */}
      {guides.map((guide, index) => {
        const start = toScreen(viewport, guide.axis === 'x' ? guide.at : guide.from, guide.axis === 'x' ? guide.from : guide.at);
        const end = toScreen(viewport, guide.axis === 'x' ? guide.at : guide.to, guide.axis === 'x' ? guide.to : guide.at);
        return (
          <div
            key={`${guide.axis}-${guide.at}-${index}`}
            style={{
              position: 'absolute',
              left: Math.min(start.x, end.x),
              top: Math.min(start.y, end.y),
              width: guide.axis === 'x' ? 1 : Math.abs(end.x - start.x),
              height: guide.axis === 'x' ? Math.abs(end.y - start.y) : 1,
              background: '#FF3B30',
            }}
          />
        );
      })}

      {/* clicked, but locked — explain rather than ignore */}
      {lockedHint && rects[lockedHint] && (
        <div
          style={{
            position: 'absolute',
            left: rects[lockedHint].x,
            top: rects[lockedHint].y,
            width: rects[lockedHint].w,
            height: rects[lockedHint].h,
            outline: '1.5px dashed #F5A623',
            outlineOffset: -0.75,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: -18,
              fontSize: 10,
              fontWeight: 500,
              color: '#fff',
              background: '#F5A623',
              borderRadius: 3,
              padding: '1px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {doc[lockedHint]?.name} is locked — unlock it in the layers panel
          </span>
        </div>
      )}

      {/* the container you are inside */}
      {entered && rects[entered] && !selection.includes(entered) && (
        <div
          style={{
            position: 'absolute',
            left: rects[entered].x - 1,
            top: rects[entered].y - 1,
            width: rects[entered].w + 2,
            height: rects[entered].h + 2,
            border: '1px dashed rgba(59,130,246,0.55)',
            borderRadius: 2,
          }}
        />
      )}

      {/* hover hint */}
      {hover && !selection.includes(hover) && rects[hover] && (
        <div
          style={{
            position: 'absolute',
            left: rects[hover].x,
            top: rects[hover].y,
            width: rects[hover].w,
            height: rects[hover].h,
            outline: '1px solid var(--color-select-line)',
            outlineOffset: -0.5,
          }}
        />
      )}

      {/* multi-selection bounding box */}
      {bounds && (
        <>
          <div
            style={{
              position: 'absolute',
              left: bounds.x,
              top: bounds.y,
              width: bounds.w,
              height: bounds.h,
              outline: '1.75px solid var(--color-select-line)',
              outlineOffset: -0.875,
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: bounds.x + bounds.w / 2,
              top: bounds.y + bounds.h + 6,
              transform: 'translateX(-50%)',
              fontSize: 10,
              fontWeight: 500,
              color: '#fff',
              background: 'var(--color-select-line)',
              borderRadius: 3,
              padding: '1px 5px',
              whiteSpace: 'nowrap',
            }}
          >
            {selection.length} selected · {Math.round(bounds.w / viewport.zoom)} ×{' '}
            {Math.round(bounds.h / viewport.zoom)}
          </span>
          {HANDLES.map((handle) => (
            <div
              key={handle.id}
              onPointerDown={(e) => startGroupResize(e, handle.id)}
              style={{
                position: 'absolute',
                left: bounds.x + bounds.w * handle.cx - 3.5,
                top: bounds.y + bounds.h * handle.cy - 3.5,
                width: 7,
                height: 7,
                background: '#fff',
                border: '1px solid var(--color-select-line)',
                borderRadius: 1,
                cursor: handle.cursor,
                pointerEvents: 'auto',
              }}
            />
          ))}
        </>
      )}

      {/* Auto layout, edited where it is: the gutters between the children and
          the bands inside the edges. Drawn under the resize handles below, so a
          corner handle still wins the pointer where the two meet. */}
      {!vectorEdit && <FlexHandles containerRef={containerRef} />}

      {/* slices: an export region, drawn as chrome because it paints nothing */}
      {slices.map((id) => {
        const rect = rects[id];
        if (!rect) return null;
        return (
          <div key={`slice-${id}`} style={{ position: 'absolute', left: rect.x, top: rect.y }}>
            <div
              style={{
                width: rect.w,
                height: rect.h,
                border: '1px dashed rgba(245,166,35,0.9)',
                background: 'rgba(245,166,35,0.05)',
              }}
            />
            <span className="fig-slice-label">{doc[id]?.name}</span>
          </div>
        );
      })}

      {/* a layer someone has marked ready to build, flagged the way Figma
          flags it — visible without having to select anything */}
      {tracked.map((id) => {
        const rect = rects[id];
        const node = doc[id];
        const status = node?.devStatus;
        if (!rect || !node || !status || status === 'none') return null;
        return (
          <span
            key={`status-${id}`}
            className="fig-status"
            data-status={status}
            style={{ left: rect.x + rect.w - 52, top: rect.y - 18 }}
          >
            {status === 'ready' ? 'Ready for dev' : 'Built'}
          </span>
        );
      })}

      {/* section names — always on, and clicking one selects the board */}
      {sections.map((id) => {
        const rect = rects[id];
        const node = doc[id];
        if (!rect || !node || !node.visible) return null;
        // the selection draws its own name in the same place — two labels on
        // top of each other read as a rendering fault
        if (selection.includes(id)) return null;
        return (
          <button
            key={`section-${id}`}
            type="button"
            className="section-label"
            data-on={selection.includes(id) || undefined}
            style={{ left: rect.x, top: rect.y - 20 }}
            onPointerDown={(event) => {
              event.stopPropagation();
              select([id]);
            }}
          >
            {node.name}
          </button>
        );
      })}

      {/* Figma's "Additional labels": every frame's size, not only the one you
          are holding — the fastest way to see that a set of boards disagree */}
      {labels &&
        (doc[page]?.children ?? []).map((id) => {
          const rect = rects[id];
          const node = doc[id];
          if (!rect || !node || !node.visible || selection.includes(id)) return null;
          return (
            <span key={`size-${id}`} className="fig-size-label" style={{ left: rect.x, top: rect.y + rect.h + 4 }}>
              {Math.round(rect.w / viewport.zoom)} × {Math.round(rect.h / viewport.zoom)}
            </span>
          );
        })}

      {/* selection */}
      {selection.map((id) => {
        const rect = rects[id];
        const node = doc[id];
        if (!rect || !node || id === vectorEdit) return null;
        const single = selection.length === 1;
        const flowed = isInFlow(node, doc);

        return (
          <div key={id}>
            <div
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                outline: '1.75px solid var(--color-select-line)',
                outlineOffset: -0.875,
              }}
            />

            {single && (
              <span
                style={{
                  position: 'absolute',
                  left: rect.x,
                  top: rect.y - 16,
                  fontSize: 10,
                  color: 'var(--color-select-line)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {node.name}
                {flowed && <span style={{ opacity: 0.65 }}> · in flex</span>}
                {node.locked && <span style={{ opacity: 0.65 }}> · locked</span>}
              </span>
            )}

            {single && editing !== id && (
              <span
                style={{
                  position: 'absolute',
                  left: rect.x + rect.w / 2,
                  top: rect.y + rect.h + 6,
                  transform: 'translateX(-50%)',
                  fontSize: 10,
                  fontWeight: 500,
                  color: '#fff',
                  background: 'var(--color-select-line)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(rect.w / viewport.zoom)} × {Math.round(rect.h / viewport.zoom)}
              </span>
            )}

            {single &&
              editing !== id &&
              HANDLES.map((handle) => (
                <div
                  key={handle.id}
                  onPointerDown={(e) => startResize(e, handle.id, id)}
                  style={{
                    position: 'absolute',
                    left: rect.x + rect.w * handle.cx - 3.5,
                    top: rect.y + rect.h * handle.cy - 3.5,
                    width: 7,
                    height: 7,
                    background: '#fff',
                    border: '1px solid var(--color-select-line)',
                    borderRadius: 1,
                    cursor: handle.cursor,
                    pointerEvents: 'auto',
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
