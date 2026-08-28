'use client';

import { useEffect, type RefObject } from 'react';
import { useRects } from './Overlay';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';
import {
  cloneAnchor,
  isCorner,
  pathFromSubpaths,
  subpathsOf,
  type Anchor,
} from '../document/geometry';
import type { VectorPath } from '../document/types';

/**
 * Point editing.
 *
 * Entering a path is a mode, not a tool: while it is on the pointer belongs to
 * the anchors rather than to the layer, which is the only way to drag a point
 * without also dragging the shape it belongs to. Everything here works in
 * screen space and writes back in the node's own space, so editing behaves the
 * same at any zoom.
 *
 *   drag an anchor    move it — every selected anchor comes along
 *   drag a handle     bend the segments; the opposite handle mirrors
 *   ⌥ drag a handle   break the mirror, so the two sides bend apart
 *   ⌥ click an anchor toggle between a corner and a smooth point
 *   click a segment   insert an anchor there
 *   ⌫                 delete the selected anchors
 *   ⏎ / esc           done
 *
 * A path can have several subpaths — a flattened boolean has a hole in it — so
 * anchors are addressed by one running index across all of them. That keeps the
 * selection a plain list of numbers, which is what the store and the keyboard
 * handlers want.
 */

/** One anchor, and where it lives. */
interface Located {
  anchor: Anchor;
  sub: number;
  index: number;
}

function locate(paths: VectorPath[]): Located[] {
  return paths.flatMap((path, sub) =>
    path.anchors.map((anchor, index) => ({ anchor, sub, index })),
  );
}

