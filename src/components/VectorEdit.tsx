'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useRects } from './Overlay';
import { useDoc, useStore } from './Session';
import { useUI, type VectorTool } from '../state/ui';
import {
  anchorAt,
  bendSegment,
  cloneAnchor,
  clonePaths,
  containsPoint,
  cutAt,
  cutAtAnchor,
  editablePaths,
  eraseSegment,
  insertAnchor,
  isCorner,
  isEndpoint,
  joinAnchors,
  mirrorOf,
  nearestOnSubpaths,
  pathFromSubpaths,
  removeAnchors,
  runningIndex,
  type Anchor,
  type AnchorRef,
  type Vec,
} from '../document/geometry';
import {
  dropRegion,
  interiorPoint,
  mergeRegions,
  regionAt,
  vectorRegions,
} from '../document/regions';
import type { VectorPath } from '../document/types';

/**
 * Vector edit mode.
 *
 * Double-clicking a shape opens it: the layer's own selection chrome goes away,
 * its points appear, the inside fills with Figma's blue hatch so you can see
 * what you are inside of, and a toolbar of sub-tools comes up along the bottom.
 * Everything here works in screen space and writes back in the node's own
 * space, so editing behaves the same at any zoom.
 *
 * The sub-tools are what the pointer means, because inside a path it means six
 * different things and no arrangement of modifier keys covers them:
 *
 *   Move    drag points, handles and segments; click a segment to add a point
 *   Lasso   draw around the points you want
 *   Paint   fill the region you click — ⌥ empties one again
 *   Bend    drag any segment into a curve, any corner into a smooth point
 *   Cut     slice the path in two, wherever you click on it
 *   Erase   delete the point or the segment under the pointer
 *   More    Shape builder (M) drags across regions to merge them, ⌥ removes one;
 *           Variable width (⇧W) tapers the stroke point by point
 *
 * On top of that, the keys Figma binds:
 *
 *   ⇧ drag             constrain to the axis; ⌘ drag ignores the pixel grid
 *   ⌥ drag a handle    break the mirror, so the two sides bend apart
 *   drag a handle home retract it, turning that side back into a corner
 *   ⌥ / double click   toggle an anchor between a corner and a smooth point
 *   P, then click      keep drawing from the selected loose end
 *   ⌘A                 every anchor      ⌘J  join two ends, or close a path
 *   ⌫                  delete, healing the curve behind it
 *   ⏎ / esc            done
 *
 * A path can have several subpaths — a flattened boolean has a hole in it — so
 * anchors are addressed by one running index across all of them. That keeps the
 * selection a plain list of numbers, which is what the store and the keyboard
 * handlers want.
 *
 * A parametric shape can be edited too, and stays parametric until the moment
 * you actually move something: `editablePaths` hands back the outline a
 * rectangle *would* have, and the first edit is what converts it. That is
 * Figma's behaviour, and it means double-clicking a star you only wanted to
 * look at costs nothing.
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

/** How far the pointer must travel before a press counts as a drag. */
const DRAG_SLOP = 3;

/** A marquee or a lasso, in screen space. */
interface Band {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function VectorEdit({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const doc = useDoc();
  const store = useStore();
  const id = useUI((s) => s.vectorEdit);
  const selected = useUI((s) => s.anchorSelection);
  const setSelected = useUI((s) => s.setAnchorSelection);
  const setVectorEdit = useUI((s) => s.setVectorEdit);
  const viewport = useUI((s) => s.viewport);
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);
  const vectorTool = useUI((s) => s.vectorTool);
  const setVectorTool = useUI((s) => s.setVectorTool);
  const rects = useRects(id ? [id] : [], containerRef);
  const [band, setBand] = useState<Band | null>(null);
  const [lasso, setLasso] = useState<[number, number][] | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  /** the region under the pointer, and the ones the shape builder has picked */
  const [overRegion, setOverRegion] = useState(-1);
  const [picked, setPicked] = useState<number[]>([]);

  const node = id ? doc[id] : null;
  const paths = node ? editablePaths(node) : [];
  const points = locate(paths);
  const smooth = node?.smooth ?? 0;

  // The regions are derived, and deriving them is a boolean pass per subset of
  // the rings — far too much to redo on every pointer move. Only the two tools
  // that name regions ask for them, and the outline itself is the cache key: if
  // the path has not changed, neither have its regions.
  const wantsRegions = vectorTool === 'paint' || vectorTool === 'builder';
  const regionKey = wantsRegions ? pathFromSubpaths(paths, smooth) : '';
  const regions = useMemo(
    () => (regionKey ? vectorRegions(paths, smooth) : []),
    // `regionKey` stands in for the geometry: same outline, same regions
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regionKey],
  );

