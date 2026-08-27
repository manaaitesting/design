'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeView } from './NodeView';
import { Overlay, SIZE_BADGE } from './Overlay';
import { Cursors } from './Cursors';
import { Connections } from './Connections';
import { pathFrom } from './VectorShape';
import { CommentComposer, Comments } from './Comments';
import { useDoc, useSession, useStore, useTokenVars } from './Session';
import type { DocStore } from '../document/store';
import { toScreen, toWorld, useUI, type Tool } from '../state/ui';
import { isInFlow, ROOT_ID, type Doc, type NodeType, type SceneNode } from '../document/types';
import { snap, snapCandidates } from '../document/snapping';
import { fitOnCanvas, imageFilesFrom, readImageFile } from '../lib/images';
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
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
};

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

interface Draft {
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
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

  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [marquee, setMarquee] = useState<Draft | null>(null);
  const spaceRef = useRef(false);

  /** in-progress pen path, in world coordinates */
  const [pen, setPen] = useState<[number, number][]>([]);
  const [penCursor, setPenCursor] = useState<[number, number] | null>(null);
  const [composing, setComposing] = useState<{ x: number; y: number } | null>(null);

  const pageId = useUI((s) => s.page);
  const page = doc[pageId] ?? doc[ROOT_ID];
  const tokenVars = useTokenVars();
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Places dropped or pasted images as real image nodes at a world point. */
  const placeImages = useCallback(
    async (files: File[], at: { x: number; y: number }) => {
      let offset = 0;
      for (const file of files) {
        try {
          const image = await readImageFile(file);
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
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Could not add that image.');
          window.setTimeout(() => setNotice(null), 5000);
        }
      }
    },
    [store, select],
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
          const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
          const scale = zoom / vp.zoom;
          // keep the point under the cursor pinned
          return { zoom, x: px - (px - vp.x) * scale, y: py - (py - vp.y) * scale };
        });
      } else {
        setViewport((vp) => ({ ...vp, x: vp.x - event.deltaX, y: vp.y - event.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  // ── Space-to-pan ───────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        spaceRef.current = true;
        document.body.style.cursor = 'grab';
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
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

  /** Turns the in-progress point list into a vector node. */
  const commitPen = useCallback(
    (points: [number, number][], closed: boolean) => {
      setPen([]);
      setPenCursor(null);
      if (points.length < 2) return;

      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const width = Math.max(1, Math.round(Math.max(...xs) - minX));
      const height = Math.max(1, Math.round(Math.max(...ys) - minY));

      const id = store.create('vector', page.id, {
        x: Math.round(minX),
        y: Math.round(minY),
        w: width,
        h: height,
        closed,
        points: points.map(([x, y]) => [x - minX, y - minY] as [number, number]),
      });
      select([id]);
      setTool('move');
    },
    [store, page, select, setTool],
  );

  // Reset on tool change only — folding this into the key-handler effect below
  // would re-run it on every point and loop, since [] is a new array each time.
  useEffect(() => {
    if (tool === 'pen') return;
    setPen((points) => (points.length ? [] : points));
    setPenCursor((cursor) => (cursor ? null : cursor));
  }, [tool]);

  useEffect(() => {
    if (tool !== 'pen') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPen(pen, false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setPen([]);
        setPenCursor(null);
        setTool('move');
      } else if (event.key === 'Backspace' && pen.length) {
        event.preventDefault();
        setPen((points) => points.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, pen, commitPen, setTool]);

  // ── Pointer interactions ───────────────────────────────────────────────
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 2) return;
    const rect = rootRef.current!.getBoundingClientRect();
    const vp = useUI.getState().viewport;
    const startScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const start = toWorld(vp, startScreen.x, startScreen.y);

    // Panning wins over everything
    if (tool === 'pan' || spaceRef.current || event.button === 1) {
      const origin = { ...vp };
      drag(store, event, (e) => {
        setViewport({
          ...origin,
          x: origin.x + (e.clientX - event.clientX),
          y: origin.y + (e.clientY - event.clientY),
        });
      });
      return;
    }

    if (tool === 'comment') {
      setComposing({ x: Math.round(start.x), y: Math.round(start.y) });
      return;
    }

    if (tool === 'pen') {
      const point: [number, number] = [Math.round(start.x), Math.round(start.y)];
      // clicking back on the first point closes the shape
      if (pen.length > 2) {
        const [fx, fy] = pen[0];
        if (Math.hypot(point[0] - fx, point[1] - fy) * vp.zoom < 10) {
          commitPen(pen, true);
          return;
        }
      }
      setPen((points) => [...points, point]);
      return;
    }

    const drawType = DRAW_TOOLS[tool];
    if (drawType) {
      // the live box lives in this closure — React state only mirrors it for
      // the preview, and would lag behind a fast drag
      let box: Draft | null = null;
      drag(
        store,
        event,
        (e) => {
          const current = toWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
          box = {
            type: drawType,
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            w: Math.abs(current.x - start.x),
            h: Math.abs(current.y - start.y),
          };
          setDraft(box);
        },
        () => {
          const size = box && box.w > 4 && box.h > 4
            ? box
            : { x: start.x, y: start.y, w: drawType === 'text' ? 120 : 100, h: drawType === 'text' ? 24 : 100 };

          const parentId = containerAt(event.clientX, event.clientY, doc) ?? page.id;
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
              ? { wMode: 'fit' as const, hMode: 'fit' as const, text: 'Text' }
              : null),
          });
          setDraft(null);
          select([id]);
          setTool('move');
          if (drawType === 'text') setEditing(id);
        },
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
      if (!event.shiftKey) {
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
            select(
              nodesInBox(final, doc, level, (id) => {
                const n = doc[id];
                return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
              }),
            );
          }
          setMarquee(null);
        },
      );
      return;
    }

    const resolved = resolveClick(
      stack,
      doc,
      entered,
      event.metaKey || event.ctrlKey ? 'deep' : 'normal',
    );
    if (!resolved) return;
    const targetId = resolved.id;
    if (resolved.entered !== entered) setEntered(resolved.entered);

    if (event.shiftKey) {
      toggle(targetId);
      return;
    }

    let nextSelection = selection.includes(targetId) ? selection : [targetId];
    if (!selection.includes(targetId)) select([targetId]);

    // ⌥-drag leaves a copy behind and moves the duplicate, as in Figma
    if (event.altKey) {
      const copies = store.duplicate(nextSelection, 0);
      if (copies.length) {
        nextSelection = copies;
        select(copies);
      }
    }

    // A flowed child is positioned by its parent, so dragging it moves the
    // nearest absolutely-placed ancestor — while selection stays on the child.
    const movers = [...new Set(nextSelection.map((id) => draggableTarget(id, doc)))];
    // read positions from the live snapshot: duplicates were only just created
    const snapshot = store.getSnapshot();
    const origins = new Map(movers.map((id) => [id, { x: snapshot[id]?.x ?? 0, y: snapshot[id]?.y ?? 0 }]));

    // one node dragging alone gets edge/centre snapping against its siblings
    const lead = movers.length === 1 ? snapshot[movers[0]] : null;
    const candidates = lead?.parent ? snapCandidates(snapshot, movers, lead.parent) : [];

    let moved = false;
    drag(
      store,
      event,
      (e) => {
        let dx = (e.clientX - event.clientX) / vp.zoom;
        let dy = (e.clientY - event.clientY) / vp.zoom;
        if (!moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
        moved = true;

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

        store.updateMany(movers, (n) => {
          const origin = origins.get(n.id)!;
          return { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
        });
      },
      () => setGuides([]),
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
    if (doc[resolved.id]?.type === 'text') setEditing(resolved.id);
  };

  const cursor =
    tool === 'pan'
      ? 'grab'
      : DRAW_TOOLS[tool] || tool === 'pen'
        ? CROSSHAIR
        : tool === 'comment'
          ? 'copy'
          : ARROW;

  return (
    <div
      ref={rootRef}
      data-canvas-root=""
      style={{ position: 'relative', flex: 1, overflow: 'hidden', background: page?.fill ?? '#EEEEEE', cursor }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick as unknown as React.MouseEventHandler}
      onPointerMove={(e) => {
        publishCursor(e.clientX, e.clientY);
        if (tool === 'pen' && pen.length) {
          const rect = rootRef.current!.getBoundingClientRect();
          const world = toWorld(useUI.getState().viewport, e.clientX - rect.left, e.clientY - rect.top);
          setPenCursor([world.x, world.y]);
        }
        const stack = hitStack(e.clientX, e.clientY, doc);
        const preview = resolveClick(stack, doc, entered, e.metaKey || e.ctrlKey ? 'deep' : 'normal');
        setHover(preview?.id ?? null);
      }}
      onPointerLeave={() => {
        provider.awareness.setLocalStateField('cursor', null);
        setHover(null);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        const files = imageFilesFrom(e.dataTransfer);
        setDropping(false);
        if (!files.length) return;
        e.preventDefault();
        const rect = rootRef.current!.getBoundingClientRect();
        const at = toWorld(useUI.getState().viewport, e.clientX - rect.left, e.clientY - rect.top);
        void placeImages(files, at);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const stack = hitStack(e.clientX, e.clientY, doc);
        const resolved = resolveClick(stack, doc, entered, 'normal');
        if (resolved && !selection.includes(resolved.id)) select([resolved.id]);
        setContextMenu({ x: e.clientX, y: e.clientY, stack });
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
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
              d={pathFrom(penCursor ? [...pen, penCursor] : pen, false)}
              fill="none"
              stroke="var(--color-select-line)"
              strokeWidth={1.5 / viewport.zoom}
            />
            {pen.map(([x, y], index) => (
              <rect
                key={index}
                x={x - 3 / viewport.zoom}
                y={y - 3 / viewport.zoom}
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

      <Overlay containerRef={rootRef} />
      {prototyping && <Connections containerRef={rootRef} />}
      <Comments />
      {composing && <CommentComposer at={composing} onDone={() => setComposing(null)} />}
      <Cursors containerRef={rootRef} />
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
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

/** The frame a new node should be dropped into, if the pointer is over one. */
function containerAt(clientX: number, clientY: number, doc: Doc): string | null {
  const hit = hitStack(clientX, clientY, doc)[0];
  if (!hit || isLocked(hit, doc)) return null;
  let current: SceneNode | undefined = doc[hit];
  while (current && current.type !== 'frame' && current.type !== 'section') {
    current = current.parent ? doc[current.parent] : undefined;
  }
  return current?.id ?? null;
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
