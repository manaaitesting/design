'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useDoc, useStore } from './Session';
import { MOTION_ZOOM, useUI, type SelectedKey } from '../state/ui';
import { Icon } from './ui/Icons';
import {
  DEFAULT_DURATION,
  KEY_EASINGS,
  MAX_DURATION,
  MIN_DURATION,
  PROPERTIES,
  PROPERTY_ORDER,
  whyNot,
  animatedNodes,
  designValue,
  formatTime,
  layersIn,
  isCustomEasing,
  motionOf,
  playheadAt,
  propertiesIn,
  tracksOf,
  trackFor,
  valueAt,
  valueIn,
} from '../document/motion';
import { DEFAULT_BEZIER, DEFAULT_SPRING, easeAt } from '../document/prototype';
import { pageOf } from '../document/types';
import type { Easing, Keyframe, MotionProperty, MotionSpec, MotionTrack } from '../document/types';

/**
 * The timeline — Figma Motion's panel, over this canvas's model.
 *
 * Three things happen here and nowhere else: the playhead is moved, keyframes
 * are placed and dragged, and property edits are recorded onto the frame while
 * the panel is open. Everything the *canvas* does about motion is CSS, written
 * by `MotionStyle` — so nothing in this file paints a layer, and the playhead
 * moving does not re-render the design.
 */
export function Timeline() {
  const frame = useUI((s) => s.motion.frame);
  if (!frame) return null;
  return <TimelinePanel frame={frame} />;
}

/** The ruler's label spacing: the coarsest step that still gives a dozen ticks. */
const STEPS = [50, 100, 250, 500, 1000, 2000, 5000, 10_000];

function tickStep(duration: number, zoom: number): number {
  const room = 12 * zoom;
  return STEPS.find((step) => duration / step <= room) ?? duration;
}

/** The panel's own furniture, in px — the numbers its height is made of. */
const HEAD = 38;
const PROPS = 32;
const RULER = 24;
const ROW = 24;

/** How close a dragged keyframe has to come, in pixels, before it snaps. */
const SNAP_PX = 6;

/**
 * A curve, drawn.
 *
 * The same `easeAt` the sampler interpolates with, walked across the unit
 * square — so a spring shows its overshoot and a back curve shows where it
 * steps outside the box, rather than every easing being drawn as the same
 * hopeful swoosh.
 */
type EaseSpec = Pick<Keyframe, 'easing' | 'bezier' | 'spring'>;