  // ── Keys ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      // an open menu is on top and takes the keys, Escape included
      if (useUI.getState().contextMenu) return;

      const live = store.getSnapshot()[id];
      if (!live) return;
      const livePaths = editablePaths(live);
      const current = useUI.getState().anchorSelection;
      const mod = event.metaKey || event.ctrlKey;

      /** Converts a parametric shape the moment an edit actually lands. */
      const write = (next: VectorPath[]) => {
        if (live.type !== 'vector') store.outlineShape([id]);
        store.setPaths(id, next);
        store.commit();
      };

      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        setVectorEdit(null);
        return;
      }

      // ⌘A — every point on the path, which is what makes "move the whole
      // outline without moving the layer" a thing you can do
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        event.stopPropagation();
        setSelected(
          livePaths.flatMap((path, sub) =>
            path.anchors.map((_, i) => runningIndex(livePaths, sub, i)),
          ),
        );
        return;
      }

      // ⌘J — join two loose ends, or close a path by its own two ends
      if (mod && event.key.toLowerCase() === 'j') {
        if (current.length !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        const a = anchorAt(livePaths, current[0]);
        const b = anchorAt(livePaths, current[1]);
        if (!a || !b) return;
        const joined = joinAnchors(livePaths, a, b);
        if (!joined) return;
        write(joined);
        setSelected([]);
        return;
      }

      if (mod) return;

      // the two sub-tools Figma gives keys of their own
      if (event.code === 'KeyM' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        useUI.getState().setVectorTool('builder');
        return;
      }
      if (event.code === 'KeyW' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        useUI.getState().setVectorTool('width');
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (!current.length) return;
        event.preventDefault();
        event.stopPropagation();
        const kept = removeAnchors(livePaths, current);
        if (!kept.length) {
          store.remove([id]);
          store.commit();
          setVectorEdit(null);
          useUI.getState().select([]);
          return;
        }
        write(kept);
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
        write(
          livePaths.map((path, sub) => ({
            closed: path.closed,
            anchors: path.anchors.map((anchor, index) =>
              current.includes(runningIndex(livePaths, sub, index))
                ? { ...cloneAnchor(anchor), x: anchor.x + dx, y: anchor.y + dy }
                : cloneAnchor(anchor),
            ),
          })),
        );
      }
    };
    // capture, so the editor's own shortcuts do not fire underneath
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id, store, setSelected, setVectorEdit]);

  if (!id || !node || !rects[id]) return null;
  const rect = rects[id];
  const zoom = viewport.zoom;

  // ── Placement ───────────────────────────────────────────────────────────
  //
  // A rotated or mirrored layer is drawn by a CSS transform about its centre,
  // and a measured box is the axis-aligned one that transform sweeps out. The
  // centre survives it — rotating and flipping about a point leave that point
  // alone — so the centre is what the anchors are placed from, and the same
  // turn is applied by hand. Without this the points of a rotated shape appear
  // beside the shape rather than on it.
  const angle = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = node.flipH ? -1 : 1;
  const sy = node.flipV ? -1 : 1;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  /** node space → screen space, relative to the canvas container */
  const toScreenPoint = (x: number, y: number) => {
    const fx = (x - node.w / 2) * zoom * sx;
    const fy = (y - node.h / 2) * zoom * sy;
    return { x: cx + fx * cos - fy * sin, y: cy + fx * sin + fy * cos };
  };

  /** A screen-space offset, in the node's own axes. */
  const toLocalDelta = (dx: number, dy: number): [number, number] => [
    ((dx * cos + dy * sin) * sx) / zoom,
    ((-dx * sin + dy * cos) * sy) / zoom,
  ];

  /** screen space → the node's own space */
  const toLocal = (clientX: number, clientY: number) => {
    const base = containerRef.current!.getBoundingClientRect();
    const [x, y] = toLocalDelta(clientX - base.left - cx, clientY - base.top - cy);
    return { x: x + node.w / 2, y: y + node.h / 2 };
  };

  /**
   * A parametric shape becomes a vector on its first real edit, not on entry.
   *
   * The outline it converts to is the one already on screen, so nothing moves —
   * the layer simply stops knowing it used to be a star.
   */
  const ensureVector = () => {
    const live = store.getSnapshot()[id];
    if (live && live.type !== 'vector') store.outlineShape([id]);
  };

  /** Rewrites a path immediately — used by the gestures that are not drags. */
  const write = (next: VectorPath[]) => {
    ensureVector();
    store.setPaths(id, next);
    store.commit();
  };

  /** Runs a pointer drag, writing live and committing once at the end. */
  const dragPoints = (
    event: React.PointerEvent,
    apply: (dx: number, dy: number, event: PointerEvent) => VectorPath[],
    onDone?: (moved: boolean) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let last: VectorPath[] | null = null;
    let moved = false;

    const move = (e: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
        moved = true;
        ensureVector();
      }
      const [dx, dy] = toLocalDelta(e.clientX - startX, e.clientY - startY);
      last = apply(dx, dy, e);
      // no re-fit while the pointer is down: moving the box under a live drag
      // would shift the very coordinates the drag is measured against
      store.update(id, {
        paths: last,
        anchors: last.length === 1 ? last[0].anchors : undefined,
        closed: last.length === 1 ? last[0].closed : undefined,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last) {
        store.setPaths(id, last);
        store.commit();
      }
      onDone?.(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** ⇧ locks a drag to an axis; the pixel grid holds unless ⌘ says otherwise. */
  const settle = (dx: number, dy: number, event: PointerEvent): [number, number] => {
    let x = dx;
    let y = dy;
    if (event.shiftKey) {
      if (Math.abs(x) > Math.abs(y)) y = 0;
      else x = 0;
    }
    if (!(event.metaKey || event.ctrlKey)) {
      x = Math.round(x);
      y = Math.round(y);
    }
    return [x, y];
  };

  // ── Anchors ─────────────────────────────────────────────────────────────

  /** ⌥ or a double click swaps an anchor between a corner and a smooth point. */
  const toggleCorner = (at: Located) => {
    const next = clonePaths(paths);
    const anchors = next[at.sub].anchors;
    const anchor = anchors[at.index];
    const count = anchors.length;
    if (!isCorner(anchor)) {
      anchors[at.index] = { ...anchor, in: null, out: null };
    } else {
      const prev = anchors[(at.index - 1 + count) % count];
      const after = anchors[(at.index + 1) % count];
      const dx = (after.x - prev.x) / 4;
      const dy = (after.y - prev.y) / 4;
      anchors[at.index] = { ...anchor, in: [-dx, -dy], out: [dx, dy] };
    }
    write(next);
  };

  /** Bend, applied to a point: pull mirrored handles straight out of it. */
  const bendAnchor = (at: Located, running: number, event: React.PointerEvent) => {
    setSelected([running]);
    const origin = clonePaths(paths);
    const base = (origin[at.sub].anchors[at.index].out ?? [0, 0]) as Vec;
    dragPoints(event, (dx, dy) => {
      const next = clonePaths(origin);
      const anchor = next[at.sub].anchors[at.index];
      const out: Vec = [base[0] + dx, base[1] + dy];
      next[at.sub].anchors[at.index] = { ...anchor, out, in: [-out[0], -out[1]] };
      return next;
    });
  };

  /** Variable width, applied to a point: drag away to thicken, back to thin. */
  const widthAnchor = (at: Located, running: number, event: React.PointerEvent) => {
    setSelected([running]);
    const origin = clonePaths(paths);
    const base = origin[at.sub].anchors[at.index].width ?? node.border?.width ?? 1;
    dragPoints(event, (dx, dy) => {
      const next = clonePaths(origin);
      const anchor = next[at.sub].anchors[at.index];
      // either axis works, so the gesture reads the same wherever the point is
      const reach = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      next[at.sub].anchors[at.index] = {
        ...anchor,
        width: Math.max(0, Math.round((base + reach * 2) * 10) / 10),
      };
      return next;
    });
  };

  const moveAnchor = (at: Located, running: number, event: React.PointerEvent) => {
    if (tool === 'pen') {
      penAtAnchor(at, running, event);
      return;
    }
    if (vectorTool === 'erase') {
      event.preventDefault();
      event.stopPropagation();
      const kept = removeAnchors(paths, [running]);
      if (!kept.length) {
        store.remove([id]);
        store.commit();
        setVectorEdit(null);
        return;
      }
      write(kept);
      setSelected([]);
      return;
    }
    if (vectorTool === 'cut') {
      event.preventDefault();
      event.stopPropagation();
      write(cutAtAnchor(paths, { sub: at.sub, index: at.index }));
      setSelected([]);
      return;
    }
    if (vectorTool === 'bend') {
      bendAnchor(at, running, event);
      return;
    }
    if (vectorTool === 'width') {
      widthAnchor(at, running, event);
      return;
    }

    const picked = event.shiftKey
      ? selected.includes(running)
        ? selected.filter((i) => i !== running)
        : [...selected, running]
      : selected.includes(running)
        ? selected
        : [running];
    setSelected(picked);

    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleCorner(at);
      return;
    }

    const origin = clonePaths(paths);
    dragPoints(event, (dx, dy, e) => {
      const [mx, my] = settle(dx, dy, e);
      return origin.map((path, sub) => ({
        closed: path.closed,
        anchors: path.anchors.map((anchor, index) =>
          picked.includes(runningIndex(origin, sub, index))
            ? { ...cloneAnchor(anchor), x: anchor.x + mx, y: anchor.y + my }
            : cloneAnchor(anchor),
        ),
      }));
    });
  };

  // ── Handles ─────────────────────────────────────────────────────────────

  const moveHandle = (at: Located, side: 'in' | 'out', event: React.PointerEvent) => {
    const origin = clonePaths(paths);
    const anchor = origin[at.sub].anchors[at.index];
    const base = (anchor[side] ?? [0, 0]) as Vec;
    const opposite = side === 'in' ? 'out' : 'in';
    const other = anchor[opposite] as Vec | null | undefined;

    // Figma keeps three mirror states. The Vector panel can state one; a point
    // nobody has pressed a button on is read off its own handles instead.
    const mirror = mirrorOf(anchor);

    dragPoints(event, (dx, dy, e) => {
      let next: Vec = [base[0] + dx, base[1] + dy];
      if (e.shiftKey) {
        // ⇧ snaps the handle's direction to 45°, keeping the length you dragged
        const length = Math.hypot(next[0], next[1]);
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(next[1], next[0]) / step) * step;
        next = [Math.cos(angle) * length, Math.sin(angle) * length];
      }
      // dragged home, the handle retracts and that side becomes a corner again
      const retracted = Math.hypot(next[0], next[1]) * zoom < 2;
      const broken = e.altKey || mirror === 'none';

      return origin.map((path, sub) => ({
        closed: path.closed,
        anchors: path.anchors.map((current, index) => {
          if (sub !== at.sub || index !== at.index) return cloneAnchor(current);
          const copy = cloneAnchor(current);
          copy[side] = retracted ? null : next;
          if (!broken && !retracted && other) {
            const length =
              mirror === 'full' ? Math.hypot(next[0], next[1]) : Math.hypot(other[0], other[1]);
            const reach = Math.hypot(next[0], next[1]) || 1;
            copy[opposite] = [(-next[0] / reach) * length, (-next[1] / reach) * length];
          }
          return copy;
        }),
      }));
    });
  };

  // ── Segments ────────────────────────────────────────────────────────────

  /**
   * A press on the outline. What it does is the sub-tool's business, except
   * under Move, where a drag bends and a click inserts — both gestures are
   * about the same place on the curve, and which one you meant is only knowable
   * once the pointer either moves or does not.
   */
  const onSegmentDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // The lasso and the pen are about where the pointer is, not about what is
    // under it — landing on the outline must not swallow them, or a loop drawn
    // near an edge quietly does nothing.
    if (tool === 'pen' || vectorTool === 'lasso') {
      onBackgroundDown(event);
      return;
    }
    event.stopPropagation();

    const local = toLocal(event.clientX, event.clientY);
    const hit = nearestOnSubpaths(paths, local, smooth);
    if (!hit || hit.distance > 12 / zoom) return;

    if (vectorTool === 'paint') {
      paintAt(local, event.altKey);
      return;
    }
    if (vectorTool === 'builder') {
      buildFrom(event, local);
      return;
    }
    if (vectorTool === 'cut') {
      event.preventDefault();
      write(cutAt(paths, hit, smooth));
      setSelected([]);
      return;
    }
    if (vectorTool === 'erase') {
      event.preventDefault();
      const kept = eraseSegment(paths, hit);
      if (!kept.length) {
        store.remove([id]);
        store.commit();
        setVectorEdit(null);
        return;
      }
      write(kept);
      setSelected([]);
      return;
    }
    if (vectorTool === 'width') return;

    const origin = clonePaths(paths);
    dragPoints(
      event,
      (dx, dy) => bendSegment(origin, hit, dx, dy, smooth),
      (moved) => {
        // Bend never inserts; Move does, because a click on a line in Figma's
        // move tool is how you add a point to it
        if (moved || vectorTool === 'bend') return;
        const { paths: next, at } = insertAnchor(origin, hit, smooth);
        write(next);
        setSelected([runningIndex(next, at.sub, at.index)]);
      },
    );
  };

  // ── Paint ───────────────────────────────────────────────────────────────

  /**
   * The bucket: fills the region you clicked, and ⌥ empties it again.
   *
   * A path's regions are the areas its rings enclose, overlaps included, so
   * painting one is a matter of remembering a point inside it. Until someone
   * does that the whole outline is filled, which is what every shape does when
   * it is drawn — the first paint is what turns one area into a choice.
   *
   * A ring the pointer is inside but which is not closed yet is closed first:
   * that is what "fill this" means when the region you pointed at is not yet a
   * region at all.
   */
  const paintAt = (local: { x: number; y: number }, remove: boolean) => {
    const at = regionAt(regions, [local.x, local.y]);

    if (at < 0) {
      const open = paths.findIndex(
        (path) => !path.closed && containsPoint(path, local, smooth),
      );
      if (open < 0) return;
      const next = clonePaths(paths);
      next[open].closed = true;
      ensureVector();
      store.setPaths(id, next);
      store.update(id, {
        fill: node.fill ?? '#D9D9D9',
        fillVisible: true,
        fillOpacity: node.fillOpacity ?? 1,
      });
      store.commit();
      return;
    }

    // What "already painted" means before anyone has picked: everything, if the
    // layer paints at all — so ⌥ on a plain filled shape punches one region out
    // rather than starting from nothing and appearing to do the opposite.
    const painting = node.fillVisible !== false && (!!node.fill || !!node.fills?.length);
    const seeds =
      node.fillSeeds ?? (painting ? regions.map((entry) => interiorPoint(entry.region)) : []);
    const others = seeds.filter((seed) => regionAt(regions, seed) !== at);
    const next = remove ? others : [...others, interiorPoint(regions[at].region)];

    ensureVector();
    store.update(id, {
      fillSeeds: next,
      fill: node.fill ?? '#D9D9D9',
      fillVisible: true,
      fillOpacity: node.fillOpacity ?? 1,
    });
    store.commit();
  };

  // ── The shape builder ───────────────────────────────────────────────────

  /**
   * Figma's shape builder: drag across regions to make them one shape.
   *
   * ⌥ on a region takes it away instead. Either way the result is the
   * arrangement committed to geometry — the rings that used to overlap stop
   * being separate rings that happen to cross and become the outlines you can
   * see, which is the whole point of the tool.
   */
  const buildFrom = (event: React.PointerEvent, local: { x: number; y: number }) => {
    const first = regionAt(regions, [local.x, local.y]);
    if (first < 0) return;
    event.preventDefault();

    if (event.altKey) {
      const kept = dropRegion(regions, first);
      if (!kept.length) return;
      write(kept);
      setPicked([]);
      return;
    }

    const chosen = new Set<number>([first]);
    setPicked([...chosen]);
    const move = (e: PointerEvent) => {
      const point = toLocal(e.clientX, e.clientY);
      const at = regionAt(regions, [point.x, point.y]);
      if (at < 0 || chosen.has(at)) return;
      chosen.add(at);
      setPicked([...chosen]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPicked([]);
      if (chosen.size > 1) write(mergeRegions(regions, [...chosen]));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── The pen, inside the mode ────────────────────────────────────────────

  /** The loose end a new point would grow from, if there is one. */
  const growingEnd = (): { ref: AnchorRef; running: number } | null => {
    for (const running of selected) {
      const ref = anchorAt(paths, running);
      if (ref && isEndpoint(paths[ref.sub], ref.index)) return { ref, running };
    }
    for (let sub = paths.length - 1; sub >= 0; sub--) {
      if (paths[sub].closed || !paths[sub].anchors.length) continue;
      const index = paths[sub].anchors.length - 1;
      return { ref: { sub, index }, running: runningIndex(paths, sub, index) };
    }
    return null;
  };

  /** Clicking an anchor with the pen either closes the path or re-aims it. */
  const penAtAnchor = (at: Located, running: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const path = paths[at.sub];
    const end = growingEnd();
    if (
      end &&
      end.ref.sub === at.sub &&
      end.ref.index !== at.index &&
      isEndpoint(path, at.index) &&
      path.anchors.length > 2
    ) {
      const next = clonePaths(paths);
      next[at.sub].closed = true;
      write(next);
      setSelected([]);
      setTool('move');
      return;
    }
    setSelected([running]);
  };

  /** Clicking empty space with the pen extends the path from its loose end. */
  const penExtend = (event: React.PointerEvent, end: { ref: AnchorRef; running: number }) => {
    const local = toLocal(event.clientX, event.clientY);
    const point = { x: Math.round(local.x), y: Math.round(local.y) };
    const head = end.ref.index === 0;
    const grown = clonePaths(paths);
    const anchors = grown[end.ref.sub].anchors;
    if (head) anchors.unshift({ x: point.x, y: point.y, in: null, out: null });
    else anchors.push({ x: point.x, y: point.y, in: null, out: null });
    const placed = head ? 0 : anchors.length - 1;

    write(grown);
    setSelected([runningIndex(grown, end.ref.sub, placed)]);

    // dragging away from the point you just placed pulls its handles out, the
    // way every pen tool works: release without moving and it stays a corner
    dragPoints(event, (dx, dy) => {
      const next = clonePaths(grown);
      const anchor = next[end.ref.sub].anchors[placed];
      next[end.ref.sub].anchors[placed] = { ...anchor, out: [dx, dy], in: [-dx, -dy] };
      return next;
    });
  };

  // ── The empty canvas ────────────────────────────────────────────────────

  /** Every anchor whose screen position falls inside a screen-space polygon. */
  const anchorsInside = (polygon: [number, number][]): number[] =>
    points
      .map((located, running) => ({ located, running }))
      .filter(({ located }) => {
        const at = toScreenPoint(located.anchor.x, located.anchor.y);
        let hit = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const [xi, yi] = polygon[i];
          const [xj, yj] = polygon[j];
          const straddles = yi > at.y !== yj > at.y;
          if (straddles && at.x < ((xj - xi) * (at.y - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      })
      .map(({ running }) => running);

  const onBackgroundDown = (event: React.PointerEvent) => {
    // panning, the context menu and the middle button all belong to the canvas
    if (event.button !== 0 || useUI.getState().spacePan || tool === 'pan') return;

    if (tool === 'pen') {
      const end = growingEnd();
      // nothing to grow from: let the canvas start a fresh path instead
      if (!end) return;
      event.stopPropagation();
      penExtend(event, end);
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const base = containerRef.current!.getBoundingClientRect();
    const from = { x: event.clientX - base.left, y: event.clientY - base.top };
    const additive = event.shiftKey;
    const before = selected;
    let moved = false;

    if (vectorTool === 'paint') {
      paintAt(toLocal(event.clientX, event.clientY), event.altKey);
      return;
    }
    if (vectorTool === 'builder') {
      buildFrom(event, toLocal(event.clientX, event.clientY));
      return;
    }

    // ── Lasso: a freehand ring, and everything caught inside it ───────────
    if (vectorTool === 'lasso') {
      const trail: [number, number][] = [[from.x, from.y]];
      const move = (e: PointerEvent) => {
        trail.push([e.clientX - base.left, e.clientY - base.top]);
        setLasso([...trail]);
        setSelected(
          additive
            ? [...new Set([...before, ...anchorsInside(trail)])]
            : anchorsInside(trail),
        );
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setLasso(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // ── Marquee ──────────────────────────────────────────────────────────
    const move = (e: PointerEvent) => {
      const to = { x: e.clientX - base.left, y: e.clientY - base.top };
      if (!moved && Math.hypot(to.x - from.x, to.y - from.y) < DRAG_SLOP) return;
      moved = true;
      setBand({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      const box: [number, number][] = [
        [from.x, from.y],
        [to.x, from.y],
        [to.x, to.y],
        [from.x, to.y],
      ];
      const inside = anchorsInside(box);
      setSelected(additive ? [...new Set([...before, ...inside])] : inside);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBand(null);
      if (moved) return;
      // a plain click: inside the shape it drops the point selection, outside
      // it leaves the mode — the same two steps out Figma gives you
      const outside =
        from.x < rect.x - 8 ||
        from.x > rect.x + rect.w + 8 ||
        from.y < rect.y - 8 ||
        from.y > rect.y + rect.h + 8;
      if (outside) setVectorEdit(null);
      else setSelected([]);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Chrome ──────────────────────────────────────────────────────────────

  const d = pathFromSubpaths(paths, smooth);
  const boxWidth = Math.max(node.w, 1);
  const boxHeight = Math.max(node.h, 1);
  // the outline is drawn in the node's own box and then turned the same way the
  // node is, rather than in the axis-aligned box the browser measured
  const transforms = [
    node.rotation ? `rotate(${node.rotation}deg)` : '',
    node.flipH ? 'scaleX(-1)' : '',
    node.flipV ? 'scaleY(-1)' : '',
  ].filter(Boolean);
  const outlineStyle: React.CSSProperties = {
    position: 'absolute',
    left: cx - (node.w * zoom) / 2,
    top: cy - (node.h * zoom) / 2,
    width: Math.max(node.w * zoom, 1),
    height: Math.max(node.h * zoom, 1),
    overflow: 'visible',
    transform: transforms.length ? transforms.join(' ') : undefined,
  };
  /** The stroke width a point carries, falling back to the layer's own. */
  const widthAt = (anchor: Anchor) => Math.max(anchor.width ?? node.border?.width ?? 1, 1);
  const end = tool === 'pen' ? growingEnd() : null;
  const endPoint = end ? paths[end.ref.sub]?.anchors[end.ref.index] : null;
  const hatchId = `vec-hatch-${id}`;
  // what the region tools are about to act on: everything picked, or whatever
  // the pointer is over
  const highlighted = picked.length
    ? picked.map((at) => regions[at]).filter(Boolean)
    : overRegion >= 0 && regions[overRegion]
      ? [regions[overRegion]]
      : [];
  const cursor = CURSORS[tool === 'pen' ? 'pen' : vectorTool];

  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 24, pointerEvents: 'none' }}
      data-vector-edit={id}
    >
      {/* the empty canvas: marquee, lasso, pen clicks, and the way back out */}
      <div
        data-vector-background=""
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor }}
        onPointerDown={onBackgroundDown}
        onPointerMove={(e) => {
          if (wantsRegions) {
            const point = toLocal(e.clientX, e.clientY);
            setOverRegion(regionAt(regions, [point.x, point.y]));
          } else if (overRegion !== -1) setOverRegion(-1);
          if (tool !== 'pen' || !endPoint) return;
          setGhost(toLocal(e.clientX, e.clientY));
        }}
        onPointerLeave={() => {
          setGhost(null);
          setOverRegion(-1);
        }}
      />

      {/* the path itself, hatched inside the way Figma hatches an open shape */}
      <svg
        style={{ ...outlineStyle, pointerEvents: 'none' }}
        viewBox={`0 0 ${boxWidth} ${boxHeight}`}
        preserveAspectRatio="none"
      >
        <defs>
          <pattern
            id={hatchId}
            width={7}
            height={7}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={7}
              stroke="var(--color-select-line)"
              strokeWidth={1.6}
              opacity={0.45}
            />
          </pattern>
        </defs>
        {paths.some((path) => path.closed) && (
          <path d={d} fill={`url(#${hatchId})`} fillRule="evenodd" stroke="none" />
        )}
        {/* Paint and the shape builder both act on a region, so the region has
            to be visible before you commit to it. */}
        {highlighted.map((entry, at) => (
          <path
            key={at}
            d={entry.d}
            fill="var(--color-select-line)"
            fillRule="evenodd"
            fillOpacity={0.22}
            stroke="none"
          />
        ))}
        <path
          d={d}
          fill="none"
          stroke="var(--color-select-line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {/* where the pen would put the next point */}
        {endPoint && ghost && (
          <path
            d={`M ${endPoint.x} ${endPoint.y} L ${ghost.x} ${ghost.y}`}
            fill="none"
            stroke="var(--color-select-line)"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* A wide invisible copy of the path: what a bend, a cut or a click hits.
          Only the stroke takes the pointer — an `<svg>` is an ordinary box for
          hit testing, so leaving it hittable would put an invisible sheet over
          the whole shape and swallow every marquee and paint click inside it. */}
      <svg
        style={{ ...outlineStyle, pointerEvents: 'none' }}
        viewBox={`0 0 ${boxWidth} ${boxHeight}`}
        preserveAspectRatio="none"
        onPointerDown={onSegmentDown}
      >
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={10}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          style={{ cursor }}
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
            {/* Variable width has to be visible to be aimable: each point wears
                the thickness it carries while the tool is on. */}
            {vectorTool === 'width' && (
              <div
                style={{
                  position: 'absolute',
                  left: point.x - (widthAt(anchor) * zoom) / 2,
                  top: point.y - (widthAt(anchor) * zoom) / 2,
                  width: widthAt(anchor) * zoom,
                  height: widthAt(anchor) * zoom,
                  borderRadius: '50%',
                  border: '1px dashed var(--color-select-line)',
                  opacity: 0.7,
                  pointerEvents: 'none',
                }}
              />
            )}
            <div
              data-vector-anchor={running}
              onPointerDown={(event) => moveAnchor(located, running, event)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleCorner(located);
              }}
              title={
                isCorner(anchor)
                  ? 'Corner point — ⌥ or double click to smooth'
                  : 'Smooth point — ⌥ or double click to corner'
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
                cursor,
              }}
            />
          </div>
        );
      })}

      {band && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(band.x1, band.x2),
            top: Math.min(band.y1, band.y2),
            width: Math.abs(band.x2 - band.x1),
            height: Math.abs(band.y2 - band.y1),
            border: '1px solid var(--color-select-line)',
            background: 'rgba(13,153,255,0.08)',
            pointerEvents: 'none',
          }}
        />
      )}

      {lasso && lasso.length > 1 && (
        <svg
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          <path
            d={`M ${lasso.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`}
            fill="rgba(13,153,255,0.08)"
            stroke="var(--color-select-line)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </svg>
      )}

      <VectorToolbar
        tool={vectorTool}
        onTool={(next) => {
          setVectorTool(next);
          if (useUI.getState().tool !== 'move') setTool('move');
        }}
        onDone={() => setVectorEdit(null)}
      />
    </div>
  );
}

