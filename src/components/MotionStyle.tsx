'use client';

import { useMemo } from 'react';
import { motionCss, motionOf } from '../document/motion';
import { useUI } from '../state/ui';
import { useDoc } from './Session';

/**
 * A frame's timeline, as a stylesheet.
 *
 * The canvas does not animate anything: it declares the animation and the
 * browser runs it. That is why scrubbing costs nothing — a scrub changes one
 * number in `animation-delay` on a paused animation, and the compositor
 * repaints — and why playing costs nothing either, since this element does not
 * re-render while the playhead moves. The panel's head is drawn on its own.
 *
 * A `<style>` rather than injected rules, for the reason `FontFaces` gives:
 * React owns it, it updates when the document does, and it leaves with the
 * editor.
 */
export function MotionStyle({
  frame,
  scope,
  at,
  playing,
  loop,
}: {
  frame: string;
  /** what the rules are scoped to, so the canvas and the player never collide */
  scope: string;
  at: number;
  playing: boolean;
  loop?: boolean;
}) {
  const doc = useDoc();
  const spec = motionOf(doc[frame]);
  const css = useMemo(
    () => motionCss(spec, doc, { scope, at, playing, loop }),
    [spec, doc, scope, at, playing, loop],
  );
  if (!css) return null;
  return <style data-motion={frame}>{css}</style>;
}

/**
 * The canvas's own, subscribed to here rather than in `Canvas`.
 *
 * A scrub moves the playhead many times a second. Reading it in `Canvas` would
 * re-render the board on every tick to rewrite one declaration; reading it in
 * here re-renders this element, whose whole output is a string.
 */
export function CanvasMotion() {
  const frame = useUI((s) => s.motion.frame);
  const at = useUI((s) => s.motion.at);
  const playing = useUI((s) => s.motion.playing);
  if (!frame) return null;
  return <MotionStyle frame={frame} scope="[data-canvas-root]" at={at} playing={playing} />;
}