function Curve({ spec, size = 24 }: { spec: EaseSpec; size?: number }) {
  const points: string[] = [];
  const steps = size > 40 ? 48 : 24;
  const pad = size / 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = easeAt({ ...spec, duration: 400 }, t);
    points.push(
      `${(t * (size - pad * 2) + pad).toFixed(2)},${(size - pad - y * (size - pad * 3)).toFixed(2)}`,
    );
  }
  return (
    <svg
      className="mo-curve"
      width={size}
      height={size * (2 / 3)}
      viewBox={`0 0 ${size} ${size * (2 / 3)}`}
      aria-hidden
    >
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/**
 * The numbers behind a custom easing.
 *
 * Figma draws a curve you can pull the handles of, with the numbers beneath;
 * this is the same thing in the timeline's own chrome — the curve is drawn by
 * the sampler that will interpolate it, so what you drag is what you get. A
 * spring has no handles to pull, so it is the three numbers a spring is made
 * of and a preview of what they do.
 */
function CurveEditor({
  spec,
  onChange,
}: {
  spec: EaseSpec;
  onChange: (patch: Partial<Keyframe>) => void;
}) {
  const box = 132;
  const inset = 16;
  const bezier = spec.bezier ?? DEFAULT_BEZIER;
  const spring = spec.spring ?? DEFAULT_SPRING;
  const dragging = useRef<0 | 1 | null>(null);

  /** the unit square, in the SVG's own coordinates — y runs the other way */
  const toScreen = (x: number, y: number): [number, number] => [
    inset + x * (box - inset * 2),
    box - inset - y * (box - inset * 2),
  ];
  const toUnit = (px: number, py: number): [number, number] => [
    Math.min(1, Math.max(0, (px - inset) / (box - inset * 2))),
    (box - inset - py) / (box - inset * 2),
  ];

  const points: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const [x, y] = toScreen(t, easeAt({ ...spec, duration: 400 }, t));
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  if (spec.easing === 'custom-spring') {
    const field = (label: string, key: keyof typeof spring, min: number, max: number, step: number) => (
      <label className="mo-field-row" key={key}>
        <span>{label}</span>
        <input
          className="mo-num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={spring[key]}
          aria-label={label}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) onChange({ spring: { ...spring, [key]: value } });
          }}
        />
      </label>
    );
    return (
      <div className="mo-curve-pop">
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden>
          <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {field('Stiffness', 'stiffness', 1, 1000, 10)}
        {field('Damping', 'damping', 1, 100, 1)}
        {field('Mass', 'mass', 0.1, 20, 0.1)}
      </div>
    );
  }

  const handles: [number, number][] = [
    [bezier[0], bezier[1]],
    [bezier[2], bezier[3]],
  ];
  const grab = (which: 0 | 1) => (event: ReactPointerEvent<SVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = which;
    const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as unknown as SVGSVGElement);
    const move = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const [x, y] = toUnit(e.clientX - rect.left, e.clientY - rect.top);
      const next = [...bezier] as [number, number, number, number];
      next[which * 2] = Math.round(x * 100) / 100;
      // a control point may leave the box on the y axis: that is what makes a
      // curve overshoot, which is the reason to reach for a custom one
      next[which * 2 + 1] = Math.round(Math.min(2, Math.max(-1, y)) * 100) / 100;
      onChange({ bezier: next });
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const [sx, sy] = toScreen(0, 0);
  const [ex, ey] = toScreen(1, 1);
  return (
    <div className="mo-curve-pop">
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <rect
          x={inset}
          y={inset}
          width={box - inset * 2}
          height={box - inset * 2}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
        />
        {handles.map((point, index) => {
          const [hx, hy] = toScreen(point[0], point[1]);
          const [ax, ay] = index === 0 ? [sx, sy] : [ex, ey];
          return (
            <g key={index}>
              <line x1={ax} y1={ay} x2={hx} y2={hy} stroke="currentColor" strokeOpacity="0.4" />
              <circle
                cx={hx}
                cy={hy}
                r={5}
                fill="var(--color-select, #0d99ff)"
                stroke="#fff"
                strokeWidth="1"
                style={{ cursor: 'grab' }}
                onPointerDown={grab(index as 0 | 1)}
              />
            </g>
          );
        })}
        <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="mo-curve-nums">
        {bezier.map((value, index) => (
          <input
            key={index}
            className="mo-num"
            type="number"
            step={0.01}
            value={value}
            aria-label={['X1', 'Y1', 'X2', 'Y2'][index]}
            onChange={(event) => {
              const next = [...bezier] as [number, number, number, number];
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              next[index] = parsed;
              onChange({ bezier: next });
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** What a track reads at the playhead, short enough to sit in a name row. */
function readout(property: MotionProperty, value: number | string | undefined): string {
  if (value === undefined) return '';
  if (PROPERTIES[property].kind === 'color') return String(value);
  const n = Number(value);
  const rounded = Math.abs(n) < 10 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10;
  return `${rounded}${PROPERTIES[property].suffix ?? ''}`;
}

/** "ease-in-back" reads as "Ease in back" in the menu, as Figma writes it. */
function easingLabel(easing: Easing): string {
  return easing.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function TimelinePanel({ frame }: { frame: string }) {
  const doc = useDoc();
  const store = useStore();
  const at = useUI((s) => s.motion.at);
  const playing = useUI((s) => s.motion.playing);
  const recording = useUI((s) => s.motion.recording);
  const selected = useUI((s) => s.motion.selected);
  const zoom = useUI((s) => s.motion.zoom);
  const clipboard = useUI((s) => s.motionClipboard);
  /** the rubber band, while one is being drawn over the lanes */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** whether the numbers behind a custom easing are showing */
  const [curveOpen, setCurveOpen] = useState(false);
  const selection = useUI((s) => s.selection);
  const page = useUI((s) => s.page);
  /**
   * The duration field while it is being typed in.
   *
   * Committing on every keystroke would clamp "2" to the minimum before the
   * "500" arrived, so the field holds what you typed until you leave it or
   * press ⏎ — the same bargain `NumberField` makes in the inspector.
   */
  const [draft, setDraft] = useState<string | null>(null);

  /**
   * The ruler, which is the row every time in the panel is measured against.
   *
   * It is a plain block child of the lane column, so its width is exactly the
   * span 0 → duration is drawn across — the column itself is inset a few
   * pixels so a keyframe sitting on 0 or on the very end is not sliced in half
   * by the edge of the panel.
   */
  const lanesRef = useRef<HTMLDivElement>(null);
  /** the box the lanes scroll inside, once the timeline is wider than it */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** the stretched box the lanes are drawn in — what a rubber band is measured against */
  const spanRef = useRef<HTMLDivElement>(null);
  /** a time to hold still across a zoom, and where on the screen to hold it */
  const anchorRef = useRef<{ at: number; clientX: number } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  /** the playhead as the *recorder* sees it, which during playback is moving */
  const atRef = useRef(at);

  const node = doc[frame];
  const spec = motionOf(node);
  const duration = spec?.duration ?? DEFAULT_DURATION;
  const loop = spec?.loop ?? true;

  /**
   * How far one press of an arrow moves in time.
   *
   * A tenth of the ruler's own tick, so the step means the same thing at every
   * zoom: ten presses cross one labelled division whether the timeline is
   * showing five seconds or half of one.
   */
  const nudge = Math.max(1, Math.round(tickStep(duration, zoom) / 10));

  /** Every moment something happens on this timeline, in order. */
  const keyTimes = (): number[] =>
    [...new Set((spec?.tracks ?? []).flatMap((track) => track.keys.map((key) => key.at)))].sort(
      (a, b) => a - b,
    );

  // ── The layer a new keyframe would land on ─────────────────────────────
  const inFrame = (id: string): boolean => {
    let current = doc[id];
    while (current?.parent) {
      if (current.parent === frame) return true;
      current = doc[current.parent];
    }
    return false;
  };
  const layers = animatedNodes(spec, doc, frame);
  const picked = selection.filter(inFrame);
  const current = picked[0] ?? layers[0] ?? null;
  // Every layer the timeline drives, plus the selected one — which is how a
  // layer with no tracks yet has somewhere for its first keyframe to appear.
  // Listed in the order the layer tree reads, so the panel does not reshuffle
  // itself every time the selection moves.
  const shown = new Set([...picked, ...layers]);
  const rows = layersIn(doc, frame).filter((id) => shown.has(id));

  // ── Recording ──────────────────────────────────────────────────────────
  // While the panel is open, editing a property writes a keyframe at the
  // playhead — the layer's own value goes on being written too, so a drag
  // still drags, and the key it records reads back as exactly that value.
  useEffect(() => {
    if (!recording) return;
    store.recorder = (id, patch, before) => {
      if (id === frame || !inFrame(id)) return;
      // Recording into a playhead that is moving smears one edit across the
      // timeline, so the edit stops the playback first and lands where the
      // playhead had got to.
      const ui = useUI.getState();
      if (ui.motion.playing) ui.setMotionPlaying(false);
      for (const property of propertiesIn(patch)) {
        const value = valueIn(patch, property);
        if (value === undefined) continue;
        // a patch of a nested spec — a stroke, an effect — names every field in
        // it, so only the ones that actually moved are keyframed
        if (before && designValue(before, property) === value) continue;
        store.setKeyframe(frame, id, property, atRef.current, value);
      }
    };
    return () => {
      store.recorder = null;
    };
    // `doc` is a dependency because the closure asks it whether the layer being
    // edited is inside this frame, and a stale answer would record onto the
    // wrong timeline.
  }, [recording, frame, store, doc]);

  useEffect(() => {
    if (!playing) atRef.current = at;
  }, [at, playing]);

  // ── Playback ───────────────────────────────────────────────────────────
  // The browser is already animating the canvas from a running CSS animation;
  // this only walks the panel's own playhead along, and it does that by
  // writing to the two elements that show it rather than through state. A
  // re-render here would rewrite the stylesheet and restart what it is meant
  // to be following.
  useEffect(() => {
    if (!playing) return;
    const timeline: MotionSpec = spec ?? { duration, loop, tracks: [] };
    // where the playhead *is*, not where the store last heard it was: an edit
    // made while it runs restarts this effect, and reading the state would
    // snap the playhead back to where playback began
    const from = atRef.current;
    const startedAt = performance.now();
    let raf = 0;

    const tick = (now: number): void => {
      const head = playheadAt(timeline, from, now - startedAt);
      atRef.current = head;
      if (headRef.current) headRef.current.style.left = `${(head / duration) * 100}%`;
      if (clockRef.current) clockRef.current.textContent = formatTime(head);
      // zoomed in, the playhead runs off the side long before the timeline
      // ends — the lanes follow it rather than leaving you watching an empty
      // stretch of a track
      const scroller = scrollRef.current;
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        const x = (head / duration) * scroller.scrollWidth;
        const left = scroller.scrollLeft;
        if (x < left || x > left + scroller.clientWidth - 24) {
          scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
        }
      }
      if (!timeline.loop && head >= duration) {
        useUI.getState().setMotionPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // leave the playhead where it actually got to, so pause pauses
      useUI.getState().setMotionAt(playheadAt(timeline, from, performance.now() - startedAt));
    };
    // `at` is deliberately not a dependency: the playhead moving is the thing
    // this effect *does*, and re-running on every tick is exactly what it
    // avoids — a re-render would rewrite the stylesheet and restart the very
    // animation it is following.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, loop, spec]);

  // The zoom has landed: scroll so the moment the gesture was about is back
  // where it was on the screen. A layout effect, so the scroll happens in the
  // same frame as the widening and nothing is seen to jump.
  useLayoutEffect(() => {
    const hold = anchorRef.current;
    const scroller = scrollRef.current;
    const field = lanesRef.current;
    if (!hold || !scroller || !field) return;
    anchorRef.current = null;
    const rect = field.getBoundingClientRect();
    const wanted = rect.left + (hold.at / Math.max(1, duration)) * rect.width;
    scroller.scrollLeft += wanted - hold.clientX;
  }, [zoom, duration]);

  // Shortening a timeline can leave the playhead past its end — where the
  // panel would draw it outside the lanes and the canvas would hold the last
  // keyframe. It comes back to the end instead.
  useEffect(() => {
    if (at > duration) useUI.getState().setMotionAt(duration);
  }, [at, duration]);

  // A timeline belongs to a frame you can see. If the frame is deleted, or you
  // walk to another page, the panel goes with it rather than sitting open over
  // a board that is not there.
  useEffect(() => {
    if (!node || pageOf(frame, doc) !== page) useUI.getState().openMotion(null);
  }, [node, frame, doc, page]);

  // ── What the keyboard means while keys are selected ────────────────────
  // ⌫ removes them, ⌘C copies them and ⌘V puts them down at the playhead. The
  // editor's own handlers stand back while this one has something selected —
  // see `Editor`, where ⌫ and the clipboard check the same thing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.isContentEditable)) return;
      const mod = event.metaKey || event.ctrlKey;

      if (!mod && (event.key === 'Backspace' || event.key === 'Delete') && selected.length) {
        event.preventDefault();
        store.removeKeyframes(frame, selected);
        store.commit();
        useUI.getState().selectKeyframes([]);
        return;
      }
      if (mod && event.key.toLowerCase() === 'c' && selected.length) {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'v' && clipboard.length) {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      // ── Time, from the keyboard ──────────────────────────────────────────
      // Getting the playhead exactly onto a keyframe was a drag on a 24px
      // strip; in Figma it is a keystroke. ←/→ step, ⇧ jumps ten steps, ⌥ goes
      // to the next key there is, and Home/End are the two ends. With keys
      // selected the same arrows move the keys instead, which is what the
      // canvas's own nudge means and why it stands down for us.
      const ends = event.key === 'Home' || event.key === 'End';
      const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      if (!mod && (arrow || ends)) {
        const ui = useUI.getState();
        if (arrow && selected.length) {
          event.preventDefault();
          const by = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? nudge * 10 : nudge);
          store.updateKeyframes(
            frame,
            selected,
            (key) => ({ at: Math.max(0, Math.min(duration, Math.round(key.at + by))) }),
          );
          store.commit();
          return;
        }
        event.preventDefault();
        ui.setMotionPlaying(false);
        if (ends) {
          ui.setMotionAt(event.key === 'Home' ? 0 : duration);
          return;
        }
        const back = event.key === 'ArrowLeft';
        if (event.altKey) {
          const times = keyTimes();
          const next = back
            ? [...times].reverse().find((t) => t < at)
            : times.find((t) => t > at);
          ui.setMotionAt(next ?? (back ? 0 : duration));
          return;
        }
        const by = (back ? -1 : 1) * (event.shiftKey ? nudge * 10 : nudge);
        ui.setMotionAt(Math.max(0, Math.min(duration, at + by)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // the copy and paste closures read the current selection, spec and playhead,
    // and the time keys read the duration and the step the zoom implies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, clipboard, frame, store, spec, at, duration, nudge]);

  if (!node) return null;

  // ── Time ↔ pixels ──────────────────────────────────────────────────────
  const msAt = (clientX: number): number => {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, ratio)) * duration);
  };

  const scrub = (event: ReactPointerEvent): void => {
    event.preventDefault();
    const ui = useUI.getState();
    ui.setMotionPlaying(false);
    // a press on the empty part of a lane is also how a keyframe is deselected
    ui.selectKeyframes([]);
    ui.setMotionAt(msAt(event.clientX));
    const move = (e: PointerEvent) => useUI.getState().setMotionAt(msAt(e.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * The moments a dragged key snaps to: the ends, the playhead, and every
   * other key on the timeline — including the ones on other tracks, because
   * two properties changing together is the thing you are usually trying to
   * line up.
   */
  const snapped = (ms: number, exclude: string): number => {
    const rect = lanesRef.current?.getBoundingClientRect();
    const tolerance = rect?.width ? (SNAP_PX / rect.width) * duration : 0;
    const targets = [
      0,
      duration,
      at,
      ...(spec?.tracks.flatMap((entry) =>
        entry.keys.filter((k) => k.id !== exclude).map((k) => k.at),
      ) ?? []),
    ];
    let best = ms;
    let distance = tolerance;
    for (const target of targets) {
      const away = Math.abs(target - ms);
      if (away <= distance) {
        best = target;
        distance = away;
      }
    }
    return best;
  };

  /**
   * Zooming holds a moment still.
   *
   * Which moment depends on where the gesture came from: under the pointer for
   * a wheel, and the playhead for the buttons — so a zoom is always *about*
   * something you were looking at rather than about the start of the timeline.
   */
  const zoomBy = (factor: number, clientX?: number): void => {
    const rect = lanesRef.current?.getBoundingClientRect();
    const box = scrollRef.current?.getBoundingClientRect();
    const holdX = clientX ?? (box ? box.left + box.width / 2 : 0);
    anchorRef.current = rect ? { at: msAt(holdX), clientX: holdX } : null;
    useUI.getState().setMotionZoom(zoom * factor);
  };

  const onWheel = (event: ReactWheelEvent): void => {
    // ⌘ or ⌃ with the wheel zooms, as it does on the canvas; a bare wheel is
    // left to the scroller, which is what it is for
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX);
  };

  const dragKey = (track: MotionTrack, key: Keyframe) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const ui = useUI.getState();
    const already = ui.motion.selected.some((entry) => entry.key === key.id);
    const additive = event.shiftKey || event.metaKey;
    const here = { track: track.id, key: key.id };

    // ⇧ or ⌘ adds a key to the selection, or takes it out again; a plain press
    // on a key that is already in one keeps the group, which is what makes
    // dragging several of them possible
    const picked: SelectedKey[] = additive
      ? already
        ? ui.motion.selected.filter((entry) => entry.key !== key.id)
        : [...ui.motion.selected, here]
      : already
        ? ui.motion.selected
        : [here];
    ui.selectKeyframes(picked);
    if (additive) return;

    // where each of them started, so the drag is absolute rather than
    // cumulative — every pointer move sets positions, it does not add to them
    const origin = new Map<string, number>();
    for (const ref of picked) {
      const found = spec?.tracks
        .find((entry) => entry.id === ref.track)
        ?.keys.find((entry) => entry.id === ref.key);
      if (found) origin.set(ref.key, found.at);
    }

    let moved = false;
    const move = (e: PointerEvent) => {
      moved = true;
      // ⌥ is the escape hatch, as it is for snapping on the canvas
      const ms = msAt(e.clientX);
      const target = e.altKey ? ms : snapped(ms, key.id);
      const delta = target - key.at;
      store.updateKeyframes(frame, picked, (entry) => ({
        at: (origin.get(entry.id) ?? entry.at) + delta,
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * A press on empty lane space draws a band, and the keys it crosses are the
   * selection.
   *
   * The band is measured against the elements rather than against the model:
   * where a keyframe *is* on the screen is a layout question, and the layout
   * is already there to be asked. ⇧ keeps what was selected before.
   */
  const marquee = (event: ReactPointerEvent): void => {
    event.preventDefault();
    const span = spanRef.current;
    if (!span) return;
    const additive = event.shiftKey || event.metaKey;
    const before = additive ? useUI.getState().motion.selected : [];
    if (!additive) useUI.getState().selectKeyframes([]);
    const from = { x: event.clientX, y: event.clientY };

    const apply = (e: PointerEvent | ReactPointerEvent): void => {
      const box = span.getBoundingClientRect();
      const left = Math.min(from.x, e.clientX);
      const top = Math.min(from.y, e.clientY);
      const right = Math.max(from.x, e.clientX);
      const bottom = Math.max(from.y, e.clientY);
      setBand({ x: left - box.left, y: top - box.top, w: right - left, h: bottom - top });

      const hits: SelectedKey[] = [];
      for (const el of span.querySelectorAll<HTMLElement>('.mo-key')) {
        const rect = el.getBoundingClientRect();
        const inside =
          rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        const trackId = el.closest<HTMLElement>('[data-track]')?.dataset.track;
        if (inside && trackId && el.dataset.key) hits.push({ track: trackId, key: el.dataset.key });
      }
      const seen = new Set(before.map((entry) => entry.key));
      useUI.getState().selectKeyframes([...before, ...hits.filter((hit) => !seen.has(hit.key))]);
    };

    const move = (e: PointerEvent) => apply(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBand(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** ⌘C: the selection, as times relative to the earliest of them. */
  const copySelection = (): void => {
    const keys = selected
      .map((ref) => {
        const track = spec?.tracks.find((entry) => entry.id === ref.track);
        const key = track?.keys.find((entry) => entry.id === ref.key);
        return track && key ? { track, key } : null;
      })
      .filter((entry): entry is { track: MotionTrack; key: Keyframe } => !!entry);
    if (!keys.length) return;
    const earliest = Math.min(...keys.map((entry) => entry.key.at));
    useUI.getState().copyKeyframes(
      keys.map(({ track, key }) => ({
        node: track.node,
        property: track.property,
        offset: key.at - earliest,
        value: key.value,
        easing: key.easing,
      })),
    );
  };

  /** ⌘V: the copy, on the tracks it came from, starting at the playhead. */
  const pasteClipboard = (): void => {
    const refs = store.addKeyframes(
      frame,
      clipboard.map((entry) => ({
        node: entry.node,
        property: entry.property as MotionProperty,
        at: at + entry.offset,
        key: { value: entry.value, easing: entry.easing as Easing },
      })),
    );
    store.commit();
    // leave the paste selected: it is what you are about to move
    if (refs.length) useUI.getState().selectKeyframes(refs);
  };

  const commitDuration = (): void => {
    const next = Number(draft);
    setDraft(null);
    if (draft === null || !Number.isFinite(next)) return;
    store.setMotion(frame, {
      duration: Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(next))),
    });
    store.commit();
  };

  /** A key at the playhead holding whatever the property reads there now. */
  const keyHere = (id: string, property: MotionProperty): void => {
    const layer = doc[id];
    if (!layer) return;
    const track = trackFor(spec, id, property);
    const value = track ? (valueAt(track, at) ?? designValue(layer, property)) : designValue(layer, property);
    store.setKeyframe(frame, id, property, at, value);
    store.commit();
  };

  /**
   * The panel is as tall as it needs to be.
   *
   * A timeline with two tracks on it should not reserve the room a timeline
   * with twelve would want, and one with forty should not push the canvas off
   * the screen — so it grows with its rows and stops, after which the lanes
   * scroll inside it.
   */
  const laneRows = rows.reduce((total, id) => total + 1 + tracksOf(spec, id).length, 0);
  const height = Math.min(
    460,
    // the scrollbar under the lanes is 6px, and it would otherwise eat the
    // last row rather than sit under it
    Math.max(150, HEAD + (current ? PROPS : 0) + RULER + laneRows * ROW + 6 + (zoom > 1 ? 8 : 0)),
  );

  const step = tickStep(duration, zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  // the easing menu reads the first key of the selection and writes all of it,
  // which is what "these three all ease out" has to mean
  const first = selected[0];
  const selectedKey = spec?.tracks
    .find((track) => track.id === first?.track)
    ?.keys.find((key) => key.id === first?.key);

  return (
    <div className="mo-panel" data-frame={frame} style={{ height }}>
      <div className="mo-head">
        <span className="mo-title" title="The frame this timeline belongs to">
          {node.name}
        </span>

        <button
          type="button"
          className="mo-btn"
          data-on={playing ? 'true' : undefined}
          title={playing ? 'Pause' : 'Play'}
          onClick={() => useUI.getState().setMotionPlaying(!playing)}
        >
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
        <button
          type="button"
          className="mo-btn"
          title="Back to the start"
          onClick={() => {
            const ui = useUI.getState();
            ui.setMotionPlaying(false);
            ui.setMotionAt(0);
          }}
        >
          <Icon.Reset />
        </button>
        <button
          type="button"
          className="mo-btn"
          data-on={loop ? 'true' : undefined}
          title="Loop"
          onClick={() => {
            store.setMotion(frame, { loop: !loop });
            store.commit();
          }}
        >
          <Icon.Loop />
        </button>

        <span className="mo-clock">
          <span ref={clockRef}>{formatTime(at)}</span>
          <span className="mo-clock-total"> / {formatTime(duration)}</span>
        </span>

        <label className="mo-duration" title="How long the timeline runs">
          <input
            className="mo-num"
            type="number"
            min={MIN_DURATION}
            max={MAX_DURATION}
            step={50}
            value={draft ?? String(duration)}
            aria-label="Duration in milliseconds"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDuration}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDuration();
              if (event.key === 'Escape') setDraft(null);
            }}
          />
          <span>ms</span>
        </label>

        <span className="mo-zoom">
          <button
            type="button"
            className="mo-btn"
            title="Zoom the timeline out"
            disabled={zoom <= MOTION_ZOOM.min}
            onClick={() => zoomBy(1 / MOTION_ZOOM.step)}
          >
            <Icon.Minus />
          </button>
          <button
            type="button"
            className="mo-btn mo-zoom-level"
            title="Fit the whole timeline"
            onClick={() => useUI.getState().setMotionZoom(1)}
          >
            {zoom === 1 ? 'Fit' : `${Math.round(zoom * 10) / 10}×`}
          </button>
          <button
            type="button"
            className="mo-btn"
            title="Zoom the timeline in"
            disabled={zoom >= MOTION_ZOOM.max}
            onClick={() => zoomBy(MOTION_ZOOM.step)}
          >
            <Icon.Plus />
          </button>
        </span>

        <button
          type="button"
          className="mo-btn mo-record"
          data-on={recording ? 'true' : undefined}
          title={
            recording
              ? 'Recording: an edit writes a keyframe at the playhead'
              : 'Not recording: edits change the layer, not the timeline'
          }
          onClick={() => useUI.getState().setMotionRecording(!recording)}
        >
          <span className="mo-dot" />
          Record
        </button>

        {selectedKey && (
          <span className="mo-curve-wrap">
            <button
              type="button"
              className="mo-btn mo-curve-btn"
              data-on={curveOpen ? 'true' : undefined}
              disabled={!isCustomEasing(selectedKey.easing)}
              title={
                isCustomEasing(selectedKey.easing)
                  ? 'The numbers behind this curve'
                  : 'The curve this keyframe leaves on'
              }
              onClick={() => setCurveOpen((open) => !open)}
            >
              <Curve spec={selectedKey} />
            </button>
            <select
              className="mo-select"
              title={
                selected.length > 1
                  ? `How these ${selected.length} keyframes leave toward the next`
                  : 'How this keyframe leaves toward the next'
              }
              aria-label="Keyframe easing"
              value={selectedKey.easing}
              onChange={(event) => {
                const easing = event.target.value as Easing;
                // a custom easing arrives with the numbers it is made of, so
                // the keyframe says what it means rather than leaning on a
                // default two modules away
                store.updateKeyframes(frame, selected, {
                  easing,
                  ...(easing === 'custom-bezier' && !selectedKey.bezier
                    ? { bezier: DEFAULT_BEZIER }
                    : {}),
                  ...(easing === 'custom-spring' && !selectedKey.spring
                    ? { spring: DEFAULT_SPRING }
                    : {}),
                });
                store.commit();
                setCurveOpen(isCustomEasing(easing));
              }}
            >
              {KEY_EASINGS.map((easing) => (
                <option key={easing} value={easing}>
                  {easingLabel(easing)}
                </option>
              ))}
            </select>
            {curveOpen && isCustomEasing(selectedKey.easing) && (
              <CurveEditor
                spec={selectedKey}
                onChange={(patch) => {
                  store.updateKeyframes(frame, selected, patch);
                  store.commit();
                }}
              />
            )}
          </span>
        )}

        <button
          type="button"
          className="mo-btn mo-close"
          title="Close the timeline"
          onClick={() => useUI.getState().openMotion(null)}
        >
          <Icon.Close />
        </button>
      </div>

      {current && (
        <div className="mo-props">
          <span className="mo-props-label">{doc[current]?.name}</span>
          {PROPERTY_ORDER.map((property) => {
            // a greyed chip says why it is greyed, and there are five different
            // whys — a chip for a stroke the layer does not have used to blame
            // the fill for being a gradient
            const why = whyNot(doc[current], property);
            return (
              <button
                type="button"
                key={property}
                className="mo-chip"
                data-on={trackFor(spec, current, property) ? 'true' : undefined}
                disabled={!!why}
                title={why ?? `Keyframe ${PROPERTIES[property].label.toLowerCase()} at the playhead`}
                onClick={() => keyHere(current, property)}
              >
                {PROPERTIES[property].label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mo-body">
        <div className="mo-names">
          <div className="mo-ruler-gutter" />
          {rows.map((id) => {
            const tracks = tracksOf(spec, id);
            return (
              <div key={id} className="mo-name-group">
                <button
                  type="button"
                  className="mo-name"
                  title="Select this layer"
                  onClick={() => useUI.getState().select([id])}
                  data-on={current === id ? 'true' : undefined}
                >
                  {doc[id]?.name}
                </button>
                {tracks.map((track) => (
                  <div key={track.id} className="mo-track-name">
                    <span>{PROPERTIES[track.property].label}</span>
                    {/* what the track reads *here*, which is the number the
                        canvas is currently showing rather than the layer's own */}
                    <span className="mo-value">{readout(track.property, valueAt(track, at))}</span>
                    <button
                      type="button"
                      className="mo-btn mo-drop"
                      title="Remove this track"
                      onClick={() => {
                        store.removeTrack(frame, track.id);
                        store.commit();
                      }}
                    >
                      <Icon.Close />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="mo-lanes" ref={scrollRef} onWheel={onWheel}>
          {/* As wide as the zoom says. Every position inside is a percentage of
              this box, so the ruler, the lanes and the playhead go on meaning
              the same moment however far it is stretched. */}
          <div className="mo-span" ref={spanRef} style={{ width: `${zoom * 100}%` }}>
          <div className="mo-ruler" onPointerDown={scrub}>
            <div className="mo-field" ref={lanesRef}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="mo-tick"
                  // the last label hangs to the left of its line rather than
                  // off the end of the timeline, where it would widen the
                  // scroller past the lanes and leave a strip that scrubs
                  // nothing
                  data-end={t === ticks[ticks.length - 1] ? 'true' : undefined}
                  style={{ left: `${(t / duration) * 100}%` }}
                >
                  {formatTime(t)}
                </span>
              ))}
            </div>
          </div>

          {rows.map((id) => (
            <div key={id} className="mo-lane-group">
              <div className="mo-lane mo-lane-layer" onPointerDown={marquee} />
              {tracksOf(spec, id).map((track) => (
                <div
                  key={track.id}
                  className="mo-lane"
                  data-track={track.id}
                  onPointerDown={marquee}
                  onDoubleClick={(event) => {
                    const when = msAt(event.clientX);
                    const value = valueAt(track, when);
                    if (value !== undefined) {
                      store.setKeyframe(frame, track.node, track.property, when, value);
                      store.commit();
                    }
                  }}
                >
                  <div className="mo-field">
                    {track.keys.map((key) => (
                      <button
                        key={key.id}
                        type="button"
                        className="mo-key"
                        data-key={key.id}
                        data-on={selected.some((entry) => entry.key === key.id) ? 'true' : undefined}
                        // a key left beyond a shortened timeline is drawn at
                        // the end rather than off the edge, where it could
                        // neither be seen nor dragged back
                        data-past={key.at > duration ? 'true' : undefined}
                        style={{ left: `${Math.min(100, (key.at / duration) * 100)}%` }}
                        title={`${PROPERTIES[track.property].label} ${key.value} at ${formatTime(key.at)}`}
                        onPointerDown={dragKey(track, key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {band && (
            <div
              className="mo-band"
              style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
            />
          )}

          <div className="mo-playhead-area">
            <div ref={headRef} className="mo-playhead" style={{ left: `${(at / duration) * 100}%` }}>
              <span className="mo-playhead-grip" />
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
