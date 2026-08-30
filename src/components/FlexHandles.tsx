'use client';

import { useState, type RefObject } from 'react';
import { useDoc, useReadOnly, useStore } from './Session';
import { useRects, type Rect } from './Overlay';
import { useUI } from '../state/ui';
import { isInFlow, type FlexSpec } from '../document/types';

/**
 * Gap and padding, dragged on the canvas.
 *
 * These are numbers in the Inspector too, and typing 24 into a field is exact.
 * But spacing is not a number you know in advance — it is a number you arrive
 * at by looking, and a round trip from the artboard to a panel and back breaks
 * the loop that gets you there. So the gutters between the children and the
 * bands inside the edges are draggable, which is the gesture Figma and paper
 * both put at the centre of auto layout.
 *
 * Nothing here computes layout. The children are real DOM, so the browser has
 * already decided where the gutters are; this measures them and turns a pointer
 * delta into `flex.gap` or `flex.padding`, through the same `store.update` the
 * panel calls — so undo, multiplayer and the CRDT all come along unchanged.
 */

/** Which number a band or a gutter edits. */
type Target = { kind: 'gap' } | { kind: 'padding'; side: 0 | 1 | 2 | 3 };

const SIDE_AXIS = ['y', 'x', 'y', 'x'] as const;
/** Dragging the right or bottom band inward *increases* the padding. */
const SIDE_SIGN = [1, -1, -1, 1] as const;

