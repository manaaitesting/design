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

/**
 * Which number a band or a gutter edits.
 *
 * A stack has one gap; a grid has two — the space between its columns and the
 * space between its rows — so a gutter says which of them it is, and which way
 * the pointer has to travel to change it.
 */
type Target =
  | { kind: 'gap'; cross: boolean; axis: 'x' | 'y' }
  | { kind: 'padding'; side: 0 | 1 | 2 | 3 };

/** A space between two children, and the number it belongs to. */
interface Gutter {
  rect: Rect;
  cross: boolean;
  axis: 'x' | 'y';
}

const SIDE_AXIS = ['y', 'x', 'y', 'x'] as const;
/** Dragging the right or bottom band inward *increases* the padding. */
const SIDE_SIGN = [1, -1, -1, 1] as const;

/** The grip bar's hit area — long along the space, thick across it. */
const GRIP_LONG = 20;
const GRIP_THICK = 9;

/**
 * The grip: a short bar in the middle of the space it edits.
 *
 * Figma puts a handle where you can see it rather than making the whole strip
 * live — a 1440px-wide gutter that takes the pointer anywhere along its length
 * is a 1440px dead zone laid over the artwork. The bar is what you aim at, and
 * hovering it is what paints the space it measures; until then the space is
 * bare, because spacing you are not editing is spacing you want to see through.
 */
function gripBox(rect: Rect, vertical: boolean): React.CSSProperties {
  const w = vertical ? GRIP_THICK : GRIP_LONG;
  const h = vertical ? GRIP_LONG : GRIP_THICK;
  return {
    left: rect.x + rect.w / 2 - w / 2,
    top: rect.y + rect.h / 2 - h / 2,
    width: w,
    height: h,
  };
}

/**
 * The strip each side's padding occupies, in the overlay's space.
 *
 * Shared by the selected frame — where the strip is the thing a grip measures —
 * and by the frame merely under the pointer, which gets the strips and nothing
 * else. One function so the two can never disagree about where padding is.
 */
function regionsOf(box: Rect, flex: FlexSpec, zoom: number): Rect[] {
  return ([0, 1, 2, 3] as const).map((side) => {
    const thickness = flex.padding[side] * zoom;
    return side === 0
      ? { x: box.x, y: box.y, w: box.w, h: thickness }
      : side === 1
        ? { x: box.x + box.w - thickness, y: box.y, w: thickness, h: box.h }
        : side === 2
          ? { x: box.x, y: box.y + box.h - thickness, w: box.w, h: thickness }
          : { x: box.x, y: box.y, w: thickness, h: box.h };
  });
}

/**
 * A frame's padding, drawn because the pointer is over it.
 *
 * Figma and paper both answer "what is the spacing here?" on hover: you read a
 * layout by moving across it, not by selecting every frame in turn. Only the
 * bands come — the grips stay with the selection, so passing over a frame can
 * never take a press that belonged to the canvas.
 */
