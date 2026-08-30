'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import { useDoc, usePresence, useStore } from './Session';
import { FlexHandles } from './FlexHandles';
import { toScreen, toWorld, useUI } from '../state/ui';
import { nearestEdge, snapCandidates, type SnapGuide } from '../document/snapping';
import { isInFlow, type Doc, type SceneNode } from '../document/types';
import { gapsOf, smartRow } from '../document/arrange';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box around a set of measured boxes. */
export function unionRect(boxes: Rect[]): Rect | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
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

/**
 * The colour the chrome around a layer is drawn in.
 *
 * Figma paints a main component, a component set and an instance purple and
 * everything else blue, so the outline alone says whether the thing you are
 * about to edit will propagate.
 */
function chromeOf(node: SceneNode | undefined): string {
  return node && (node.isComponent || node.isComponentSet || node.instanceOf)
    ? 'var(--color-select-component)'
    : 'var(--color-select-line)';
}

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
  /**
   * The timeline that is open, and where its playhead is.
   *
   * A scrub moves layers by animating them: no document changes and no
   * viewport does, so chrome that measures the DOM would go on drawing itself
   * where the layer used to be. Opening and closing the panel move them too —
   * which is why this is the frame *and* the playhead, not the playhead alone.
   */
  const at = useUI((s) => (s.motion.frame ? `${s.motion.frame}:${s.motion.at}` : ''));
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
    // `key` stands in for `ids`; doc, viewport and the playhead re-measure on
    // any change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc, viewport, at, containerRef]);

  return rects;
}

/**
 * Where a parent's content starts, in world coordinates, measured.
 *
 * A node's x/y is local to its parent, so anything computed in world terms has
 * to come back through this before it can be written. A page has no element of
 * its own, and page-local already *is* world, so the origin is nothing.
 */
