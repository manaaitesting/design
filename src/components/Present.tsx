'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NodeView } from './NodeView';
import { Icon } from './ui/Icons';
import { useDoc, useTokenVars, useVarNames } from './Session';
import { useUI } from '../state/ui';
import {
  flowsOn,
  hitInteraction,
  hotspotsIn,
  interactionsOf,
  offsetInFrame,
} from '../document/prototype';
import type { Doc, Interaction, OverlaySpec, SceneNode, TransitionSpec } from '../document/types';
import { DEFAULT_OVERLAY } from '../document/prototype';

/** Padding around the frame, so a full-bleed design still reads as a screen. */
const MARGIN = 48;
const HOTSPOT_FLASH_MS = 500;

interface Move {
  from: string;
  to: string;
  transition: TransitionSpec;
  /** navigating back plays the transition the other way, as Figma does */
  reverse: boolean;
}

/** How far and in which axis a directional transition travels. */
function travel(spec: TransitionSpec, reverse: boolean): { x: number; y: number } {
  const sign = reverse ? -1 : 1;
  switch (spec.direction) {
    case 'left':
      return { x: -sign, y: 0 };
    case 'right':
      return { x: sign, y: 0 };
    case 'top':
      return { x: 0, y: -sign };
    default:
      return { x: 0, y: sign };
  }
}

/**
 * Plays the prototype.
 *
 * The frames are the same `NodeView` tree the canvas draws — no second
 * renderer, so what plays back is exactly what was designed. Only the chrome
 * and the hit-testing differ: a click here looks for an interaction instead of
 * a selection.
 */
