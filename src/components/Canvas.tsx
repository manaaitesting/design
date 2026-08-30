'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeView } from './NodeView';
import { Overlay, SIZE_BADGE } from './Overlay';
import { Cursors } from './Cursors';
import { Connections } from './Connections';
import {
  anchorBounds,
  canEditPoints,
  cloneAnchor,
  pathFromAnchors,
  type Anchor,
} from '../document/geometry';
import { withAlpha } from '../document/css';
import { Annotations } from './Annotations';
import { PixelPreview } from './PixelPreview';
import { anchorIn, CommentComposer, Comments } from './Comments';
import { CursorChat } from './CursorChat';
import { FollowLayer } from './Follow';
import { Measure } from './Measure';
import { Rulers } from './Rulers';
import { VectorEdit } from './VectorEdit';
import { CanvasMotion } from './MotionStyle';
import { useDoc, useSession, useStore, useTokenVars } from './Session';
import type { Comment, DocStore } from '../document/store';
import { ZOOM, toScreen, toWorld, useUI, type Tool } from '../state/ui';
import { descendants, isInFlow, ROOT_ID, type Doc, type NodeType, type SceneNode } from '../document/types';
import { snap, snapCandidates } from '../document/snapping';
import { fitOnCanvas, imageFilesFrom, readImageFile, type LoadedImage } from '../lib/images';
import { ARROW, CROSSHAIR } from '../lib/cursors';
import {
  hitStack,
  isLocked,
  lockedUnder,
  nodesInBox,
  resolveClick,
  resolveDoubleClick,
} from '../document/selection';

const DRAW_TOOLS: Partial<Record<Tool, NodeType>> = {
  frame: 'frame',
  section: 'section',
  rect: 'rect',
  ellipse: 'ellipse',
  polygon: 'polygon',
  star: 'star',
  slice: 'slice',
  text: 'text',
};

/** Tools whose drag is two endpoints rather than a box. */
const SEGMENT_TOOLS: Partial<Record<Tool, NodeType>> = {
  line: 'line',
  arrow: 'arrow',
};



interface Draft {
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snaps a drag to the nearest 45°, which is what ⇧ means on a line. */
function constrain45(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * The box a draw gesture is describing, with Figma's two modifiers applied.
 *
 * ⇧ constrains it to 1:1 — a square, a circle — by taking whichever axis you
 * pulled furthest along, so the shape follows the gesture rather than snapping
 * to the smaller of the two. ⌥ reads the press as the *centre* instead of a
 * corner, so the box grows both ways at once. Together they give a centred
 * square, which is the pair everyone uses to drop a circle on a point.
 */
function drawBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  square: boolean,
  fromCentre: boolean,
): { x: number; y: number; w: number; h: number } {
  let w = Math.abs(to.x - from.x);
  let h = Math.abs(to.y - from.y);
  if (square) w = h = Math.max(w, h);
  if (fromCentre) return { x: from.x - w, y: from.y - h, w: w * 2, h: h * 2 };
  return {
    x: to.x < from.x ? from.x - w : from.x,
    y: to.y < from.y ? from.y - h : from.y,
    w,
    h,
  };
}

/** Dragging a flex child moves the container it flows inside, not the child. */
function draggableTarget(id: string, doc: Doc): string {
  let current: SceneNode | undefined = doc[id];
  while (current && isInFlow(current, doc)) current = doc[current.parent!];
  return current?.id ?? id;
}

export function Canvas() {
  const store = useStore();
  const doc = useDoc();
  const { provider } = useSession();

  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  /** true only while a pan drag is running, for the closed-hand cursor */
  const [panning, setPanning] = useState(false);
  /** true while a shape is being drawn, so Space moves the box instead of panning */
  const drawing = useRef(false);
  const setTool = useUI((s) => s.setTool);
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const toggle = useUI((s) => s.toggle);
  const viewport = useUI((s) => s.viewport);
  const setViewport = useUI((s) => s.setViewport);
  const setEditing = useUI((s) => s.setEditing);
  const setContextMenu = useUI((s) => s.setContextMenu);
  const setHover = useUI((s) => s.setHover);
  const entered = useUI((s) => s.entered);
  const prototyping = useUI((s) => s.inspectorTab === 'prototype');
  const setEntered = useUI((s) => s.setEntered);
  const setGuides = useUI((s) => s.setGuides);
  const setDropTarget = useUI((s) => s.setDropTarget);
  const rulers = useUI((s) => s.rulers);
  const pixelPreview = useUI((s) => s.view.pixelPreview);
  const vectorEdit = useUI((s) => s.vectorEdit);
  const setVectorEdit = useUI((s) => s.setVectorEdit);
  const cropping = useUI((s) => s.cropping);
  const setCropping = useUI((s) => s.setCropping);

  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Draft | null>(null);


  /** in-progress pen path, in world coordinates */
  const [pen, setPen] = useState<Anchor[]>([]);
  const [penCursor, setPenCursor] = useState<[number, number] | null>(null);
  const [composing, setComposing] = useState<{ x: number; y: number; anchor?: Comment['anchor'] } | null>(null);

  const pageId = useUI((s) => s.page);
  const page = doc[pageId] ?? doc[ROOT_ID];
  const tokenVars = useTokenVars();
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Images picked but not yet put down.
   *
   * Figma hands a placed image to the cursor and waits for a click, so the
   * picture lands where you meant rather than wherever the view happened to be
   * centred. Holding the files here is the whole of that.
   */
  const [placing, setPlacing] = useState<LoadedImage[] | null>(null);

  const complain = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : 'Could not add that image.');
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  /**
   * Decodes the files now, whatever happens to them later.
   *
   * A picked file is read from an `<input>` that is never in the document, and
   * once that element is collected the browser is free to let go of the bytes
   * behind it. Anything that holds a file across a gesture has to hold the
   * decoded image instead.
   */
  const loadImages = useCallback(
    async (files: File[]): Promise<LoadedImage[]> => {
      const loaded: LoadedImage[] = [];
      for (const file of files) {
        try {
          loaded.push(await readImageFile(file));
        } catch (error) {
          complain(error);
        }
      }
      return loaded;
    },
    [complain],
  );

  /** Puts already-decoded images on the canvas as real image nodes. */
  const dropImages = useCallback(
    (images: LoadedImage[], at: { x: number; y: number }) => {
      let offset = 0;
      for (const image of images) {
        const box = fitOnCanvas(image.width, image.height);
        const id = store.create('image', useUI.getState().page, {
          name: image.name,
          x: Math.round(at.x + offset),
          y: Math.round(at.y + offset),
          ...box,
          fill: `url(${image.src})`,
        });
        select([id]);
        offset += 24;
      }
    },
    [store, select],
  );