/** What the pointer looks like under each sub-tool. */
const CURSORS: Record<VectorTool | 'pen', string> = {
  move: 'default',
  lasso: 'crosshair',
  paint: 'cell',
  bend: 'crosshair',
  cut: 'crosshair',
  erase: 'crosshair',
  builder: 'default',
  width: 'ew-resize',
  pen: 'crosshair',
};

// ── The toolbar ───────────────────────────────────────────────────────────

const glyph = (children: React.ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    {children}
  </svg>
);

const VECTOR_ICONS: Record<Exclude<VectorTool, 'builder' | 'width'>, React.ReactNode> = {
  move: glyph(
    <>
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </>,
  ),
  lasso: glyph(
    <path
      d="M8 2.5c3 0 5.5 1.6 5.5 3.8S11 10 8 10 2.5 8.5 2.5 6.3 5 2.5 8 2.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeDasharray="2 1.6"
    />,
  ),
  paint: glyph(
    <>
      <path d="M6 2.5 12.5 9l-5 4.5L2 8l4-5.5Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8h10.5" stroke="currentColor" strokeWidth="1.2" />
    </>,
  ),
  bend: glyph(
    <path d="M3 13C3 6 7 3 13 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />,
  ),
  cut: glyph(
    <>
      <path d="M4 3l8 9M12 3l-8 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="3.5" cy="13" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12.5" cy="13" r="1.4" stroke="currentColor" strokeWidth="1.1" />
    </>,
  ),
  erase: glyph(
    <>
      <path d="M9.5 3 13 6.5 7 12.5H3.5L9.5 3Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 6.5 9.5 10" stroke="currentColor" strokeWidth="1.2" />
    </>,
  ),
};