export function Present() {
  const doc = useDoc();
  const tokenVars = useTokenVars();
  const presenting = useUI((s) => s.presenting);
  const present = useUI((s) => s.present);
  const pageId = useUI((s) => s.page);
  const device = useUI((s) => s.device);
  const setDevice = useUI((s) => s.setDevice);

  const [stack, setStack] = useState<string[]>([]);
  /** overlays sitting on top of the frame, innermost last */
  const [overlays, setOverlays] = useState<{ frame: string; spec: OverlaySpec }[]>([]);
  const [move, setMove] = useState<Move | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /**
   * Where every named layer was before a smart-animate navigation.
   *
   * Smart animate is a FLIP: measure the outgoing frame, let the incoming one
   * lay out, then animate each matching layer from where it used to be. Names
   * are the match, which is exactly the contract Figma's smart animate has.
   */
  const smart = useRef<Map<string, DOMRect> | null>(null);
  /**
   * Variables a `set-variable` interaction has changed while playing.
   *
   * They are re-declared on the stage rather than written to the document: a
   * prototype run is a rehearsal, and it must not leave the design different
   * from how the designer left it.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const current = stack.at(-1) ?? null;
  const frame: SceneNode | undefined = current ? doc[current] : undefined;

  const after = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // opening resets the history to the frame Present was asked for
  useEffect(() => {
    if (!presenting) return;
    setStack([presenting]);
    setOverlays([]);
    setOverrides({});
    setMove(null);
  }, [presenting]);

  /** Every layer in a rendered frame, by name, so smart animate can match them. */
  const capture = useCallback(
    (frameId: string) => {
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-frame-id="${frameId}"]`);
      if (!el) return null;
      const map = new Map<string, DOMRect>();
      for (const child of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const name = doc[child.dataset.nodeId ?? '']?.name;
        // first wins: a duplicated name animates its frontmost layer, which is
        // the one the eye was following anyway
        if (name && !map.has(name)) map.set(name, child.getBoundingClientRect());
      }
      return map;
    },
    [doc],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [presenting],
  );

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = useCallback(
    (interaction: Interaction) => {
      if (interaction.action === 'url') {
        if (interaction.url) window.open(interaction.url, '_blank', 'noopener');
        return;
      }
      if (interaction.action === 'none') return;
      if (interaction.action === 'open-overlay') {
        if (!interaction.destination) return;
        setOverlays((prev) =>
          prev.some((entry) => entry.frame === interaction.destination)
            ? prev
            : [...prev, { frame: interaction.destination!, spec: interaction.overlay ?? DEFAULT_OVERLAY }],
        );
        return;
      }
      if (interaction.action === 'close-overlay') {
        setOverlays((prev) => prev.slice(0, -1));
        return;
      }
      if (interaction.action === 'swap-overlay') {
        if (!interaction.destination) return;
        setOverlays((prev) =>
          prev.length
            ? [
                ...prev.slice(0, -1),
                { frame: interaction.destination!, spec: prev[prev.length - 1].spec },
              ]
            : [{ frame: interaction.destination!, spec: interaction.overlay ?? DEFAULT_OVERLAY }],
        );
        return;
      }
      if (interaction.action === 'set-variable') {
        const name = interaction.variable ? variableNames[interaction.variable] : null;
        if (name && interaction.value !== undefined) {
          setOverrides((prev) => ({ ...prev, [`--${name}`]: interaction.value! }));
        }
        return;
      }
      if (interaction.action === 'scroll-to') {
        const target = interaction.destination
          ? stageRef.current?.querySelector<HTMLElement>(`[data-node-id="${interaction.destination}"]`)
          : null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (interaction.action === 'back') {
        setStack((prev) => {
          if (prev.length < 2) return prev;
          const from = prev.at(-1)!;
          const to = prev.at(-2)!;
          if (interaction.transition.type !== 'instant') {
            setMove({ from, to, transition: interaction.transition, reverse: true });
            after(() => setMove(null), interaction.transition.duration + 20);
          }
          return prev.slice(0, -1);
        });
        return;
      }
      if (interaction.action !== 'navigate' || !interaction.destination) return;
      const to = interaction.destination;
      setStack((prev) => {
        const from = prev.at(-1);
        if (!from || from === to) return prev;
        // measure before the swap: after it, the old frame is already gone
        smart.current =
          interaction.transition.type === 'smart-animate' ? capture(from) : null;
        if (interaction.transition.type !== 'instant') {
          setMove({ from, to, transition: interaction.transition, reverse: false });
          after(() => setMove(null), interaction.transition.duration + 20);
        }
        return [...prev, to];
      });
    },
    [after, capture],
  );

  // Smart animate: the incoming frame has just laid out, so every layer that
  // exists in both frames is put back where it was and let go.
  useLayoutEffect(() => {
    const before = smart.current;
    if (!before || !move || move.transition.type !== 'smart-animate') return;
    smart.current = null;
    const el = stageRef.current?.querySelector<HTMLElement>(
      `[data-frame-id="${move.to}"][data-role="incoming"]`,
    );
    if (!el) return;

    for (const child of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
      const name = doc[child.dataset.nodeId ?? '']?.name;
      const was = name ? before.get(name) : undefined;
      if (!was) continue;
      const now = child.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      const sx = now.width ? was.width / now.width : 1;
      const sy = now.height ? was.height / now.height : 1;
      const still =
        Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01;
      if (still) continue;
      child.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: move.transition.duration, easing: move.transition.easing, fill: 'both' },
      );
    }
  }, [move, doc]);

  // After-delay interactions belong to the frame you are on, so they re-arm
  // every time you arrive somewhere new.
  useEffect(() => {
    if (!current) return;
    const armed = delayedIn(current, doc);
    const handles = armed.map(({ interaction }) => setTimeout(() => go(interaction), interaction.delay));
    return () => handles.forEach(clearTimeout);
  }, [current, doc, go]);

  const exit = useCallback(() => present(null), [present]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // an overlay is the thing on top, so it is the thing Escape closes
        if (overlays.length) setOverlays((prev) => prev.slice(0, -1));
        else exit();
        return;
      }
      // a layer can bind a key of its own; those win over the player's controls
      const bound = keyBindingIn(current, doc, event.key);
      if (bound) {
        event.preventDefault();
        go(bound);
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        setStack((prev) => prev.slice(0, 1));
        setMove(null);
        return;
      }
      // the arrow keys walk the flow, the way Figma's presentation does
      if (event.key === 'ArrowLeft') setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      if (event.key === 'ArrowRight') {
        const next = firstNavigation(current, doc);
        if (next) go(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, exit, current, doc, go, overlays.length]);

  const variableNames = useVarNames();
  const flows = useMemo(() => flowsOn(doc, pageId), [doc, pageId]);
  const flowName = flows.find((flow) => flow.id === stack[0])?.name;

  if (!presenting || !frame) return null;

  const scale = Math.min(
    1,
    Math.min((size.w - MARGIN * 2) / frame.w, (size.h - MARGIN * 2 - 44) / frame.h),
  );

  /** A gesture on the artwork: find what it hit, then do what that says. */
  const fire = (event: React.PointerEvent, trigger: Interaction['trigger']) => {
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]');
    const hit = el?.dataset.nodeId ? hitInteraction(el.dataset.nodeId, doc, trigger) : null;
    if (hit) {
      go(hit.interaction);
      return true;
    }
    return false;
  };

  return (
    <div
      className="fig-present"
      style={{ ...(tokenVars as React.CSSProperties), ...overrides } as React.CSSProperties}
    >
      <div className="fig-present-bar">
        <button type="button" className="fig-present-btn" title="Close  Esc" onClick={exit}>
          <Icon.Close />
        </button>
        <span className="fig-present-title">
          {flowName ?? doc[stack[0]]?.name ?? 'Prototype'}
        </span>
        <button
          type="button"
          className="fig-present-btn"
          title="Restart  R"
          onClick={() => {
            setStack((prev) => prev.slice(0, 1));
            setMove(null);
          }}
        >
          <Icon.Reset />
        </button>
        <select
          className="fig-present-device"
          value={device}
          title="Device frame"
          onChange={(event) => setDevice(event.target.value as typeof device)}
        >
          <option value="none">No frame</option>
          <option value="phone">Phone</option>
          <option value="tablet">Tablet</option>
          <option value="laptop">Laptop</option>
        </select>

        <button
          type="button"
          className="fig-present-btn"
          data-off={stack.length < 2}
          title="Back  ←"
          onClick={() => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <Icon.Chevron />
          </span>
        </button>
      </div>

      <div
        ref={stageRef}
        className="fig-present-stage"
        onPointerDown={(event) => {
          // a drag beats a click on the same layer, so it is armed first and
          // only becomes a click if the pointer never really moved
          const startX = event.clientX;
          const startY = event.clientY;
          const target = event.target as HTMLElement | null;
          const onUp = (up: PointerEvent) => {
            window.removeEventListener('pointerup', onUp);
            if (Math.hypot(up.clientX - startX, up.clientY - startY) < 12) return;
            const el = target?.closest<HTMLElement>('[data-node-id]');
            const hit = el?.dataset.nodeId ? hitInteraction(el.dataset.nodeId, doc, 'drag') : null;
            if (hit) go(hit.interaction);
          };
          window.addEventListener('pointerup', onUp);

          // a click that hits nothing flashes the hotspots, as Figma does
          if (!fire(event, 'press') && !fire(event, 'click')) {
            setFlash(true);
            after(() => setFlash(false), HOTSPOT_FLASH_MS);
          }
        }}
        onPointerOver={(event) => {
          fire(event, 'hover');
          fire(event, 'mouse-enter');
        }}
        onPointerOut={(event) => {
          fire(event, 'mouse-leave');
        }}
      >
        <div
          className={device === 'none' ? undefined : 'fig-device'}
          data-device={device === 'none' ? undefined : device}
        >
        <div
          className="fig-present-frame"
          style={{ width: frame.w * scale, height: frame.h * scale }}
        >
          {move && (
            <Screen
              id={move.from}
              scale={scale}
              spec={move.transition}
              role="outgoing"
              reverse={move.reverse}
            />
          )}
          <Screen
            key={frame.id}
            id={frame.id}
            scale={scale}
            spec={move?.transition}
            role="incoming"
            reverse={move?.reverse ?? false}
          />

          {overlays.map((entry, index) => {
            const overlay = doc[entry.frame];
            if (!overlay) return null;
            return (
              <div
                key={`${entry.frame}-${index}`}
                className="fig-overlay-layer"
                data-dim={entry.spec.background || undefined}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (entry.spec.closeOnOutside) setOverlays((prev) => prev.slice(0, index));
                }}
              >
                <div
                  className="fig-overlay"
                  data-at={entry.spec.position}
                  style={{ width: overlay.w * scale, height: overlay.h * scale }}
                >
                  <div
                    style={{
                      width: overlay.w,
                      height: overlay.h,
                      transform: `scale(${scale})`,
                      transformOrigin: '0 0',
                      position: 'relative',
                      background: overlay.fill ?? '#fff',
                    }}
                    data-frame-id={entry.frame}
                  >
                    <div style={{ position: 'absolute', left: -overlay.x, top: -overlay.y }}>
                      <NodeView id={entry.frame} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {flash &&
            hotspotsIn(frame.id, doc).map((id) => {
              const at = offsetInFrame(id, frame.id, doc);
              const hot = doc[id];
              if (!hot) return null;
              return (
                <span
                  key={id}
                  className="fig-hotspot"
                  style={{
                    left: at.x * scale,
                    top: at.y * scale,
                    width: hot.w * scale,
                    height: hot.h * scale,
                  }}
                />
              );
            })}
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One frame of the playback, positioned by the transition it is taking part in.
 * `instant` skips the animation entirely, which is why it has no duration.
 */
function Screen({
  id,
  scale,
  spec,
  role,
  reverse,
}: {
  id: string;
  scale: number;
  spec?: TransitionSpec;
  role: 'incoming' | 'outgoing';
  reverse: boolean;
}) {
  const doc = useDoc();
  const node = doc[id];
  const [entered, setEntered] = useState(false);

  // a frame that mounts already in its final place would never animate
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!node) return null;
  const animating = !!spec && spec.type !== 'instant';
  const at = travel(spec ?? { type: 'instant', direction: 'left', duration: 0, easing: 'linear' }, reverse);

  let transform = 'translate(0, 0)';
  let opacity = 1;
  if (animating) {
    // A smart animate keeps the frame still and moves the layers inside it —
    // sliding the whole screen as well would fight the tween.
    const moves = spec.type !== 'dissolve' && spec.type !== 'smart-animate';
    const start = role === 'incoming' ? 1 : 0;
    const end = role === 'incoming' ? 0 : -1;
    const phase = entered ? end : start;
    if (moves) {
      // move-in leaves the outgoing frame where it is; push and slide take it
      const held = spec.type === 'move' && role === 'outgoing';
      transform = held ? 'translate(0, 0)' : `translate(${at.x * phase * 100}%, ${at.y * phase * 100}%)`;
    }
    if (spec.type === 'dissolve' || spec.type === 'smart-animate') {
      // the outgoing frame fades under the tween; the incoming one is already
      // opaque, so what you see moving is the matched layers
      opacity = role === 'incoming' ? 1 : entered ? 0 : 1;
    }
  }

  return (
    <div
      className="fig-present-screen"
      data-frame-id={id}
      data-role={role}
      style={{
        width: node.w,
        height: node.h,
        transform: `scale(${scale}) ${transform}`,
        transformOrigin: '0 0',
        opacity,
        transition: animating
          ? `transform ${spec.duration}ms ${spec.easing}, opacity ${spec.duration}ms ${spec.easing}`
          : undefined,
        background: node.fill ?? '#fff',
      }}
    >
      {/* an artboard is positioned in world space; playing it back means
          cancelling that, so the frame sits at the origin of the screen */}
      <div style={{ position: 'absolute', left: -node.x, top: -node.y }}>
        <NodeView id={id} />
      </div>
    </div>
  );
}

/** After-delay interactions armed by arriving on a frame. */
function delayedIn(frameId: string, doc: Doc): { node: string; interaction: Interaction }[] {
  const out: { node: string; interaction: Interaction }[] = [];
  const walk = (id: string): void => {
    const node = doc[id];
    if (!node) return;
    for (const interaction of interactionsOf(node)) {
      if (interaction.trigger === 'delay') out.push({ node: id, interaction });
    }
    for (const child of node.children) walk(child);
  };
  walk(frameId);
  return out;
}

/** An interaction on this frame bound to the key that was pressed. */
function keyBindingIn(frameId: string | null, doc: Doc, key: string): Interaction | null {
  if (!frameId) return null;
  let found: Interaction | null = null;
  const walk = (id: string): void => {
    if (found) return;
    const node = doc[id];
    if (!node) return;
    const hit = interactionsOf(node).find(
      (entry) => entry.trigger === 'key' && entry.key && entry.key.toLowerCase() === key.toLowerCase(),
    );
    if (hit) {
      found = hit;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(frameId);
  return found;
}

/** The first navigation on a frame — what the right arrow key follows. */
function firstNavigation(frameId: string | null, doc: Doc): Interaction | null {
  if (!frameId) return null;
  let found: Interaction | null = null;
  const walk = (id: string): void => {
    if (found) return;
    const node = doc[id];
    if (!node) return;
    const hit = interactionsOf(node).find(
      (entry) => entry.action === 'navigate' && entry.destination && doc[entry.destination],
    );
    if (hit) {
      found = hit;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(frameId);
  return found;
}