  /** Places dropped or pasted images as real image nodes at a world point. */
  const placeImages = useCallback(
    async (files: File[], at: { x: number; y: number }) => {
      dropImages(await loadImages(files), at);
    },
    [loadImages, dropImages],
  );

  // paste an image straight onto the canvas
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      const rect = rootRef.current?.getBoundingClientRect();
      const vp = useUI.getState().viewport;
      const centre = rect
        ? toWorld(vp, rect.width / 2, rect.height / 2)
        : { x: 0, y: 0 };
      void placeImages(files, centre);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [placeImages]);

  // ── ⇧⌘K — Figma's Place image ─────────────────────────────────────────
  // The picker is the whole of it: there is no other way to reach a file from
  // the keyboard, and drop and paste already share the code that places one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.shiftKey || event.code !== 'KeyK') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) return;
        // decoded now, placed later: the image goes on the cursor, and the next
        // click on the canvas puts it down
        void loadImages(files).then((images) => {
          if (images.length) setPlacing(images);
        });
      };
      input.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadImages]);

  // Escape puts the picked image down again without placing it, the way it
  // cancels every other armed gesture here.
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlacing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  // ── Zoom & pan ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      if (event.ctrlKey || event.metaKey) {
        setViewport((vp) => {
          const factor = Math.exp(-event.deltaY * 0.01);
          const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, vp.zoom * factor));
          const scale = zoom / vp.zoom;
          // keep the point under the cursor pinned
          return { zoom, x: px - (px - vp.x) * scale, y: py - (py - vp.y) * scale };
        });
      } else if (event.shiftKey) {
        // ⇧ turns the wheel sideways. A trackpad sends deltaX of its own, but a
        // wheel mouse has only one axis, and this is the whole of its
        // horizontal pan — without it the canvas can only be scrolled up.
        setViewport((vp) => ({ ...vp, x: vp.x - (event.deltaX || event.deltaY) }));
      } else {
        setViewport((vp) => ({ ...vp, x: vp.x - event.deltaX, y: vp.y - event.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  // ── Space-to-pan ───────────────────────────────────────────────────────
  // Holding Space *is* the hand tool, so it lights the Hand button in the rail
  // and takes the grab cursor for as long as the key is down — rather than
  // quietly changing behaviour while the toolbar still says Move.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || takesSpace(e.target)) return;
      // Space scrolls the page when nothing claims it, so the canvas claims it
      // — but only once the guard above has ruled out everything it belongs to.
      e.preventDefault();
      if (e.repeat) return;
      // A draw in progress owns Space before anything else: there it moves the
      // shape being drawn, and lighting the hand tool — or starting playback —
      // underneath it would say the wrong thing.
      if (drawing.current) return;
      // Otherwise, while a timeline is open Space is the transport — Figma's
      // binding, and the one your hands expect the moment there is something to
      // play. The hand tool is still on H, and a middle-drag still pans.
      const ui = useUI.getState();
      if (ui.motion.frame) {
        ui.setMotionPlaying(!ui.motion.playing);
        return;
      }
      ui.setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') useUI.getState().setSpacePan(false);
    };
    // Releasing the key over another window never reaches us, and the canvas
    // would be left panning with a grab cursor and no way to clear it.
    const reset = () => useUI.getState().setSpacePan(false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, []);

  // ── ⌥ measures ─────────────────────────────────────────────────────────
  // Tracked on the window rather than on pointer events: the readout has to
  // appear the moment the key goes down, not on the next mouse move.
  useEffect(() => {
    // the Measure tool is the same readout, latched on — Figma offers both
    const sync = (event: KeyboardEvent) =>
      useUI.getState().setMeasuring(event.altKey || useUI.getState().tool === 'measure');
    const clear = () => useUI.getState().setMeasuring(useUI.getState().tool === 'measure');
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // ── Presence cursor ────────────────────────────────────────────────────
  const publishCursor = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const world = toWorld(useUI.getState().viewport, clientX - rect.left, clientY - rect.top);
      provider.awareness.setLocalStateField('cursor', world);
    },
    [provider],
  );

  useEffect(() => {
    provider.awareness.setLocalStateField('selection', selection);
  }, [provider, selection]);

  /** Turns the in-progress anchors into a vector node. */
  const commitPen = useCallback(
    (anchors: Anchor[], closed: boolean) => {
      setPen([]);
      setPenCursor(null);
      if (anchors.length < 2) return;

      const box = anchorBounds(anchors);
      if (!box) return;
      const width = Math.max(1, Math.round(box.maxX - box.minX));
      const height = Math.max(1, Math.round(box.maxY - box.minY));

      const id = store.create('vector', page.id, {
        x: Math.round(box.minX),
        y: Math.round(box.minY),
        w: width,
        h: height,
        closed,
        // the path is stored relative to its own box, so moving the layer is
        // one x/y write rather than a rewrite of every anchor
        anchors: anchors.map((anchor) => ({
          ...cloneAnchor(anchor),
          x: anchor.x - box.minX,
          y: anchor.y - box.minY,
        })),
      });
      // a finished path is the new selection, and whatever path was open for
      // point editing is not it
      useUI.getState().setVectorEdit(null);
      select([id]);
      setTool('move');
    },
    [store, page, select, setTool],
  );

  /**
   * Leaving the pen finishes the path rather than throwing it away.
   *
   * Figma's pen has the layer on the document from the first segment, so
   * picking up another tool leaves what you drew standing. Here the anchors
   * live in React state until they are committed, and a tool change used to
   * drop them on the floor with no undo to reach them — the same for Escape
   * below. Both finish now. Anything shorter than two points is not a path and
   * is dropped, which is what `commitPen` already decides.
   */
  const penRef = useRef<Anchor[]>([]);
  penRef.current = pen;
  useEffect(() => {
    if (tool === 'pen') return;
    const drawn = penRef.current;
    if (drawn.length >= 2) commitPen(drawn, false);
    else {
      setPen((points) => (points.length ? [] : points));
      setPenCursor((cursor) => (cursor ? null : cursor));
    }
    // `commitPen` sets the tool, which would re-enter this effect; the ref is
    // how the finish reads the path without making the effect chase it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useEffect(() => {
    if (tool !== 'pen') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPen(pen, false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // Escape ends the path, as ⏎ does — in Figma it stops drawing, it does
        // not undraw. Only an empty one goes away with nothing left behind.
        if (pen.length >= 2) commitPen(pen, false);
        else {
          setPen([]);
          setPenCursor(null);
          setTool('move');
        }
      } else if (event.key === 'Backspace' && pen.length) {
        event.preventDefault();
        setPen((points) => points.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, pen, commitPen, setTool]);

  /**
   * Outlines the frame a release here would drop into, while you are still
   * holding the layer.
   *
   * Reparenting is decided at pointer-up and rewrites the tree silently, so
   * without this the only way to learn that a card adopted the layer is to
   * move the card later and find the layer coming with it. A target the layer
   * is already inside says nothing, so it draws nothing.
   */
  const markDropTarget = (e: PointerEvent, ids: string[], snapshot: Doc) => {
    const skip = new Set(ids.flatMap((id) => [id, ...descendants(id, snapshot)]));
    const found = containerAt(e.clientX, e.clientY, snapshot, skip);
    const next = found && found !== snapshot[ids[0]]?.parent ? found : null;
    const target = next ? snapshot[next] : null;
    const slot = target?.flex ? flowSlotAt(target, ids, e.clientX, e.clientY) : null;
    const line =
      slot && target
        ? flowSlotRect(target, ids, slot.position, rootRef.current!.getBoundingClientRect())
        : null;
    const now = useUI.getState();
    if (now.dropTarget === next && sameRect(now.dropSlot, line)) return;
    setDropTarget(next, line);
  };

  // ── Pointer interactions ───────────────────────────────────────────────
  const onPointerDown = (event: React.PointerEvent) => {
    // whatever chrome button was last clicked still holds focus, and with it
    // Space; a press on the canvas is the moment the canvas takes both back
    if (rootRef.current && !rootRef.current.contains(document.activeElement)) {
      rootRef.current.focus({ preventScroll: true });
    }
    if (event.button === 2) return;
    const rect = rootRef.current!.getBoundingClientRect();
    const vp = useUI.getState().viewport;
    const startScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const start = toWorld(vp, startScreen.x, startScreen.y);

    // An image waiting on the cursor is put down here, before any tool gets a
    // look at the pointer — that press is the placement, not a selection.
    if (placing) {
      dropImages(placing, { x: Math.round(start.x), y: Math.round(start.y) });
      setPlacing(null);
      return;
    }

    // Panning wins over everything
    if (tool === 'pan' || useUI.getState().spacePan || event.button === 1) {
      const origin = { ...vp };
      setPanning(true);
      drag(
        store,
        event,
        (e) => {
          setViewport({
            ...origin,
            x: origin.x + (e.clientX - event.clientX),
            y: origin.y + (e.clientY - event.clientY),
          });
        },
        () => setPanning(false),
      );
      return;
    }

    if (tool === 'comment') {
      // a remark is about something: the pin holds the layer under the click,
      // and where in it, so it travels when that layer does
      setComposing({
        x: Math.round(start.x),
        y: Math.round(start.y),
        anchor: anchorIn(hitStack(event.clientX, event.clientY, doc)[0], event.clientX, event.clientY),
      });
      return;
    }

    // the Annotate tool: click a layer to pin a note to it, then write the note
    // in Inspect, which is where the notes are read
    if (tool === 'annotate') {
      const hit = hitStack(event.clientX, event.clientY, doc)[0];
      if (hit) {
        const node = doc[hit];
        store.update(hit, {
          annotations: [
            ...(node?.annotations ?? []),
            { id: Math.random().toString(36).slice(2, 8), note: '' },
          ],
        });
        select([hit]);
        useUI.getState().setInspectorTab('inspect');
      }
      setTool('move');
      return;
    }

    if (tool === 'pen') {
      // ⇧ holds the next point to 45° from the last one, which is how every
      // straight and diagonal run gets drawn. `constrain45` is the same one the
      // line and arrow tools use, twenty lines below.
      const held =
        event.shiftKey && pen.length ? constrain45(pen[pen.length - 1], start) : start;
      const point = { x: Math.round(held.x), y: Math.round(held.y) };
      // clicking back on the first point closes the shape
      if (pen.length > 2) {
        const first = pen[0];
        if (Math.hypot(point.x - first.x, point.y - first.y) * vp.zoom < 10) {
          commitPen(pen, true);
          return;
        }
      }
      const index = pen.length;
      setPen((anchors) => [...anchors, { x: point.x, y: point.y }]);
      // Dragging away from a freshly placed point pulls its handles out, the
      // way every pen tool works: release without moving and it stays a corner.
      drag(store, event, (e) => {
        const world = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
        const pulled = e.shiftKey ? constrain45(point, world) : world;
        const dx = pulled.x - point.x;
        const dy = pulled.y - point.y;
        if (Math.hypot(dx, dy) * vp.zoom < 3) return;
        setPen((anchors) =>
          anchors.map((anchor, i) =>
            i === index
              ? // ⌥ breaks the mirror, so the segment leaving the point can head
                // somewhere else than the one arriving at it — the same trade
                // `moveHandle` makes in point editing
                { ...anchor, out: [dx, dy], in: e.altKey ? anchor.in : [-dx, -dy] }
              : anchor,
          ),
        );
      });
      return;
    }

    // ── Line and arrow: a drag is two endpoints, not a box ────────────────
    const segmentType = SEGMENT_TOOLS[tool];
    if (segmentType) {
      let end = { x: start.x, y: start.y };
      drag(
        store,
        event,
        (e) => {
          const current = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
          // ⇧ constrains to 45°, as it does everywhere else
          end = e.shiftKey ? constrain45(start, current) : current;
          setDraft({
            type: segmentType,
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.abs(end.x - start.x),
            h: Math.abs(end.y - start.y),
          });
        },
        () => {
          setDraft(null);
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          if (Math.hypot(dx, dy) < 2) return;
          const id = store.create(segmentType, page.id, {
            x: Math.round(Math.min(start.x, end.x)),
            y: Math.round(Math.min(start.y, end.y)),
            w: Math.round(Math.abs(dx)),
            h: Math.round(Math.abs(dy)),
            // the geometry runs top-left to bottom-right; a flip is what points
            // it the other way without a second set of coordinates
            flipH: dx < 0,
            flipV: dy < 0,
          });
          select([id]);
          setTool('move');
        },
      );
      return;
    }

    const drawType = DRAW_TOOLS[tool];
    if (drawType) {
      // the live box lives in this closure — React state only mirrors it for
      // the preview, and would lag behind a fast drag
      let box: Draft | null = null;
      let origin = start;
      let last = start;
      let square = false;
      let centred = false;
      let spacing = false;
      /** where the pointer was released, for a box Space has walked away */
      let released: { x: number; y: number } | null = null;

      const paint = () => {
        box = { type: drawType, ...drawBox(origin, last, square, centred) };
        setDraft(box);
      };

      // ⇧, ⌥ and Space are read off the window as well as off the pointer,
      // because Figma answers them the moment you press one — waiting for the
      // next mouse move would leave the shape wrong for as long as you held
      // still, which is most of the time: you reach for ⇧ *after* the size is
      // roughly right.
      const onModifier = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          // Space picks the box up and puts it down again wherever you let go
          e.preventDefault();
          spacing = e.type === 'keydown';
          return;
        }
        if (e.shiftKey === square && e.altKey === centred) return;
        square = e.shiftKey;
        centred = e.altKey;
        if (box) paint();
      };
      window.addEventListener('keydown', onModifier);
      window.addEventListener('keyup', onModifier);
      drawing.current = true;
      const stopModifiers = () => {
        drawing.current = false;
        window.removeEventListener('keydown', onModifier);
        window.removeEventListener('keyup', onModifier);
      };

      drag(
        store,
        event,
        (e) => {
          const world = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
          if (spacing) {
            // the box keeps its size and travels: both ends move together
            origin = { x: origin.x + (world.x - last.x), y: origin.y + (world.y - last.y) };
            released = { x: e.clientX, y: e.clientY };
          }
          last = world;
          square = e.shiftKey;
          centred = e.altKey;
          paint();
        },
        () => {
          stopModifiers();
          const drawn = !!box && box.w > 4 && box.h > 4;
          const size = drawn
            ? box!
            : { x: origin.x, y: origin.y, w: drawType === 'text' ? 120 : 100, h: drawType === 'text' ? 24 : 100 };

          // the press decides which frame the shape lands in — unless Space
          // walked the box somewhere else, and then the release does
          const at = released ?? { x: event.clientX, y: event.clientY };
          const parentId = containerAt(at.x, at.y, doc) ?? page.id;
          const parent = doc[parentId];
          const local =
            parentId === page.id
              ? { x: Math.round(size.x), y: Math.round(size.y) }
              : localOffset(parentId, size.x, size.y, doc, rect, vp);

          const id = store.create(drawType, parentId, {
            x: local.x,
            y: local.y,
            w: Math.round(size.w),
            h: Math.round(size.h),
            ...(drawType === 'text'
              ? {
                  // A text dragged out is a column: Figma keeps the width you
                  // chose and leaves the height to the copy. Clicking still
                  // gives an auto-width layer that grows as you type.
                  wMode: drawn ? ('fixed' as const) : ('fit' as const),
                  hMode: 'fit' as const,
                  text: 'Text',
                }
              : null),
          });
          setDraft(null);
          // a section drawn over boards takes them in, which is what the tool
          // is for — you draw one around the work, not beside it
          if (drawType === 'section') store.adoptIntoSection(id);
          select([id]);
          setTool('move');
          if (drawType === 'text') setEditing(id);
        },
      );
      return;
    }

    // ── Cropping an image ────────────────────────────────────────────────
    // While a layer is in crop mode, a drag on it pans the picture behind the
    // box instead of moving the box — the same swap Figma makes.
    if (cropping && doc[cropping]) {
      const stack = hitStack(event.clientX, event.clientY, doc);
      if (stack.includes(cropping)) {
        const target = doc[cropping];
        // the cropped picture is whichever image paint is on top; a layer with
        // a paint stack keeps its settings on the paint, not on the layer
        const paint = target.fills?.find((entry) => /^url\(/.test(entry.value));
        const [ox, oy] = paint?.offset ?? target.imageOffset ?? [50, 50];
        const scale = paint?.scale ?? target.imageScale ?? 1;
        drag(
          store,
          event,
          (e) => {
            // a percentage offset moves the image by the slack between it and
            // the box, so the drag is scaled by how much bigger the image is
            const slack = Math.max(scale - 1, 0.01);
            const dx = ((e.clientX - event.clientX) / vp.zoom / target.w / slack) * 100;
            const dy = ((e.clientY - event.clientY) / vp.zoom / target.h / slack) * 100;
            const offset: [number, number] = [
              Math.round(Math.min(300, Math.max(-200, ox - dx))),
              Math.round(Math.min(300, Math.max(-200, oy - dy))),
            ];
            if (paint) {
              store.update(cropping, {
                fills: target.fills!.map((entry) =>
                  entry.id === paint.id ? { ...entry, offset } : entry,
                ),
              });
            } else {
              store.update(cropping, { imageOffset: offset });
            }
          },
        );
        return;
      }
      setCropping(null);
    }

    // ── Scale tool ───────────────────────────────────────────────────────
    if (tool === 'scale') {
      const stack = hitStack(event.clientX, event.clientY, doc);
      const resolved = resolveClick(stack, doc, entered, 'normal', selection);
      const ids = resolved
        ? selection.includes(resolved.id)
          ? selection
          : [resolved.id]
        : selection;
      if (!ids.length) return;
      if (resolved && !selection.includes(resolved.id)) select([resolved.id]);

      const anchorNode = doc[ids[0]];
      const origin = { x: anchorNode?.x ?? 0, y: anchorNode?.y ?? 0 };
      const base = Math.max(anchorNode?.w ?? 100, 1);
      // the document as it was when the gesture began: every frame scales this
      // rather than the result of the frame before it
      const baseline = store.getSnapshot();
      let applied = 1;

      drag(
        store,
        event,
        (e) => {
          // dragging right grows, left shrinks — measured against the layer's
          // own width so the gesture feels the same on a chip and on a board
          const factor = Math.max(0.05, 1 + (e.clientX - event.clientX) / vp.zoom / base);
          if (Math.abs(factor - applied) < 0.001) return;
          store.scaleNodes(ids, factor, origin, baseline);
          applied = factor;
        },
        () => setGuides([]),
      );
      return;
    }

    // ── Move tool ────────────────────────────────────────────────────────
    const stack = hitStack(event.clientX, event.clientY, doc);

    // A locked layer is invisible to hit-testing, which reads as "the app is
    // broken". Say what actually happened instead.
    if (!stack.length) {
      const locked = lockedUnder(event.clientX, event.clientY, doc);
      if (locked) {
        useUI.getState().setLockedHint(locked);
        window.setTimeout(() => {
          if (useUI.getState().lockedHint === locked) useUI.getState().setLockedHint(null);
        }, 1600);
      }
    }

    if (!stack.length) {
      // ⇧ makes a marquee additive, as it does everywhere else in Figma: what
      // it sweeps up joins the selection instead of replacing it
      const additive = event.shiftKey;
      const kept = additive ? [...selection] : [];
      if (!additive) {
        select([]);
        setEntered(null);
      }
      let box: Draft | null = null;
      drag(
        store,
        event,
        (e) => {
          const current = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
          box = {
            type: 'rect',
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            w: Math.abs(current.x - start.x),
            h: Math.abs(current.y - start.y),
          };
          setMarquee(box);
        },
        () => {
          const final = box;
          if (final && final.w > 3 && final.h > 3) {
            // marquee works at whatever level you're in, like Figma
            const level = entered && doc[entered] ? entered : page.id;
            // Measured, not read off the document. A node's x/y is local to its
            // parent while the marquee is in world coordinates, so comparing the
            // two picked the wrong layers the moment you had drilled into a
            // frame — and a hug-sized layer's stored size can lag what is on
            // screen in any case. The browser has already laid all of it out.
            const caught = marqueeIn(final, level, doc, rootRef.current!, useUI.getState().viewport);
            select(additive ? [...new Set([...kept, ...caught])] : caught);
          }
          setMarquee(null);
        },
      );
      return;
    }

    // ── A frame's own background ─────────────────────────────────────────
    // Figma's rule: if the frame is already selected, dragging its background
    // moves it; if it is not, dragging marquees what is inside it. A press that
    // never moves is a click either way, and a click picks the frame. This is
    // why a frame's name label matters — it is how you take hold of a board you
    // have not selected yet.
    const under = doc[stack[0]];
    const onBackground = !!under && (under.type === 'frame' || under.type === 'section');
    if (onBackground && !selection.includes(under.id) && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const container = under.id;
      const kept = event.shiftKey ? [...selection] : [];
      let box: Draft | null = null;
      drag(
        store,
        event,
        (e) => {
          const current = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
          box = {
            type: 'rect',
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            w: Math.abs(current.x - start.x),
            h: Math.abs(current.y - start.y),
          };
          setMarquee(box);
        },
        () => {
          const final = box;
          setMarquee(null);
          if (final && final.w > 3 && final.h > 3) {
            select([...new Set([...kept, ...marqueeIn(final, container, doc, rootRef.current!, vp)])]);
            // you are now working inside it, as you would be after drilling in
            setEntered(container);
            return;
          }
          // never moved: an ordinary click, which picks the board
          const clicked = resolveClick(stack, doc, entered, 'normal', selection);
          if (clicked) {
            select([clicked.id]);
            setEntered(clicked.entered);
          }
        },
      );
      return;
    }

    const resolved = resolveClick(
      stack,
      doc,
      entered,
      event.metaKey || event.ctrlKey ? 'deep' : 'normal',
      selection,
    );
    if (!resolved) return;
    const targetId = resolved.id;
    if (resolved.entered !== entered) setEntered(resolved.entered);

    // ⇧ on a layer means two things at once in Figma — add it to the selection,
    // and constrain the drag that follows to one axis — and the two are settled
    // by waiting, the same way a press inside a multi-selection is. A press that
    // never moves is a click and toggles; a press that becomes a drag moves what
    // is selected, held to the axis you pulled hardest along.
    const alreadyIn = selection.includes(targetId);
    /** a ⇧-click takes a selected layer back out, but only if it stayed a click */
    const untoggle = event.shiftKey && alreadyIn;

    let nextSelection = alreadyIn
      ? selection
      : event.shiftKey
        ? [...selection, targetId]
        : [targetId];
    if (!alreadyIn) select(nextSelection);

    // ⌥-drag leaves a copy behind and moves the duplicate, as in Figma
    if (event.altKey) {
      const copies = store.duplicate(nextSelection, 0);
      if (copies.length) {
        nextSelection = copies;
        select(copies);
      }
    }

    // ── Reordering inside an auto layout ─────────────────────────────────
    // A flowed child has no x/y of its own, so dragging it moves it among its
    // siblings. The reorder is applied live rather than previewed: the layout
    // reflowing under the pointer *is* Figma's insertion indicator, and drawing
    // a second one over a layout that had not moved would be the lie.
    const flowParent = nextSelection.length && doc[nextSelection[0]]
      ? doc[nextSelection[0]].parent
      : null;
    const reordering =
      !!flowParent &&
      nextSelection.every((id) => doc[id] && isInFlow(doc[id], doc) && doc[id].parent === flowParent);
    if (reordering) {
      const parentId = flowParent!;
      // moved as a block, in the order they are stacked, so a multi-selection
      // keeps its own order wherever it lands
      const kids = [...nextSelection].sort(
        (a, b) => doc[parentId].children.indexOf(a) - doc[parentId].children.indexOf(b),
      );
      let shifted = false;
      drag(
        store,
        event,
        (e) => {
          if (!shifted && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 3) return;
          shifted = true;
          const snapshot = store.getSnapshot();
          markDropTarget(e, kids, snapshot);
          const parent = snapshot[parentId];
          if (!parent?.flex) return;
          // outside the frame this is a drop, not a reorder — the release
          // handler below hands it to the same code the free canvas uses
          const slot = flowSlotAt(parent, kids, e.clientX, e.clientY);
          if (!slot) return;
          const others = parent.children.filter((id) => !kids.includes(id));
          const next = [...others.slice(0, slot.position), ...kids, ...others.slice(slot.position)];
          // the list already reads this way — a write here would be a no-op
          // that still costs every sibling a re-render
          if (next.join() === parent.children.join()) return;
          store.moveMany(kids, parentId, slot.index);
        },
        (e) => {
          setDropTarget(null);
          if (!shifted) {
            if (untoggle) toggle(targetId);
            return;
          }
          const now = store.getSnapshot();
          const skip = new Set(kids.flatMap((id) => [id, ...descendants(id, now)]));
          const target = containerAt(e.clientX, e.clientY, now, skip) ?? page.id;
          if (target === now[kids[0]]?.parent) return;
          dropInto(
            store,
            now,
            kids,
            target,
            page.id,
            rootRef.current!.getBoundingClientRect(),
            useUI.getState().viewport,
            { x: e.clientX, y: e.clientY },
          );
        },
      );
      return;
    }

    // Anything left flows only partly, or not at all: dragging it moves the
    // nearest absolutely-placed ancestor, while selection stays on the child.
    const movers = [...new Set(nextSelection.map((id) => draggableTarget(id, doc)))];
    // read positions from the live snapshot: duplicates were only just created
    const snapshot = store.getSnapshot();
    const origins = new Map(movers.map((id) => [id, { x: snapshot[id]?.x ?? 0, y: snapshot[id]?.y ?? 0 }]));

    // one node dragging alone gets edge/centre snapping against its siblings
    const lead = movers.length === 1 ? snapshot[movers[0]] : null;
    const candidates = lead?.parent ? snapCandidates(snapshot, movers, lead.parent) : [];
    // a guide dragged off the ruler snaps like any other edge
    if (lead?.parent === page.id) {
      for (const guide of snapshot[page.id]?.rulerGuides ?? []) {
        candidates.push(
          guide.axis === 'x'
            ? { x: guide.at, y: lead.y, w: 0, h: 0 }
            : { x: lead.x, y: guide.at, w: 0, h: 0 },
        );
      }
    }

    let moved = false;
    drag(
      store,
      event,
      (e) => {
        let dx = (e.clientX - event.clientX) / vp.zoom;
        let dy = (e.clientY - event.clientY) / vp.zoom;
        if (!moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
        moved = true;

        // ⇧ holds the drag to one axis — whichever you have pulled furthest
        // along, re-decided every move so a gesture that turns a corner follows.
        // Read live rather than off the press, because holding ⇧ part-way
        // through is how most people reach for it.
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }

        // ⌥ already means "duplicate on drag", so ⌘ is the ignore-snapping
        // modifier — same split as Figma
        if (lead && candidates.length && !e.metaKey && !e.ctrlKey) {
          const origin = origins.get(lead.id)!;
          const box = { x: origin.x + dx, y: origin.y + dy, w: lead.w, h: lead.h };
          // tolerance is in world units so it feels constant on screen
          const snapped = snap(box, candidates, 6 / vp.zoom);
          dx += snapped.x - box.x;
          dy += snapped.y - box.y;
          setGuides(snapped.guides);
        }

        // "Snap to pixel grid" is what makes a drag land on whole numbers;
        // with it off a layer can sit between pixels, as Figma allows
        const place = useUI.getState().view.snapToPixel
          ? Math.round
          : (value: number) => Math.round(value * 100) / 100;
        store.updateMany(movers, (n) => {
          const origin = origins.get(n.id)!;
          return { x: place(origin.x + dx), y: place(origin.y + dy) };
        });
        markDropTarget(e, movers, snapshot);
      },
      (e) => {
        setGuides([]);
        setDropTarget(null);
        // a click that never moved is a selection, not a drop
        if (!moved) {
          if (untoggle) toggle(targetId);
          return;
        }
        const now = store.getSnapshot();
        // the dragged layers are under the pointer for the whole gesture, so
        // they and everything inside them are invisible to the drop test
        const skip = new Set(movers.flatMap((id) => [id, ...descendants(id, now)]));
        const target = containerAt(e.clientX, e.clientY, now, skip) ?? page.id;
        dropInto(
          store,
          now,
          movers,
          target,
          page.id,
          rootRef.current!.getBoundingClientRect(),
          useUI.getState().viewport,
          { x: e.clientX, y: e.clientY },
        );
      },
    );
  };

  /** Double-click descends exactly one level, the way Figma does. */
  const onDoubleClick = (event: React.PointerEvent) => {
    if (tool === 'pen') {
      commitPen(pen, false);
      return;
    }
    const stack = hitStack(event.clientX, event.clientY, doc);
    const resolved = resolveDoubleClick(stack, doc, useUI.getState().selection);
    if (!resolved) return;

    select([resolved.id]);
    setEntered(resolved.entered);
    // a text layer you have reached is a text layer you want to edit
    const reached = doc[resolved.id];
    if (reached?.type === 'text') setEditing(resolved.id);
    // …and a shape you have reached is one you want to edit the points of.
    // Every shape qualifies, not only a vector: in Figma a double click opens a
    // rectangle's four corners just as readily, and it stays a rectangle until
    // you move one of them.
    else if (reached && canEditPoints(reached.type)) setVectorEdit(reached.id);
  };

  // a closed hand while the drag is actually moving the canvas, an open one
  // while it is only offered — the pair every canvas tool uses
  const cursor = placing
    ? CROSSHAIR
    : panning
    ? 'grabbing'
    : tool === 'pan' || spacePan
      ? 'grab'
      : DRAW_TOOLS[tool] || SEGMENT_TOOLS[tool] || tool === 'pen'
        ? CROSSHAIR
        : tool === 'comment'
          ? 'copy'
          : ARROW;

  return (
    <div
      ref={rootRef}
      data-canvas-root=""
      // an image is on the cursor, waiting for the click that puts it down
      data-placing={placing ? 'true' : undefined}
      // focusable so a click here takes focus off whatever chrome button had
      // it — otherwise Space stays with that button and never pans
      tabIndex={-1}
      // the exporter reads this to decide whether a slice comes out on the page
      // colour or on nothing — Figma's "Show in exports"
      data-export-background={page?.exportBackground === false ? 'off' : undefined}
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        background:
          page?.fillVisible === false
            ? 'transparent'
            : withAlpha(page?.fill ?? '#EEEEEE', page?.fillOpacity ?? 1),
        cursor,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick as unknown as React.MouseEventHandler}
      onPointerMove={(e) => {
        publishCursor(e.clientX, e.clientY);
        if (tool === 'pen' && pen.length) {
          const rect = rootRef.current!.getBoundingClientRect();
          const world = toWorld(useUI.getState().viewport, e.clientX - rect.left, e.clientY - rect.top);
          // the ghost segment is held to 45° too, or ⇧ would only take effect
          // at the moment of the press and the preview would have been lying
          const held = e.shiftKey ? constrain45(pen[pen.length - 1], world) : world;
          setPenCursor([held.x, held.y]);
        }
        const stack = hitStack(e.clientX, e.clientY, doc);
        const preview = resolveClick(stack, doc, entered, e.metaKey || e.ctrlKey ? 'deep' : 'normal', useUI.getState().selection);
        setHover(preview?.id ?? null);
      }}
      onPointerLeave={() => {
        provider.awareness.setLocalStateField('cursor', null);
        setHover(null);
      }}
      onDragOver={(e) => {
        const kinds = e.dataTransfer.types;
        if (!kinds.includes('Files') && !kinds.includes('application/x-paperlike-component')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const rect = rootRef.current!.getBoundingClientRect();
        const at = toWorld(useUI.getState().viewport, e.clientX - rect.left, e.clientY - rect.top);

        // a component dragged out of the Assets panel lands where it is dropped
        const mainId = e.dataTransfer.getData('application/x-paperlike-component');
        if (mainId) {
          e.preventDefault();
          const parentId = containerAt(e.clientX, e.clientY, doc) ?? page.id;
          const local =
            parentId === page.id
              ? { x: Math.round(at.x), y: Math.round(at.y) }
              : localOffset(parentId, at.x, at.y, doc, rect, useUI.getState().viewport);
          const id = store.createInstance(mainId, parentId, local);
          if (id) select([id]);
          return;
        }

        const files = imageFilesFrom(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        void placeImages(files, at);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const stack = hitStack(e.clientX, e.clientY, doc);
        const resolved = resolveClick(stack, doc, entered, 'normal', selection);
        if (resolved && !selection.includes(resolved.id)) select([resolved.id]);
        setContextMenu({ x: e.clientX, y: e.clientY, stack });
      }}
    >
      {/* The open timeline, as an animation on the layers it drives. The canvas
          renders the document unchanged — what the playhead shows is the
          browser interpolating between these keyframes, and moving it does not
          re-render anything here. */}
      <CanvasMotion />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          // pixel preview shows a raster of this instead; the stage stays in
          // the tree because every overlay measures against its elements
          visibility: pixelPreview === 'off' ? undefined : 'hidden',
          // theme tokens are CSS custom properties, so they cascade into every node
          ...(tokenVars as React.CSSProperties),
        }}
      >
        {(page?.children ?? []).map((id) => (
          <NodeView key={id} id={id} />
        ))}

        {draft && (
          <div
            style={{
              position: 'absolute',
              left: draft.x,
              top: draft.y,
              width: draft.w,
              height: draft.h,
              border: `${1 / viewport.zoom}px solid var(--color-select-line)`,
              background: 'rgba(59,130,246,0.06)',
              pointerEvents: 'none',
            }}
          />
        )}
        {pen.length > 0 && (
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 1,
              height: 1,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <path
              d={pathFromAnchors(
                penCursor ? [...pen, { x: penCursor[0], y: penCursor[1] }] : pen,
                false,
              )}
              fill="none"
              stroke="var(--color-select-line)"
              strokeWidth={1.5 / viewport.zoom}
            />
            {pen.map((anchor, index) => (
              <rect
                key={index}
                x={anchor.x - 3 / viewport.zoom}
                y={anchor.y - 3 / viewport.zoom}
                width={6 / viewport.zoom}
                height={6 / viewport.zoom}
                fill="#fff"
                stroke="var(--color-select-line)"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
          </svg>
        )}
        {marquee && (
          <div
            style={{
              position: 'absolute',
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              border: `${1 / viewport.zoom}px solid var(--color-select-line)`,
              background: 'rgba(59,130,246,0.08)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {draft && (draft.w > 0 || draft.h > 0) && (
        <span
          style={{
            ...SIZE_BADGE,
            left: toScreen(viewport, draft.x + draft.w / 2, draft.y).x,
            top: toScreen(viewport, draft.x, draft.y + draft.h).y + 6,
            zIndex: 20,
          }}
        >
          {Math.round(draft.w)} × {Math.round(draft.h)}
        </span>
      )}

      {dropping && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            border: '2px dashed var(--color-select)',
            borderRadius: 8,
            background: 'rgba(13,153,255,0.05)',
            pointerEvents: 'none',
            zIndex: 45,
          }}
        />
      )}

      {notice && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            maxWidth: 460,
            padding: '8px 12px',
            borderRadius: 6,
            background: '#111',
            color: '#fff',
            fontSize: 11,
            lineHeight: 1.45,
            zIndex: 60,
          }}
        >
          {notice}
        </div>
      )}

      <PixelPreview />
      <PixelGrid />
      {rulers && <Rulers containerRef={rootRef} />}
      <Overlay containerRef={rootRef} />
      <Measure containerRef={rootRef} />
      {vectorEdit && <VectorEdit containerRef={rootRef} />}
      {prototyping && <Connections containerRef={rootRef} />}
      <Annotations containerRef={rootRef} />
      <Comments containerRef={rootRef} />
      {composing && <CommentComposer at={composing} onDone={() => setComposing(null)} />}
      <Cursors containerRef={rootRef} />
      <FollowLayer containerRef={rootRef} />
      <CursorChat />
    </div>
  );
}

/**
 * Figma's pixel grid: the 1px lattice, drawn only once a pixel is big enough
 * to be worth seeing.
 *
 * Below 4× it would be a grey wash rather than a grid, which is why Figma
 * doesn't draw it there either — the threshold is the feature, not a fallback.
 */
function PixelGrid() {
  const shown = useUI((state) => state.view.pixelGrid);
  const viewport = useUI((state) => state.viewport);
  if (!shown || viewport.zoom < 4) return null;

  const step = viewport.zoom;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        backgroundImage:
          'linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)',
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${viewport.x % step}px ${viewport.y % step}px`,
      }}
    />
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Whether Space belongs to a focused control rather than to the canvas.
 *
 * Space is how a keyboard user ticks a checkbox and presses a button, so the
 * canvas may only claim it when focus is somewhere neutral. Keeping focus
 * *neutral* is the other half of the deal, and it is the chrome's job: a button
 * that stays focused after a click would hold Space for as long as it did, so
 * every button in the chrome hands focus back — see `ToolRail` and `ZoomMenu` —
 * and a pointer down on the canvas takes it back regardless.
 */
function takesSpace(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest(
    'button, input, select, textarea, a[href], summary, [contenteditable], ' +
      '[role="button"], [role="menuitem"], [role="checkbox"], [role="tab"], [role="slider"]',
  );
}

/** Runs `move` until the pointer is released, then `end`, then closes the undo step. */
function drag(
  store: DocStore,
  event: React.PointerEvent,
  move: (e: PointerEvent) => void,
  end?: (e: PointerEvent) => void,
) {
  event.preventDefault();
  const onMove = (e: PointerEvent) => move(e);
  const onUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    end?.(e);
    store.commit();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * The frame a node should be dropped into, if the pointer is over one.
 *
 * `skip` is for a drag: the layers being dragged are under the pointer the whole
 * time, so hit-testing without excluding them would only ever find the parent
 * they already have.
 */
function containerAt(
  clientX: number,
  clientY: number,
  doc: Doc,
  skip?: Set<string>,
): string | null {
  const stack = hitStack(clientX, clientY, doc);
  const hit = skip ? stack.find((id) => !skip.has(id)) : stack[0];
  if (!hit || isLocked(hit, doc)) return null;
  let current: SceneNode | undefined = doc[hit];
  while (current && current.type !== 'frame' && current.type !== 'section') {
    current = current.parent ? doc[current.parent] : undefined;
  }
  return current?.id ?? null;
}

/**
 * The layers at one level that a marquee has swept up.
 *
 * Measured, not read off the document. A node's x/y is local to its parent
 * while the marquee is in world coordinates, so comparing the two picked the
 * wrong layers the moment you had drilled into a frame — and a hug-sized
 * layer's stored size can lag what is on screen in any case. The browser has
 * already laid all of it out.
 */
function marqueeIn(
  box: { x: number; y: number; w: number; h: number },
  level: string,
  doc: Doc,
  root: HTMLElement,
  vp: { x: number; y: number; zoom: number },
): string[] {
  const canvasRect = root.getBoundingClientRect();
  return nodesInBox(box, doc, level, (id) => {
    const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const topLeft = toWorld(vp, r.left - canvasRect.left, r.top - canvasRect.top);
    return { x: topLeft.x, y: topLeft.y, w: r.width / vp.zoom, h: r.height / vp.zoom };
  });
}

/**
 * Where a pointer sits among an auto layout's children.
 *
 * Counted over the siblings that are *not* being dragged, and returned both as
 * a position in that list and as the index `moveMany` needs to land them there.
 *
 * The siblings are measured rather than computed: the browser has already
 * flowed them, and after a wrap or a grid track their positions are not
 * something the document can be asked for. Returns null when nothing could be
 * measured, which is the caller's signal to leave the order alone.
 */
function flowSlotAt(
  parent: SceneNode,
  exclude: string[],
  clientX: number,
  clientY: number,
): { position: number; index: number } | null {
  const others = parent.children.filter((id) => !exclude.includes(id));
  if (!others.length) return null;
  // a wrapping row and a grid both read left-to-right, top-to-bottom; a plain
  // row or column has only its own axis to compare along
  const wrapping = !!parent.flex && (parent.flex.mode === 'grid' || parent.flex.wrap);
  const horizontal = parent.flex?.direction === 'row';

  let position = 0;
  let measured = false;
  for (const id of others) {
    const rect = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.getBoundingClientRect();
    if (!rect) continue;
    measured = true;
    const past = wrapping
      ? clientY > rect.bottom
        ? true
        : clientY < rect.top
          ? false
          : clientX > rect.left + rect.width / 2
      : horizontal
        ? clientX > rect.left + rect.width / 2
        : clientY > rect.top + rect.height / 2;
    if (past) position++;
  }
  if (!measured) return null;

  // `moveMany` takes the layers out before putting them back, so the index it
  // wants is one into the *original* list that lands them at `position` once
  // they are gone. The child now standing at that position is that index.
  const index =
    position < others.length ? parent.children.indexOf(others[position]) : parent.children.length;
  return { position, index };
}

interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const sameRect = (a: SlotRect | null, b: SlotRect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * The line where a flowed drop would land, in the canvas element's own pixels.
 *
 * `flowSlotAt` answers with a position in the list; this is that position drawn
 * — the leading edge of the child that would be pushed along, or the trailing
 * edge of the last one when the layer goes on the end.
 */
function flowSlotRect(
  parent: SceneNode,
  exclude: string[],
  position: number,
  base: DOMRect,
): SlotRect | null {
  const others = parent.children.filter((id) => !exclude.includes(id));
  if (!others.length) return null;
  const last = position >= others.length;
  const anchor = others[last ? others.length - 1 : position];
  const rect = document.querySelector<HTMLElement>(`[data-node-id="${anchor}"]`)?.getBoundingClientRect();
  if (!rect) return null;
  return parent.flex?.direction === 'row'
    ? { x: (last ? rect.right : rect.left) - base.left - 1, y: rect.top - base.top, w: 2, h: rect.height }
    : { x: rect.left - base.left, y: (last ? rect.bottom : rect.top) - base.top - 1, w: rect.width, h: 2 };
}

/**
 * Figma's drop: a layer dragged over a frame becomes a child of that frame, and
 * one dragged off every frame goes back to the page — in both cases without
 * appearing to move.
 *
 * The position is read off the DOM rather than computed. A node's x/y is local
 * to its parent, so rebasing it arithmetically only works while the two parents
 * are siblings; asking the browser where the layer actually is works at any
 * depth, and the browser has already laid it out.
 */
function dropInto(
  store: DocStore,
  doc: Doc,
  movers: string[],
  parentId: string,
  pageId: string,
  canvasRect: DOMRect,
  vp: { x: number; y: number; zoom: number },
  /** where the pointer was released, for a drop into a layout */
  pointer: { x: number; y: number },
): void {
  // insert back-to-front so a multi-layer drop keeps its stacking
  const ordered = [...movers].sort(
    (a, b) =>
      (doc[doc[a]?.parent ?? '']?.children.indexOf(a) ?? 0) -
      (doc[doc[b]?.parent ?? '']?.children.indexOf(b) ?? 0),
  );

  for (const id of ordered) {
    const node = doc[id];
    if (!node || node.parent === parentId) continue;
    const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const world = toWorld(vp, rect.left - canvasRect.left, rect.top - canvasRect.top);
    // measured before the move, while the old tree is still on screen
    const local =
      parentId === pageId
        ? { x: Math.round(world.x), y: Math.round(world.y) }
        : localOffset(parentId, world.x, world.y, doc, canvasRect, vp);
    // Into an auto layout, the pointer says *where* in the flow — appending
    // would drop the layer at the end however carefully it was aimed. The
    // layer is not a child yet, so a position among the existing children is
    // already the index to insert at.
    const target = doc[parentId];
    const slot = target?.flex ? flowSlotAt(target, [id], pointer.x, pointer.y) : null;
    store.reparent(id, parentId, slot?.index);
    store.update(id, local);
  }
}

/** World point → coordinates local to `parentId`'s padding box. */
function localOffset(
  parentId: string,
  worldX: number,
  worldY: number,
  doc: Doc,
  canvasRect: DOMRect,
  vp: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>(`[data-node-id="${parentId}"]`);
  if (!el) return { x: Math.round(worldX), y: Math.round(worldY) };
  const rect = el.getBoundingClientRect();
  const parentWorldX = (rect.left - canvasRect.left - vp.x) / vp.zoom;
  const parentWorldY = (rect.top - canvasRect.top - vp.y) / vp.zoom;
  return { x: Math.round(worldX - parentWorldX), y: Math.round(worldY - parentWorldY) };
}