function parentOrigin(
  id: string | null | undefined,
  base: DOMRect,
  vp: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  if (!id) return { x: 0, y: 0 };
  const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  return toWorld(vp, rect.left - base.left, rect.top - base.top);
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
  const dropTarget = useUI((s) => s.dropTarget);
  const dropSlot = useUI((s) => s.dropSlot);
  // point editing replaces the selection chrome with the anchors themselves,
  // exactly as Figma's does — two sets of handles would fight for the pointer
  const vectorEdit = useUI((s) => s.vectorEdit);
  const pageId = useUI((s) => s.page);
  const select = useUI((s) => s.select);
  const setGuides = useUI((s) => s.setGuides);
  // A timeline that is running is a preview, and chrome does not belong on a
  // preview: the handles would chase a layer they cannot keep up with, since
  // the animation runs on the compositor and the overlay measures on render.
  const previewing = useUI((s) => s.motion.playing);
  /**
   * An armed tool owns the pointer, selection chrome included (C-27).
   *
   * Figma draws the outline of whatever is still selected while a drawing tool
   * is up, but nothing in that chrome takes a press: you draw wherever you
   * press, and the corner of the rectangle you have just made is exactly where
   * the next one usually starts. Holding Space is the hand tool for as long as
   * it is held, so it counts as armed too.
   */
  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  const armed = spacePan || (tool !== 'move' && tool !== 'scale');
  /** what a piece of chrome puts in `pointerEvents` while a tool may be armed */
  const grab = armed ? ('none' as const) : ('auto' as const);
  const presence = usePresence();

  const remoteIds = presence.flatMap((p) => p.selection);
  // Figma keeps a board's name on the canvas at all times — it is how you tell
  // one from another without selecting anything, and it is the thing you click
  // to pick the board up rather than what is inside it.
  const boards = (doc[pageId]?.children ?? []).filter((id) => {
    const kind = doc[id]?.type;
    return kind === 'section' || kind === 'frame';
  });
  // a slice is invisible by design, so its outline has to be permanent chrome
  const slices = Object.values(doc)
    .filter((node) => node.type === 'slice' && node.visible)
    .map((node) => node.id);
  const tracked = [...new Set([
    ...selection,
    ...(hover ? [hover] : []),
    ...(entered ? [entered] : []),
    ...(lockedHint ? [lockedHint] : []),
    ...(dropTarget ? [dropTarget] : []),
    ...remoteIds,
    ...boards,
    ...slices,
    // "Additional labels" writes a size under every frame, so every frame has
    // to be measured — not only the ones the pointer is on
    ...(labels ? (doc[page]?.children ?? []) : []),
  ])];
  const rects = useRects(tracked, containerRef);

  /** Screen-space union of the selected nodes. */
  const bounds = (() => {
    const boxes = selection.map((id) => rects[id]).filter(Boolean) as Rect[];
    return boxes.length < 2 ? null : unionRect(boxes);
  })();

  // a mixed selection has no one answer, so it falls back to the blue
  const groupChrome = selection.every((id) => chromeOf(doc[id]) !== 'var(--color-select-line)')
    ? 'var(--color-select-component)'
    : 'var(--color-select-line)';

  /**
   * Figma's smart selection: three or more layers that read as a row.
   *
   * `smartRow` decides whether they do; what follows is the two things you can
   * then do with them. Both write through `store.layRow`, which lays the row out
   * from the first layer's start — so neither gesture moves the arrangement, it
   * only changes the order inside it or the size of the spaces.
   */
  const row = smartRow(doc, selection);

  /** Where a point on the screen falls along the row, in the parent's terms. */
  const alongRow = (clientX: number, clientY: number, axis: 'x' | 'y'): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    const base = container.getBoundingClientRect();
    const vp = useUI.getState().viewport;
    const world = toWorld(vp, clientX - base.left, clientY - base.top);
    const origin = parentOrigin(doc[selection[0]]?.parent, base, vp);
    return world[axis] - origin[axis];
  };

  /**
   * Dragging a layer's dot moves it along the row, and the rest close up.
   *
   * The row is re-laid on every move rather than previewed, for the same reason
   * the auto-layout reorder is: the arrangement shuffling under the pointer *is*
   * the insertion indicator, and drawing a second one over a row that had not
   * moved would be the lie.
   */
  const startSmartMove = (event: React.PointerEvent, id: string) => {
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    const axis = row.axis;
    const size = axis === 'x' ? 'w' : 'h';
    let order = [...row.ids];

    const move = (e: PointerEvent) => {
      const at = alongRow(e.clientX, e.clientY, axis);
      if (at === null) return;
      const snapshot = store.getSnapshot();
      const from = order.indexOf(id);
      if (from < 0) return;
      // count the others the pointer has passed the middle of; that count is
      // the slot it belongs in
      const others = order.filter((entry) => entry !== id);
      let to = 0;
      for (const entry of others) {
        const node = snapshot[entry];
        if (!node || at <= node[axis] + node[size] / 2) break;
        to += 1;
      }
      if (to === from) return;
      order = [...others.slice(0, to), id, ...others.slice(to)];
      store.layRow(order, axis);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Dragging a space handle sets every space in the row at once. */
  const startSmartGap = (event: React.PointerEvent) => {
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    const axis = row.axis;
    const order = [...row.ids];
    const gaps = gapsOf(doc, row);
    // the row may not be evenly spaced yet, and dragging from its typical gap
    // is less surprising than dragging from whichever one you happened to grab
    const start = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const from = axis === 'x' ? event.clientX : event.clientY;

    const move = (e: PointerEvent) => {
      const delta = ((axis === 'x' ? e.clientX : e.clientY) - from) / viewport.zoom;
      store.layRow(order, axis, Math.max(0, Math.round(start + delta)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
    // `bounds` is in canvas pixels, which is the viewport's pan *and* its zoom.
    // Dividing by the zoom alone left the anchor offset by however far the
    // canvas had been panned, so a group scaled about a point that was not on
    // it — invisible only while the canvas sat at the origin.
    const corner = toWorld(viewport, bounds.x, bounds.y);
    const originWorld = { x: corner.x, y: corner.y, w: bounds.w / zoom, h: bounds.h / zoom };

    // Each layer is pinned by where it *is* rather than by its stored x/y, which
    // is local to its parent while the group box is in world coordinates —
    // scaling one against the other threw a nested selection across the page.
    // The middle is the right thing to measure: it survives a rotation, which
    // the top-left corner of an axis-aligned measurement does not.
    const base = containerRef.current?.getBoundingClientRect();
    const start = selection
      .map((id) => {
        const node = doc[id];
        const rect = rects[id];
        if (!node || !rect || !base) return null;
        const middle = toWorld(viewport, rect.x + rect.w / 2, rect.y + rect.h / 2);
        return { id, node, middle, origin: parentOrigin(node.parent, base, viewport) };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);

    const move = (e: PointerEvent) => {
      const dx = (e.clientX - event.clientX) / zoom;
      const dy = (e.clientY - event.clientY) / zoom;
      // the same two modifiers a single layer answers to: ⌥ works both ways at
      // once about the middle, ⇧ keeps the group's proportion
      const reach = e.altKey ? 2 : 1;
      let scaleX = handle.includes('e')
        ? (originWorld.w + dx * reach) / originWorld.w
        : handle.includes('w')
          ? (originWorld.w - dx * reach) / originWorld.w
          : 1;
      let scaleY = handle.includes('s')
        ? (originWorld.h + dy * reach) / originWorld.h
        : handle.includes('n')
          ? (originWorld.h - dy * reach) / originWorld.h
          : 1;
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;
      if (e.shiftKey) {
        // whichever axis was pulled harder carries both
        const uniform = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
        scaleX = uniform;
        scaleY = uniform;
      }

      const anchorX = e.altKey
        ? originWorld.x + originWorld.w / 2
        : handle.includes('w')
          ? originWorld.x + originWorld.w
          : originWorld.x;
      const anchorY = e.altKey
        ? originWorld.y + originWorld.h / 2
        : handle.includes('n')
          ? originWorld.y + originWorld.h
          : originWorld.y;

      const sx = Math.max(scaleX, 0.01);
      const sy = Math.max(scaleY, 0.01);
      store.updateMany(
        start.map((entry) => entry.id),
        (n) => {
          const from = start.find((entry) => entry.id === n.id)!;
          // scale where the layer sits, then put it back in its parent's terms
          const middleX = anchorX + (from.middle.x - anchorX) * sx;
          const middleY = anchorY + (from.middle.y - anchorY) * sy;
          const w = Math.max(1, Math.round(from.node.w * sx));
          const h = Math.max(1, Math.round(from.node.h * sy));
          return {
            x: Math.round(middleX - w / 2 - from.origin.x),
            y: Math.round(middleY - h / 2 - from.origin.y),
            w,
            h,
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

  /**
   * Figma's rotate: press just outside a corner and swing.
   *
   * The angle is read from the middle of the layer to the pointer, and only the
   * *change* since the press is applied — so grabbing the corner does not snap
   * the layer round to wherever the pointer happened to be. ⇧ steps in 15°.
   */
  const startRotate = (event: React.PointerEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const node = doc[id];
    const rect = rects[id];
    const base = containerRef.current?.getBoundingClientRect();
    if (!node || !rect || !base) return;

    // a layer turns about its middle, and the measured box shares that middle
    // however far round it already is
    const centreX = base.left + rect.x + rect.w / 2;
    const centreY = base.top + rect.y + rect.h / 2;
    const angleTo = (x: number, y: number) => (Math.atan2(y - centreY, x - centreX) * 180) / Math.PI;
    const grabbed = angleTo(event.clientX, event.clientY);
    const was = node.rotation ?? 0;

    const move = (e: PointerEvent) => {
      const turned = was + (angleTo(e.clientX, e.clientY) - grabbed);
      const stepped = e.shiftKey ? Math.round(turned / 15) * 15 : Math.round(turned);
      store.update(id, { rotation: ((stepped % 360) + 360) % 360 });
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
    const angle = node.rotation ?? 0;
    // A rotated layer is measured by the box *around* it, which is not its own
    // size — so a turned layer is sized from the document, and a straight one
    // from the DOM, which is authoritative for anything that hugs or fills.
    const startW = angle ? node.w : rect?.w ? rect.w / viewport.zoom : node.w;
    const startH = angle ? node.h : rect?.h ? rect.h / viewport.zoom : node.h;

    const ratio = startH ? startW / startH : 1;
    const rad = (angle * Math.PI) / 180;
    const centre = { x: origin.x + startW / 2, y: origin.y + startH / 2 };
    const candidates = node.parent ? snapCandidates(doc, [id], node.parent) : [];

    const move = (e: PointerEvent) => {
      const screenX = (e.clientX - event.clientX) / viewport.zoom;
      const screenY = (e.clientY - event.clientY) / viewport.zoom;
      // The pointer moves across the screen; the box grows along its own axes.
      // On a turned layer those are not the same direction, so the delta is
      // turned back by however far the layer is turned before it is used.
      const dx = angle ? screenX * Math.cos(rad) + screenY * Math.sin(rad) : screenX;
      const dy = angle ? -screenX * Math.sin(rad) + screenY * Math.cos(rad) : screenY;
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
      // Pulling a handle past the far edge turns the layer over rather than
      // stopping at nothing: the box carries on growing the other way and the
      // artwork mirrors with it, which is what Figma does and what makes the
      // gesture recoverable — drag back and you are where you were.
      const turnedX = w < 0;
      const turnedY = h < 0;
      w = Math.max(1, Math.round(Math.abs(w)));
      h = Math.max(1, Math.round(Math.abs(h)));

      // Snap the edge being dragged to its siblings, the way a move already
      // does. Skipped when the gesture has its own idea of the size — a ratio
      // or a centre — and on a turned layer, whose edges are not on these axes.
      // A layer that has just been turned over is skipped too: the edge under
      // the pointer is on the other side of the anchor, so the arithmetic below
      // would snap the wrong one. ⌘ bypasses it, as it does for a move.
      const held = e.shiftKey || node.aspectLocked || e.altKey || turnedX || turnedY;
      const guides: SnapGuide[] = [];
      if (!angle && !held && !e.metaKey && !e.ctrlKey && candidates.length) {
        const tolerance = 6 / viewport.zoom;
        if (ex) {
          const edge = ex > 0 ? origin.x + w : origin.x + startW - w;
          const near = nearestEdge(edge, candidates, 'x', tolerance);
          if (near) {
            w = Math.max(1, Math.round(ex > 0 ? near.at - origin.x : origin.x + startW - near.at));
            guides.push({ kind: 'align', axis: 'x', at: near.at, from: near.other.y, to: near.other.y + near.other.h });
          }
        }
        if (ey) {
          const edge = ey > 0 ? origin.y + h : origin.y + startH - h;
          const near = nearestEdge(edge, candidates, 'y', tolerance);
          if (near) {
            h = Math.max(1, Math.round(ey > 0 ? near.at - origin.y : origin.y + startH - near.at));
            guides.push({ kind: 'align', axis: 'y', at: near.at, from: near.other.x, to: near.other.x + near.other.w });
          }
        }
      }
      setGuides(guides);

      // How far the middle has to move for the anchor to stay put.
      //
      // The anchor is the edge opposite the handle, or the middle under ⌥, and
      // it is worked out *after* the size is final — doing it first is what made
      // a ⇧-drag on a north or west handle slide the box while it scaled. When
      // the layer has been turned over the anchor is the same edge, but the box
      // now hangs off the other side of it, which is the `+ w` rather than `- w`.
      // A layer turns about its middle, so keeping an edge still means moving
      // the middle; with no rotation this is the plain "opposite edge stays".
      const offX = e.altKey ? 0 : (-ex * (startW + (turnedX ? w : -w))) / 2;
      const offY = e.altKey ? 0 : (-ey * (startH + (turnedY ? h : -h))) / 2;
      const x = Math.round(
        centre.x + (angle ? offX * Math.cos(rad) - offY * Math.sin(rad) : offX) - w / 2,
      );
      const y = Math.round(
        centre.y + (angle ? offX * Math.sin(rad) + offY * Math.cos(rad) : offY) - h / 2,
      );

      const patch: Partial<SceneNode> = { w, h, wMode: 'fixed', hMode: 'fixed' };
      // only write a field that actually changed: a no-op write still pins it
      // as an override on a layer inside an instance
      const live = store.getSnapshot()[id];
      if (live && live.x !== x) patch.x = x;
      if (live && live.y !== y) patch.y = y;
      // The mirror is relative to however the layer already sat, and it is
      // re-derived every move rather than toggled — so dragging back across the
      // edge puts it the right way round again instead of flapping.
      const wantH = turnedX ? !(node.flipH ?? false) : (node.flipH ?? false);
      const wantV = turnedY ? !(node.flipV ?? false) : (node.flipV ?? false);
      if (live && (live.flipH ?? false) !== wantH) patch.flipH = wantH;
      if (live && (live.flipV ?? false) !== wantV) patch.flipV = wantV;
      store.update(id, patch);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
      store.commit(); // one gesture, one undo step
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        visibility: previewing ? 'hidden' : undefined,
      }}
    >
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
        if (guide.kind === 'gap') return null;
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

      {/* the spaces a spacing snap took, each measured — the bar has a serif at
          either end so it reads as a span rather than as one more alignment */}
      {guides.map((guide, index) => {
        if (guide.kind !== 'gap') return null;
        const horizontal = guide.axis === 'x';
        const a = toScreen(viewport, horizontal ? guide.from : guide.at, horizontal ? guide.at : guide.from);
        const b = toScreen(viewport, horizontal ? guide.to : guide.at, horizontal ? guide.at : guide.to);
        const length = horizontal ? b.x - a.x : b.y - a.y;
        return (
          <div key={`gap-${index}`}>
            <div
              data-gap-guide={guide.axis}
              style={{
                position: 'absolute',
                left: a.x,
                top: a.y,
                width: horizontal ? length : 1,
                height: horizontal ? 1 : length,
                background: '#FF3B30',
              }}
            />
            {[a, b].map((end, side) => (
              <div
                key={side}
                style={{
                  position: 'absolute',
                  left: horizontal ? end.x : end.x - 3,
                  top: horizontal ? end.y - 3 : end.y,
                  width: horizontal ? 1 : 7,
                  height: horizontal ? 7 : 1,
                  background: '#FF3B30',
                }}
              />
            ))}
            <span
              data-gap-label={guide.axis}
              style={{
                position: 'absolute',
                left: horizontal ? a.x + length / 2 : a.x + 6,
                top: horizontal ? a.y - 9 : a.y + length / 2 - 8,
                transform: horizontal ? 'translateX(-50%)' : undefined,
                fontSize: 10,
                fontWeight: 500,
                color: '#fff',
                background: '#FF3B30',
                borderRadius: 3,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
              }}
            >
              {Math.round(guide.to - guide.from)}
            </span>
          </div>
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

      {/* the frame a release would drop into: heavier than the hover hint,
          because it says the tree is about to change */}
      {dropTarget && rects[dropTarget] && (
        <div
          style={{
            position: 'absolute',
            left: rects[dropTarget].x,
            top: rects[dropTarget].y,
            width: rects[dropTarget].w,
            height: rects[dropTarget].h,
            outline: '2px solid var(--color-select-line)',
            outlineOffset: -1,
          }}
        />
      )}

      {/* …and where in its flow the layer would land, when it flows its
          children — the outline alone cannot say between which two */}
      {dropSlot && (
        <div
          data-drop-slot="true"
          style={{
            position: 'absolute',
            left: dropSlot.x,
            top: dropSlot.y,
            width: dropSlot.w,
            height: dropSlot.h,
            background: 'var(--color-select-line)',
          }}
        />
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
            outline: `1px solid ${chromeOf(doc[hover])}`,
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
              outline: `1.75px solid ${groupChrome}`,
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
              background: groupChrome,
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
              data-group-handle={handle.id}
              onPointerDown={(e) => startGroupResize(e, handle.id)}
              style={{
                position: 'absolute',
                left: bounds.x + bounds.w * handle.cx - 3.5,
                top: bounds.y + bounds.h * handle.cy - 3.5,
                width: 7,
                height: 7,
                background: '#fff',
                border: `1px solid ${groupChrome}`,
                borderRadius: 1,
                cursor: handle.cursor,
                pointerEvents: grab,
              }}
            />
          ))}
        </>
      )}

      {/* Smart selection: a dot on each layer, a bar in each space. Drawn after
          the group's own handles so a corner handle still wins where they meet. */}
      {row &&
        row.ids.map((id, index) => {
          const rect = rects[id];
          if (!rect) return null;
          const next = index + 1 < row.ids.length ? rects[row.ids[index + 1]] : null;
          const across = row.axis === 'x';
          return (
            <div key={`smart-${id}`}>
              <div
                data-smart-dot={id}
                title="Drag to move it along the row"
                onPointerDown={(e) => startSmartMove(e, id)}
                style={{
                  position: 'absolute',
                  left: rect.x + rect.w / 2 - 4,
                  top: rect.y + rect.h / 2 - 4,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: 'var(--color-select-line)',
                  border: '1.5px solid #fff',
                  cursor: 'grab',
                  pointerEvents: grab,
                }}
              />
              {next && (
                <div
                  data-smart-gap={index}
                  title="Drag to space the row"
                  onPointerDown={startSmartGap}
                  style={{
                    position: 'absolute',
                    left: across ? rect.x + rect.w : Math.min(rect.x, next.x) + 4,
                    top: across ? Math.min(rect.y, next.y) + 4 : rect.y + rect.h,
                    width: across ? Math.max(2, next.x - (rect.x + rect.w)) : 4,
                    height: across ? 4 : Math.max(2, next.y - (rect.y + rect.h)),
                    background: 'var(--color-select-line)',
                    opacity: 0.55,
                    borderRadius: 2,
                    cursor: across ? 'ew-resize' : 'ns-resize',
                    pointerEvents: grab,
                  }}
                />
              )}
            </div>
          );
        })}

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

      {/* board names — always on, and clicking one selects it */}
      {boards.map((id) => {
        const rect = rects[id];
        const node = doc[id];
        if (!rect || !node || !node.visible) return null;
        // the selection draws its own name in the same place — two labels on
        // top of each other read as a rendering fault
        if (selection.includes(id)) return null;
        return (
          <button
            key={`board-${id}`}
            type="button"
            className="section-label"
            // a section titles a region of the page and reads larger; a frame
            // is a board among boards, and Figma labels it more quietly
            data-kind={node.type}
            data-component={node.isComponent || node.isComponentSet || undefined}
            data-on={selection.includes(id) || undefined}
            style={{
              left: rect.x,
              top: rect.y - (node.type === 'section' ? 20 : 16),
              pointerEvents: grab,
            }}
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
        const chrome = chromeOf(node);

        // A turned layer is measured by the box *around* it. That box is not the
        // layer's own, but its middle is — a layer turns about its middle — so
        // the real box is rebuilt from that middle at the layer's own size and
        // turned to match. An untouched layer keeps the measured box, which is
        // authoritative for anything that hugs or fills.
        const angle = node.rotation ?? 0;
        const w = angle ? node.w * viewport.zoom : rect.w;
        const h = angle ? node.h * viewport.zoom : rect.h;
        const left = rect.x + rect.w / 2 - w / 2;
        const top = rect.y + rect.h / 2 - h / 2;
        const turn = angle ? `rotate(${angle}deg)` : undefined;

        return (
          <div key={id}>
            <div
              style={{
                position: 'absolute',
                left,
                top,
                width: w,
                height: h,
                transform: turn,
                outline: `1.75px solid ${chrome}`,
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
                  color: chrome,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {node.name}
                {flowed && <span style={{ opacity: 0.65 }}> · in flex</span>}
                {node.locked && <span style={{ opacity: 0.65 }}> · locked</span>}
              </span>
            )}

            {/* the readout stays upright however far the layer is turned: a
                number you have to tilt your head to read is not a readout */}
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
                  background: chrome,
                  borderRadius: 3,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(w / viewport.zoom)} × {Math.round(h / viewport.zoom)}
              </span>
            )}

            {/* The handles ride inside a box that carries the same turn, so they
                sit on the layer's corners rather than on the corners of the box
                around it — and their offsets stay the plain fractions they are. */}
            {single && editing !== id && (
              <div
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: w,
                  height: h,
                  transform: turn,
                  pointerEvents: 'none',
                }}
              >
                {HANDLES.map((handle) => (
                  <div key={handle.id}>
                    {/* Rotation lives just outside each corner, where Figma puts
                        it. Placed clear of the box so it can never take a press
                        that belonged to the layer, and before the resize handle
                        so the corner itself still resizes. */}
                    {handle.cx !== 0.5 && handle.cy !== 0.5 && (
                      <div
                        data-rotate={handle.id}
                        onPointerDown={(e) => startRotate(e, id)}
                        style={{
                          position: 'absolute',
                          left: `${handle.cx * 100}%`,
                          top: `${handle.cy * 100}%`,
                          marginLeft: handle.cx ? 4 : -22,
                          marginTop: handle.cy ? 4 : -22,
                          width: 18,
                          height: 18,
                          cursor: 'crosshair',
                          pointerEvents: grab,
                        }}
                      />
                    )}
                    <div
                      data-handle={handle.id}
                      onPointerDown={(e) => startResize(e, handle.id, id)}
                      style={{
                        position: 'absolute',
                        left: `${handle.cx * 100}%`,
                        top: `${handle.cy * 100}%`,
                        marginLeft: -3.5,
                        marginTop: -3.5,
                        width: 7,
                        height: 7,
                        background: '#fff',
                        border: `1px solid ${chrome}`,
                        borderRadius: 1,
                        cursor: handle.cursor,
                        pointerEvents: grab,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