export function PaddingBands({
  id,
  containerRef,
}: {
  id: string;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const doc = useDoc();
  const zoom = useUI((s) => s.viewport.zoom);
  const rects = useRects([id], containerRef);
  const node = doc[id];
  const flex = node?.flex ?? null;
  const box = rects[id];
  if (!flex || !box) return null;
  return (
    <>
      {regionsOf(box, flex, zoom).map((region, side) => (
        <span
          key={`hover-pad-${side}`}
          className="fig-flex-pad"
          data-axis={side === 1 || side === 3 ? 'y' : 'x'}
          data-inert="true"
          style={gripBox(region, side === 1 || side === 3)}
        />
      ))}
    </>
  );
}

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
  const [dragging, setDragging] = useState<{ target: Target; value: number; index?: number } | null>(null);
  const [hovered, setHovered] = useState<0 | 1 | 2 | 3 | null>(null);
  const [gapHovered, setGapHovered] = useState<number | null>(null);

  const id = selection.length === 1 ? selection[0] : null;
  const node = id ? doc[id] : undefined;
  const flex = node?.flex ?? null;
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
  const isGrid = flex.mode === 'grid';
  const row = flex.direction === 'row';

  const commit = (target: Target, delta: number, start: FlexSpec, symmetric: boolean) => {
    const step = Math.round(delta / zoom);
    if (target.kind === 'gap') {
      if (target.cross) {
        const crossGap = Math.max(0, (start.crossGap ?? start.gap) + step);
        store.update(id, { flex: { ...start, crossGap } });
        return crossGap;
      }
      // Negative gap is a real design — overlapping avatars, shingled cards —
      // but only a plain stack can draw one: the overlap is a negative margin
      // on each child after the first, and in a wrapping row or a grid that
      // margin would also pull the first child of every new line.
      const floor = start.mode === 'grid' || start.wrap ? 0 : -999;
      const gap = Math.max(floor, start.gap + step);
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

  const startDrag = (event: React.PointerEvent, target: Target, index?: number) => {
    event.preventDefault();
    event.stopPropagation();
    const start = { ...flex, padding: [...flex.padding] as FlexSpec['padding'] };
    const axis = target.kind === 'gap' ? target.axis : SIDE_AXIS[target.side];
    const from = axis === 'x' ? event.clientX : event.clientY;

    const move = (e: PointerEvent) => {
      const delta = (axis === 'x' ? e.clientX : e.clientY) - from;
      setDragging({ target, value: commit(target, delta, start, e.altKey), index });
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

  /**
   * The gutters between children, in the overlay's space.
   *
   * Nothing here works out where the spaces are: the children are real DOM, so
   * the browser has already placed them and these are read off the measured
   * boxes. That is also what makes a grid tractable — its two families of
   * gutter fall out of where the children actually landed, with no need to
   * reimplement track placement to find them.
   */
  const gutters: Gutter[] = [];
  if (!isGrid) {
    for (let index = 0; index < flowed.length - 1; index += 1) {
      const before = rects[flowed[index]];
      const after = rects[flowed[index + 1]];
      if (!before || !after) continue;
      if (row) {
        // a wrapped row puts the next child at the start of a new line; the
        // space before it is the line spacing rather than the gap, and a grip
        // there would edit the wrong number
        if (after.x < before.x) continue;
        const left = before.x + before.w;
        // a negative gap overlaps the children, so the gutter is drawn where
        // the divider *is* rather than as a strip that has no width
        gutters.push({
          rect: { x: left, y: before.y, w: Math.max(after.x - left, 0), h: before.h },
          cross: false,
          axis: 'x',
        });
      } else {
        if (after.y < before.y) continue;
        const top = before.y + before.h;
        gutters.push({
          rect: { x: before.x, y: top, w: before.w, h: Math.max(after.y - top, 0) },
          cross: false,
          axis: 'y',
        });
      }
    }
  } else {
    // the children gathered back into the visual rows the grid laid them in
    const lines: Rect[][] = [];
    for (const rect of flowed
      .map((child) => rects[child])
      .filter((rect): rect is Rect => !!rect)
      .sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line[0].y - rect.y) < 1) line.push(rect);
      else lines.push([rect]);
    }
    // the spaces between the columns, read off the fullest row so a short last
    // row cannot hide a column
    const fullest = lines.reduce<Rect[]>((best, line) => (line.length > best.length ? line : best), []);
    for (let index = 0; index < fullest.length - 1; index += 1) {
      const left = fullest[index].x + fullest[index].w;
      gutters.push({
        rect: {
          x: left,
          y: fullest[index].y,
          w: Math.max(fullest[index + 1].x - left, 0),
          h: fullest[index].h,
        },
        cross: false,
        axis: 'x',
      });
    }
    // …and the spaces between the rows, read off the first column
    for (let index = 0; index < lines.length - 1; index += 1) {
      const above = lines[index][0];
      const below = lines[index + 1][0];
      const top = above.y + above.h;
      gutters.push({
        rect: { x: above.x, y: top, w: above.w, h: Math.max(below.y - top, 0) },
        cross: true,
        axis: 'y',
      });
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
  const regions = regionsOf(box, flex, zoom);

  /**
   * The number sits just above the grip rather than on it: a chip centred on
   * the bar covers the bar, and the thing you are pointing at is the thing you
   * least want hidden. Clear of the grip, it reads as a tip about it.
   */
  const badge = (rect: Rect, value: number) => (
    <span
      className="fig-flex-badge"
      style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h / 2 - GRIP_THICK / 2 - 4 }}
    >
      {value}
    </span>
  );

  /**
   * The number, over the space it belongs to — while you drag it, and while
   * you are merely on its grip. Reading a gap should not cost a gesture: you
   * point at the space and it tells you what it is, which is the whole reason
   * the grip sits in the middle of it rather than off at an edge.
   */
  const gapValue = (gutter: Gutter | undefined) =>
    gutter?.cross ? (flex.crossGap ?? flex.gap) : flex.gap;
  const readout = dragging
    ? dragging.target.kind === 'gap'
      ? { rect: gutters[dragging.index ?? 0]?.rect, value: dragging.value }
      : { rect: regions[dragging.target.side], value: dragging.value }
    : gapHovered !== null
      ? { rect: gutters[gapHovered]?.rect, value: gapValue(gutters[gapHovered]) }
      : hovered !== null
        ? { rect: regions[hovered], value: flex.padding[hovered] }
        : null;

  return (
    <>
      {gutters.map((gutter, index) => {
        const live =
          gapHovered === index ||
          (dragging?.target.kind === 'gap' && dragging.index === index);
        const vertical = gutter.axis === 'x';
        return (
          <div key={`gap-${index}`}>
            <span
              className="fig-flex-gutter"
              data-live={live || undefined}
              style={{
                left: gutter.rect.x,
                top: gutter.rect.y,
                width: gutter.rect.w,
                height: gutter.rect.h,
              }}
            />
            <div
              className="fig-flex-gap"
              data-axis={vertical ? 'y' : 'x'}
              data-on={live || undefined}
              style={{
                ...gripBox(gutter.rect, vertical),
                cursor: vertical ? 'ew-resize' : 'ns-resize',
              }}
              onPointerEnter={() => setGapHovered(index)}
              onPointerLeave={() => setGapHovered(null)}
              onPointerDown={(event) =>
                startDrag(event, { kind: 'gap', cross: gutter.cross, axis: gutter.axis }, index)
              }
              title={gutter.cross ? 'Drag to change the space between rows' : 'Drag to change the gap'}
            />
          </div>
        );
      })}

      {regions.map((region, index) => {
        const side = index as 0 | 1 | 2 | 3;
        const live =
          hovered === side ||
          (dragging?.target.kind === 'padding' && dragging.target.side === side);
        return (
          <div key={`pad-${side}`}>
            <span
              className="fig-flex-region"
              data-live={live || undefined}
              style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
            />
            <div
              className="fig-flex-pad"
              data-axis={side === 1 || side === 3 ? 'y' : 'x'}
              data-on={live || undefined}
              style={{
                ...gripBox(region, side === 1 || side === 3),
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

      {readout?.rect && badge(readout.rect, readout.value)}
    </>
  );
}
