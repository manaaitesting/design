'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NodeView, SwapContext } from './NodeView';
import { Icon } from './ui/Icons';
import { MotionStyle } from './MotionStyle';
import { useCollections, useDoc, useTokenVars, useTokens, useVarNames } from './Session';
import {
  DEFAULT_COLLECTION_ID,
  defaultModes,
  publish,
  resolveToken,
} from '../document/variables';
import { useUI } from '../state/ui';
import {
  easingCss,
  flowsOn,
  hitInteraction,
  hotspotsIn,
  interactionsOf,
  offsetInFrame,
} from '../document/prototype';
import { DEVICES, descendants } from '../document/types';
import type { PrototypeDevice } from '../document/types';
import type { Doc, Interaction, OverlaySpec, SceneNode, TransitionSpec } from '../document/types';
import { DEFAULT_OVERLAY, DEFAULT_TRANSITION } from '../document/prototype';
import { evaluate } from '../document/condition';

/** The hyperlink on a layer, or on the nearest ancestor carrying one. */
function linkAt(nodeId: string | undefined, doc: Doc): string | null {
  let current = nodeId ? doc[nodeId] : undefined;
  while (current) {
    if (current.link) return current.link;
    current = current.parent ? doc[current.parent] : undefined;
  }
  return null;
}

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
  const chosen = useUI((s) => s.device);
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
   * Where each frame was scrolled to, by node.
   *
   * A frame unmounts when you navigate away from it, so without this every
   * return trip would land back at the top. Figma remembers, and forgets only
   * when an interaction says to.
   */
  const scrolls = useRef<Record<string, Record<string, [number, number]>>>({});
  /**
   * Where each frame's videos had got to, and whether they were running.
   *
   * Same reason as the scroll offsets: the frame unmounts, so without this a
   * video would start from the beginning every time you came back to it.
   */
  const videos = useRef<Record<string, Record<string, { time: number; paused: boolean }>>>({});
  /**
   * Variables a `set-variable` interaction has changed while playing.
   *
   * They are re-declared on the stage rather than written to the document: a
   * prototype run is a rehearsal, and it must not leave the design different
   * from how the designer left it.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /**
   * Instances a "Change to" has swapped during this run.
   *
   * Like the variable overrides, they are held here rather than written: a run
   * is a rehearsal, and it must not leave the document different.
   */
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const current = stack.at(-1) ?? null;
  const frame: SceneNode | undefined = current ? doc[current] : undefined;

  /**
   * The prototype's own settings, which live on the page.
   *
   * The toolbar's picker still wins while it is open, because changing the
   * frame to check a layout is a thing you do *during* a run — but the document
   * is what a fresh run starts from, so everybody sees the same prototype.
   */
  const page = doc[pageId];
  const device = chosen === 'none' ? page?.prototypeDevice ?? 'none' : chosen;
  const spec = DEVICES.find((entry) => entry.id === device) ?? DEVICES[0];
  const background = page?.prototypeBackground ?? null;

  const after = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // opening resets the history to the frame Present was asked for
  useEffect(() => {
    if (!presenting) return;
    setStack([presenting]);
    setOverlays([]);
    setOverrides({});
    setSwaps({});
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

  /**
   * What an interaction forgets on the way in — Figma's "State" section.
   *
   * Scroll and swapped variants are both remembered by default, so arriving
   * somewhere looks like coming back to it; these are the two ways of saying
   * arrive fresh instead.
   */
  const arrive = useCallback(
    (to: string, interaction: Interaction) => {
      if (interaction.resetScroll) delete scrolls.current[to];
      if (interaction.resetVideo) delete videos.current[to];
      if (interaction.resetComponentState) {
        // only the destination's own instances: a swap on another frame is that
        // frame's state, and arriving here says nothing about it
        const inside = new Set(descendants(to, doc));
        setSwaps((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => !inside.has(id))),
        );
      }
    },
    [doc],
  );

  /**
   * What a variable holds right now: whatever the run has set, else what the
   * document publishes. Conditions read through this and nothing else.
   */
  const readVariable = useCallback(
    (name: string) => overrides[`--${name}`] ?? tokenVars[`--${name}`],
    [overrides, tokenVars],
  );

  const go = useCallback(
    (interaction: Interaction, nodeId = '') => {
      // a branch action, or one an agent wrote, may carry no transition at all
      const transition = interaction.transition ?? DEFAULT_TRANSITION;
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
      if (interaction.action === 'set-mode') {
        // a mode is a set of variable values; playing one is re-declaring them
        // on the stage, exactly as `set-variable` does with a single value
        if (!interaction.collection || !interaction.mode) return;
        setOverrides((prev) => ({ ...prev, ...modeVars(interaction.collection!, interaction.mode!) }));
        return;
      }
      if (interaction.action === 'play-pause' || interaction.action === 'set-playhead') {
        const target = interaction.animation ?? nodeId;
        const video = stageRef.current?.querySelector<HTMLVideoElement>(
          `[data-node-id="${target}"] video`,
        );
        if (!video) return;
        if (interaction.action === 'set-playhead') {
          video.currentTime = Math.max(0, interaction.timestamp ?? 0);
          return;
        }
        const behavior = interaction.behavior ?? 'toggle';
        const play = behavior === 'play' || (behavior === 'toggle' && video.paused);
        if (play) void video.play().catch(() => {});
        else video.pause();
        return;
      }
      if (interaction.action === 'conditional') {
        // the first branch that holds wins; a branch with no condition is the
        // `else`, so it always does
        const branch = (interaction.branches ?? []).find((entry) =>
          evaluate(entry.condition, readVariable),
        );
        for (const step of branch?.actions ?? []) go(step, nodeId);
        return;
      }
      if (interaction.action === 'change-to') {
        // swapping an instance during a run must not edit the document, so the
        // swap is remembered here and the frame is re-rendered against it
        if (!interaction.destination) return;
        setSwaps((prev) => ({ ...prev, [nodeId]: interaction.destination! }));
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
          arrive(to, interaction);
          if (transition.type !== 'instant') {
            setMove({ from, to, transition, reverse: true });
            after(() => setMove(null), transition.duration + 20);
          }
          return prev.slice(0, -1);
        });
        return;
      }
      if (interaction.action !== 'navigate' || !interaction.destination) return;
      const to = interaction.destination;
      arrive(to, interaction);
      setStack((prev) => {
        const from = prev.at(-1);
        if (!from || from === to) return prev;
        // measure before the swap: after it, the old frame is already gone
        smart.current =
          transition.type === 'smart-animate' ? capture(from) : null;
        if (transition.type !== 'instant') {
          setMove({ from, to, transition, reverse: false });
          after(() => setMove(null), transition.duration + 20);
        }
        return [...prev, to];
      });
    },
    [after, capture, arrive, readVariable],
  );

  // Put a frame back where it was scrolled to. It runs before paint so the
  // return trip never flashes at the top first.
  useLayoutEffect(() => {
    if (!current) return;
    const remembered = scrolls.current[current];
    if (!remembered) return;
    const root = stageRef.current?.querySelector<HTMLElement>(`[data-frame-id="${current}"]`);
    if (!root) return;
    for (const [id, [x, y]] of Object.entries(remembered)) {
      const el = root.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
      if (!el) continue;
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }, [current]);

  // Put the videos back where they had got to, for the same reason.
  useEffect(() => {
    if (!current) return;
    const remembered = videos.current[current];
    if (!remembered) return;
    const root = stageRef.current?.querySelector<HTMLElement>(`[data-frame-id="${current}"]`);
    if (!root) return;
    for (const [id, at] of Object.entries(remembered)) {
      const el = root.querySelector<HTMLVideoElement>(`[data-node-id="${id}"] video`);
      if (!el) continue;
      el.currentTime = at.time;
      if (at.paused) el.pause();
      else void el.play().catch(() => {});
    }
  }, [current]);

  // Record where every video is, so leaving a frame does not lose the place.
  useEffect(() => {
    if (!presenting) return;
    const tick = window.setInterval(() => {
      const frame = stack.at(-1);
      const root = frame
        ? stageRef.current?.querySelector<HTMLElement>(`[data-frame-id="${frame}"]`)
        : null;
      if (!frame || !root) return;
      const seen: Record<string, { time: number; paused: boolean }> = {};
      for (const el of root.querySelectorAll<HTMLVideoElement>('video')) {
        const id = el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (id) seen[id] = { time: el.currentTime, paused: el.paused };
      }
      if (Object.keys(seen).length) videos.current[frame] = seen;
    }, 250);
    return () => window.clearInterval(tick);
  }, [presenting, stack]);

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
        { duration: move.transition.duration, easing: easingCss(move.transition), fill: 'both' },
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
  const tokens = useTokens();
  const collections = useCollections();

  /**
   * The custom properties one mode of one collection sets.
   *
   * "Set variable mode" is "set variable" for a whole collection at once, so it
   * resolves to the same thing: declarations re-declared on the stage.
   */
  const modeVars = useCallback(
    (collectionId: string, modeId: string): Record<string, string> => {
      const byId = new Map(tokens.map((token) => [token.id, token]));
      const base = defaultModes(collections);
      const out: Record<string, string> = {};
      for (const token of tokens) {
        if ((token.collection ?? DEFAULT_COLLECTION_ID) !== collectionId) continue;
        out[`--${token.name}`] = publish(
          token,
          resolveToken(token, { ...base, [collectionId]: modeId }, byId),
        );
      }
      return out;
    },
    [tokens, collections],
  );
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
      go(hit.interaction, hit.node);
      return true;
    }
    // A hyperlink is an interaction the layer carries without one being drawn:
    // Figma follows it on click while playing, and so does this.
    if (trigger === 'click') {
      const link = linkAt(el?.dataset.nodeId, doc);
      if (link) {
        window.open(link, '_blank', 'noreferrer,noopener');
        return true;
      }
    }
    return false;
  };

  return (
    <SwapContext.Provider value={swaps}>
    <div
      className="fig-present"
      style={
        {
          ...(tokenVars as React.CSSProperties),
          ...overrides,
          ...(background ? { background } : {}),
        } as React.CSSProperties
      }
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
          onChange={(event) => setDevice(event.target.value as PrototypeDevice)}
        >
          {DEVICES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id === 'none' ? 'No frame' : entry.label}
            </option>
          ))}
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
            if (hit) go(hit.interaction, hit.node);
          };
          window.addEventListener('pointerup', onUp);

          fire(event, 'mouse-down');
          // a click that hits nothing flashes the hotspots, as Figma does
          if (!fire(event, 'press') && !fire(event, 'click')) {
            setFlash(true);
            after(() => setFlash(false), HOTSPOT_FLASH_MS);
          }
        }}
        onPointerUp={(event) => {
          fire(event, 'mouse-up');
        }}
        onScrollCapture={(event) => {
          const el = event.target as HTMLElement | null;
          const id = el?.dataset?.nodeId;
          if (!id || !current) return;
          (scrolls.current[current] ??= {})[id] = [el!.scrollLeft, el!.scrollTop];
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
          style={
            device === 'none'
              ? undefined
              : { padding: spec.bezel, borderRadius: spec.radius + spec.bezel }
          }
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

          {/* A frame with a timeline plays it on arrival, from the top. Keyed
              on the frame so walking back to a screen replays it rather than
              finding it already over. */}
          <MotionStyle
            key={`motion-${frame.id}`}
            frame={frame.id}
            scope=".fig-present-screen"
            at={0}
            playing
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
    </SwapContext.Provider>
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
      // move-in leaves the outgoing frame where it is and move-out leaves the
      // incoming one; push and slide take both
      const held =
        (spec.type === 'move' && role === 'outgoing') ||
        (spec.type === 'move-out' && role === 'incoming');
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
      // an "out" transition is the outgoing frame leaving, so that is the one
      // you have to be able to see
      data-leaving={spec?.type === 'move-out' || spec?.type === 'slide-out' ? '' : undefined}
      style={{
        width: node.w,
        height: node.h,
        transform: `scale(${scale}) ${transform}`,
        transformOrigin: '0 0',
        opacity,
        transition: animating
          ? `transform ${spec.duration}ms ${easingCss(spec)}, opacity ${spec.duration}ms ${easingCss(spec)}`
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