export function VectorEdit({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const id = useUI((s) => s.vectorEdit);
  const selected = useUI((s) => s.anchorSelection);
  const setSelected = useUI((s) => s.setAnchorSelection);
  const setVectorEdit = useUI((s) => s.setVectorEdit);
  const viewport = useUI((s) => s.viewport);
  const rects = useRects(id ? [id] : [], containerRef);

  const node = id ? doc[id] : null;
  const paths = node ? subpathsOf(node) : [];
  const points = locate(paths);

  // ── Keys ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;

      const live = store.getSnapshot()[id];
      if (!live) return;
      const current = useUI.getState().anchorSelection;

      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        setVectorEdit(null);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (!current.length) return;
        event.preventDefault();
        event.stopPropagation();
        const kept = subpathsOf(live)
          .map((path, sub) => ({
            closed: path.closed,
            anchors: path.anchors.filter(
              (_, index) => !current.includes(runningIndex(subpathsOf(live), sub, index)),
            ),
          }))
          // a subpath needs two points to be a subpath
          .filter((path) => path.anchors.length > 1);

        if (!kept.length) {
          store.remove([id]);
          setVectorEdit(null);
          useUI.getState().select([]);
          return;
        }
        store.setPaths(id, kept);
        store.commit();
        setSelected([]);
        return;
      }

      if (event.key.startsWith('Arrow')) {
        if (!current.length) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        const livePaths = subpathsOf(live);
        store.setPaths(
          id,
          livePaths.map((path, sub) => ({
            closed: path.closed,
            anchors: path.anchors.map((anchor, index) =>
              current.includes(runningIndex(livePaths, sub, index))
                ? { ...anchor, x: anchor.x + dx, y: anchor.y + dy }
                : anchor,
            ),
          })),
        );
        store.commit();
      }
    };
    // capture, so the editor's own shortcuts do not fire underneath
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id, store, setSelected, setVectorEdit]);

  if (!id || !node || !rects[id]) return null;
  const rect = rects[id];
  const zoom = viewport.zoom;

  /** node space → screen space, relative to the canvas container */
  const toScreenPoint = (x: number, y: number) => ({
    x: rect.x + x * zoom,
    y: rect.y + y * zoom,
  });

  /** Rewrites the geometry from a function of the current subpaths. */
  const edit = (fn: (paths: VectorPath[]) => VectorPath[]) => fn(paths.map(clonePath));

  /** Runs a pointer drag, writing live and committing once at the end. */
  const dragPoints = (
    event: React.PointerEvent,
    apply: (dx: number, dy: number, event: PointerEvent) => VectorPath[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let last: VectorPath[] | null = null;

    const move = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      last = apply(dx, dy, e);
      // no re-fit while the pointer is down: moving the box under a live drag
      // would shift the very coordinates the drag is measured against
      store.update(id, {
        paths: last,
        anchors: last.length === 1 ? last[0].anchors : undefined,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last) store.setPaths(id, last);
      store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const moveAnchor = (at: Located, running: number, event: React.PointerEvent) => {
    const picked = event.shiftKey
      ? selected.includes(running)
        ? selected.filter((i) => i !== running)
        : [...selected, running]
      : selected.includes(running)
        ? selected
        : [running];
    setSelected(picked);

    // ⌥ on an anchor toggles it between a corner and a smooth point
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const next = edit((current) => {
        const path = current[at.sub];
        const anchors = path.anchors;
        const anchor = anchors[at.index];
        const count = anchors.length;
        if (!isCorner(anchor)) {
          anchors[at.index] = { x: anchor.x, y: anchor.y, in: null, out: null };
        } else {
          const prev = anchors[(at.index - 1 + count) % count];
          const after = anchors[(at.index + 1) % count];
          const dx = (after.x - prev.x) / 4;
          const dy = (after.y - prev.y) / 4;
          anchors[at.index] = { ...anchor, in: [-dx, -dy], out: [dx, dy] };
        }
        return current;
      });
      store.setPaths(id, next);
      store.commit();
      return;
    }

    const origin = paths.map(clonePath);
    dragPoints(event, (dx, dy) =>
      origin.map((path, sub) => ({
        closed: path.closed,
        anchors: path.anchors.map((anchor, index) =>
          picked.includes(runningIndex(origin, sub, index))
            ? { ...cloneAnchor(anchor), x: anchor.x + dx, y: anchor.y + dy }
            : cloneAnchor(anchor),
        ),
      })),
    );
  };

  const moveHandle = (at: Located, side: 'in' | 'out', event: React.PointerEvent) => {
    const origin = paths.map(clonePath);
    const base = origin[at.sub].anchors[at.index][side] ?? [0, 0];
    const opposite = side === 'in' ? 'out' : 'in';
    const mirrored = !isCorner(origin[at.sub].anchors[at.index]);

    dragPoints(event, (dx, dy, e) =>
      origin.map((path, sub) => ({
        closed: path.closed,
        anchors: path.anchors.map((anchor, index) => {
          if (sub !== at.sub || index !== at.index) return cloneAnchor(anchor);
          const next: [number, number] = [base[0] + dx, base[1] + dy];
          // ⌥ breaks the mirror so the two sides can bend independently
          const keepOpposite = e.altKey || !mirrored;
          return {
            ...cloneAnchor(anchor),
            [side]: next,
            [opposite]: keepOpposite ? anchor[opposite] : ([-next[0], -next[1]] as [number, number]),
          };
        }),
      })),
    );
  };

  /** Clicking a segment drops a new anchor onto it. */
  const insertAt = (event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const local = {
      x: (event.clientX - base.left - rect.x) / zoom,
      y: (event.clientY - base.top - rect.y) / zoom,
    };

    let bestSub = -1;
    let bestIndex = -1;
    let bestDistance = Infinity;
    paths.forEach((path, sub) => {
      const count = path.anchors.length;
      const last = path.closed ? count : count - 1;
      for (let i = 0; i < last; i++) {
        const distance = pointToSegment(local, path.anchors[i], path.anchors[(i + 1) % count]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSub = sub;
          bestIndex = i;
        }
      }
    });
    if (bestSub < 0 || bestDistance > 8 / zoom) return;

    const next = edit((current) => {
      current[bestSub].anchors.splice(bestIndex + 1, 0, { x: local.x, y: local.y });
      return current;
    });
    store.setPaths(id, next);
    store.commit();
    setSelected([runningIndex(next, bestSub, bestIndex + 1)]);
  };

  const d = pathFromSubpaths(paths, node.smooth ?? 0);
  const boxWidth = Math.max(node.w, 1);
  const boxHeight = Math.max(node.h, 1);

  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 24, pointerEvents: 'none' }}
      data-vector-edit={id}
    >
      {/* the path itself, so the outline reads even on a shape with no stroke */}
      <svg
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: Math.max(rect.w, 1),
          height: Math.max(rect.h, 1),
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        viewBox={`0 0 ${boxWidth} ${boxHeight}`}
        preserveAspectRatio="none"
      >
        <path
          d={d}
          fill="none"
          stroke="var(--color-select-line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* a wide invisible copy of the path: what a click to insert a point hits */}
      <svg
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: Math.max(rect.w, 1),
          height: Math.max(rect.h, 1),
          overflow: 'visible',
          pointerEvents: 'auto',
          cursor: 'copy',
        }}
        viewBox={`0 0 ${boxWidth} ${boxHeight}`}
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          event.stopPropagation();
          insertAt(event);
        }}
      >
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={10}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {points.map((located, running) => {
        const { anchor } = located;
        const point = toScreenPoint(anchor.x, anchor.y);
        const active = selected.includes(running);
        return (
          <div key={running}>
            {(['in', 'out'] as const).map((side) => {
              const handle = anchor[side];
              if (!handle || !active) return null;
              const at = toScreenPoint(anchor.x + handle[0], anchor.y + handle[1]);
              return (
                <div key={side}>
                  <svg
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      overflow: 'visible',
                      pointerEvents: 'none',
                    }}
                  >
                    <line
                      x1={point.x}
                      y1={point.y}
                      x2={at.x}
                      y2={at.y}
                      stroke="var(--color-select-line)"
                      strokeWidth={1}
                    />
                  </svg>
                  <div
                    onPointerDown={(event) => moveHandle(located, side, event)}
                    style={{
                      position: 'absolute',
                      left: at.x - 4,
                      top: at.y - 4,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#fff',
                      border: '1px solid var(--color-select-line)',
                      pointerEvents: 'auto',
                      cursor: 'grab',
                    }}
                  />
                </div>
              );
            })}
            <div
              onPointerDown={(event) => moveAnchor(located, running, event)}
              title={
                isCorner(anchor)
                  ? 'Corner point — ⌥ click to smooth'
                  : 'Smooth point — ⌥ click to corner'
              }
              style={{
                position: 'absolute',
                left: point.x - 4,
                top: point.y - 4,
                width: 8,
                height: 8,
                borderRadius: isCorner(anchor) ? 1 : '50%',
                background: active ? 'var(--color-select-line)' : '#fff',
                border: '1px solid var(--color-select-line)',
                pointerEvents: 'auto',
                cursor: 'move',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function clonePath(path: VectorPath): VectorPath {
  return { closed: path.closed, anchors: path.anchors.map(cloneAnchor) };
}

/** An anchor's position in the running order across every subpath. */
function runningIndex(paths: VectorPath[], sub: number, index: number): number {
  let total = 0;
  for (let i = 0; i < sub; i++) total += paths[i].anchors.length;
  return total + index;
}

/** Distance from a point to a segment — how a click finds the edge it hit. */
function pointToSegment(point: { x: number; y: number }, from: Anchor, to: Anchor): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}