export function FlexHandles({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const readOnly = useReadOnly();
  const selection = useUI((s) => s.selection);
  const viewport = useUI((s) => s.viewport);
  const editing = useUI((s) => s.editing);
  const vectorEdit = useUI((s) => s.vectorEdit);
  // an armed tool owns the pointer, gap and padding grips included (C-27)
  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  const armed = spacePan || (tool !== 'move' && tool !== 'scale');
  const [dragging, setDragging] = useState<{ target: Target; value: number } | null>(null);
  const [hovered, setHovered] = useState<0 | 1 | 2 | 3 | null>(null);

  const id = selection.length === 1 ? selection[0] : null;
  const node = id ? doc[id] : undefined;
  // grid has two gaps and a track model of its own; this is the flex case
  const flex = node?.flex && node.flex.mode !== 'grid' ? node.flex : null;
  const flowed =
    flex && node
      ? node.children.filter((child) => doc[child]?.visible && isInFlow(doc[child], doc))
      : [];

  // measured together, so one layout pass covers the frame and its children
  const rects = useRects(id && flex ? [id, ...flowed] : [], containerRef);

  if (!id || !node || !flex || readOnly || editing || vectorEdit || armed) return null;
  const box = rects[id];
  if (!box) return null;

  const zoom = viewport.zoom;
  const row = flex.direction === 'row';

  const commit = (target: Target, delta: number, start: FlexSpec, symmetric: boolean) => {
    const step = Math.round(delta / zoom);
    if (target.kind === 'gap') {
      // negative gap is a real design — overlapping avatars, stacked cards
      const gap = Math.max(-999, start.gap + step);
      store.update(id, { flex: { ...start, gap } });
      return gap;
    }

    const { side } = target;
    const value = Math.max(0, start.padding[side] + step * SIDE_SIGN[side]);
    const padding = [...start.padding] as FlexSpec['padding'];
    padding[side] = value;
    // ⌥ is Figma's "both sides at once", and the pair is the opposite edge
    if (symmetric) padding[(side + 2) % 4] = value;
    store.update(id, { flex: { ...start, padding } });
    return value;
  };

  const startDrag = (event: React.PointerEvent, target: Target) => {
    event.preventDefault();
    event.stopPropagation();
    const start = { ...flex, padding: [...flex.padding] as FlexSpec['padding'] };
    const axis = target.kind === 'gap' ? (row ? 'x' : 'y') : SIDE_AXIS[target.side];
    const from = axis === 'x' ? event.clientX : event.clientY;

    const move = (e: PointerEvent) => {
      const delta = (axis === 'x' ? e.clientX : e.clientY) - from;
      setDragging({ target, value: commit(target, delta, start, e.altKey) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      store.commit(); // one gesture, one undo step
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** The gutters between consecutive children, in the overlay's space. */
  const gutters: Rect[] = [];
  for (let index = 0; index < flowed.length - 1; index += 1) {
    const before = rects[flowed[index]];
    const after = rects[flowed[index + 1]];
    if (!before || !after) continue;
    if (row) {
      const left = before.x + before.w;
      // a negative gap overlaps the children, so the gutter is drawn where the
      // divider *is* rather than as a strip that has no width
      gutters.push({ x: left, y: before.y, w: Math.max(after.x - left, 0), h: before.h });
    } else {
      const top = before.y + before.h;
      gutters.push({ x: before.x, y: top, w: before.w, h: Math.max(after.y - top, 0) });
    }
  }

  /**
   * The padding of each side, as two rectangles.
   *
   * `region` is the whole padded strip — what the number *means*, painted only
   * while you are on it. `grip` is the line where the content starts, which is
   * the thing you actually take hold of. They are separate because a grip the
   * full thickness of the padding would swallow the frame: a card with 40px of
   * padding would have a 40px ring you could no longer drag the card by.
   */
  const bands = ([0, 1, 2, 3] as const).map((side) => {
    const thickness = flex.padding[side] * zoom;
    const region: Rect =
      side === 0
        ? { x: box.x, y: box.y, w: box.w, h: thickness }
        : side === 1
          ? { x: box.x + box.w - thickness, y: box.y, w: thickness, h: box.h }
          : side === 2
            ? { x: box.x, y: box.y + box.h - thickness, w: box.w, h: thickness }
            : { x: box.x, y: box.y, w: thickness, h: box.h };
    const grip: Rect =
      side === 0
        ? { x: box.x, y: region.y + region.h, w: box.w, h: 0 }
        : side === 1
          ? { x: region.x, y: box.y, w: 0, h: box.h }
          : side === 2
            ? { x: box.x, y: region.y, w: box.w, h: 0 }
            : { x: region.x + region.w, y: box.y, w: 0, h: box.h };
    return { side, region, grip };
  });

  /**
   * A zero-width band is unhittable, so the grab area has a minimum.
   *
   * It is the grab area that gets painted on hover rather than the true
   * gutter — a 7px highlight over a 2px gap slightly overstates it, which is
   * the right way round: you can see what you are about to take hold of.
   */
  const grab = (rect: Rect, vertical: boolean): React.CSSProperties => {
    const min = 7;
    const w = vertical ? Math.max(rect.w, min) : rect.w;
    const h = vertical ? rect.h : Math.max(rect.h, min);
    return {
      left: rect.x - (w - rect.w) / 2,
      top: rect.y - (h - rect.h) / 2,
      width: w,
      height: h,
    };
  };

  const badge = (rect: Rect, value: number) => (
    <span
      className="fig-flex-badge"
      style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h / 2 }}
    >
      {value}
    </span>
  );

  return (
    <>
      {gutters.map((rect, index) => (
        <div
          key={`gap-${index}`}
          className="fig-flex-gap"
          data-on={dragging?.target.kind === 'gap' || undefined}
          style={{ ...grab(rect, row), cursor: row ? 'ew-resize' : 'ns-resize' }}
          onPointerDown={(event) => startDrag(event, { kind: 'gap' })}
          title="Drag to change the gap"
        />
      ))}

      {bands.map(({ side, region, grip }) => {
        const live =
          hovered === side ||
          (dragging?.target.kind === 'padding' && dragging.target.side === side);
        return (
          <div key={`pad-${side}`}>
            {live && (
              <span
                className="fig-flex-region"
                style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
              />
            )}
            <div
              className="fig-flex-pad"
              data-on={live || undefined}
              style={{
                ...grab(grip, side === 1 || side === 3),
                cursor: side === 1 || side === 3 ? 'ew-resize' : 'ns-resize',
              }}
              onPointerEnter={() => setHovered(side)}
              onPointerLeave={() => setHovered(null)}
              onPointerDown={(event) => startDrag(event, { kind: 'padding', side })}
              title="Drag to change the padding · ⌥ for both sides"
            />
          </div>
        );
      })}

      {dragging &&
        (dragging.target.kind === 'gap'
          ? gutters[0] && badge(gutters[0], dragging.value)
          : badge(bands[dragging.target.side].region, dragging.value))}
    </>
  );
}