const MAIN_TOOLS: { tool: Exclude<VectorTool, 'builder' | 'width'>; label: string }[] = [
  { tool: 'move', label: 'Move' },
  { tool: 'lasso', label: 'Lasso' },
  { tool: 'paint', label: 'Paint' },
  { tool: 'bend', label: 'Bend' },
  { tool: 'cut', label: 'Cut' },
  { tool: 'erase', label: 'Erase' },
];

/**
 * Figma's vector toolbar.
 *
 * It floats over the bottom of the canvas while the mode is on and disappears
 * with it — the mode has no other affordance, so this bar is also the answer to
 * "what am I in, and how do I get out".
 */
function VectorToolbar({
  tool,
  onTool,
  onDone,
}: {
  tool: VectorTool;
  onTool: (tool: VectorTool) => void;
  onDone: () => void;
}) {
  const [more, setMore] = useState(false);

  return (
    <div className="vec-bar" onPointerDown={(e) => e.stopPropagation()}>
      {MAIN_TOOLS.map((entry) => (
        <button
          key={entry.tool}
          type="button"
          className="vec-tool"
          data-on={tool === entry.tool ? 'true' : undefined}
          title={entry.label}
          onClick={() => onTool(entry.tool)}
        >
          {VECTOR_ICONS[entry.tool]}
          <span>{entry.label}</span>
        </button>
      ))}

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="vec-tool"
          data-on={tool === 'width' || tool === 'builder' ? 'true' : undefined}
          onClick={() => setMore((open) => !open)}
        >
          <span>More</span>
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
        {more && (
          <>
            {/* a menu you cannot dismiss by clicking away is a menu you are
                stuck in — the same catcher every other popover here uses */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1 }}
              onPointerDown={() => setMore(false)}
            />
            <div className="vec-more">
              <button
                type="button"
                onClick={() => {
                  setMore(false);
                  onTool('builder');
                }}
              >
                <span>Shape builder</span>
                <kbd>M</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMore(false);
                  onTool('width');
                }}
              >
                <span>Variable width</span>
                <kbd>⇧W</kbd>
              </button>
            </div>
          </>
        )}
      </div>

      <button type="button" className="vec-tool vec-close" title="Done  ⏎" onClick={onDone}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
      </button>
    </div>
  );
}
