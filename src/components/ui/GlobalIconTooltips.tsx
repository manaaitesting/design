'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function GlobalIconTooltips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    let hideTimer: number | null = null;
    let currentEl: HTMLElement | null = null;
    let currentLabel: string | null = null;

    const getLabel = (el: HTMLElement): string | null => {
      // explicit data-tooltip from Figma island or shadcn triggers
      const dt = el.getAttribute('data-tooltip');
      if (dt && dt !== 'main-menu') return dt === 'main-menu' ? 'Main menu' : dt;
      // otherwise whatever the control already calls itself
      return el.getAttribute('title') || el.getAttribute('aria-label') || null;
    };

    const isInsideShadcnTrigger = (el: HTMLElement) => !!el.closest('[data-slot="tooltip-trigger"]');

    const onEnter = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('button, [role="button"], a, [data-tooltip], [title], [aria-label]');
      if (!target) return;
      // already handled by explicit shadcn Tooltip — skip to avoid double
      if (isInsideShadcnTrigger(target)) return;
      // only for icons / buttons that actually have a label
      const label = getLabel(target);
      if (!label) return;
      // icons without visible text should always get a tooltip; text buttons already have it but shadcn FigButton covers them
      // skip large text buttons that already have FigButton tooltip
      const hasShadcn = !!target.closest('[data-slot="tooltip"]');
      if (hasShadcn) return;
      // a trigger whose menu is already open needs no label — the tooltip
      // would sit on top of the rows it opened
      if (target.getAttribute('aria-expanded') === 'true') return;

      // A `mouseover` does not mean the pointer moved. The browser fires one
      // whenever the DOM under a resting cursor changes, which during playback
      // is every frame — and measuring the target below forces a layout, so
      // taking that at face value costs a layout per frame and visibly slows
      // the animation the cursor happens to be resting on. Nothing has changed
      // for us unless the element or its label has.
      if (target === currentEl && label === currentLabel) return;
      currentLabel = label;

      // The `title` stays where it is. Taking it off the element while the
      // pointer rests there is the obvious way to keep the browser's own
      // tooltip from showing up underneath this one, and it is what this did —
      // but `title` is the accessible name of every control that carries no
      // `aria-label`, and the handle much of the app is addressed by, so a
      // control that is merely hovered must not lose it. A native tooltip
      // after a long rest is the smaller price. The way to have neither is for
      // a control to wrap itself in `Tooltip` as `FigButton` does; this is the
      // fallback for the ones that do not.
      currentEl = target;
      // position below, centered; for rail (left: <48px) show on right
      const rect = target.getBoundingClientRect();
      setTip({ text: label, rect });
      if (hideTimer) window.clearTimeout(hideTimer);
    };

    const onLeave = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // if moving inside same button/icon, ignore
      if (related && currentEl && currentEl.contains(related)) return;
      // small delay to avoid flicker when crossing to tooltip itself
      hideTimer = window.setTimeout(() => setTip(null), 80) as unknown as number;
      currentEl = null;
      currentLabel = null;
    };

    const onScroll = () => setTip(null);
    // a click is an answer to the label; Figma drops the tooltip the moment
    // the button is pressed, and so does a menu opening under it
    const onPress = () => {
      setTip(null);
      currentEl = null;
      currentLabel = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null);
    };

    document.addEventListener('mouseover', onEnter, true);
    document.addEventListener('mouseout', onLeave, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('mouseover', onEnter, true);
      document.removeEventListener('mouseout', onLeave, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress, true);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, []);

  if (!tip || typeof document === 'undefined') return null;

  const { text, rect } = tip;
  // rail on left edge -> tooltip on right, otherwise below
  const isRail = rect.left < 56;
  const side = isRail ? 'right' : 'bottom';
  const gap = 8;

  // compute fixed position near rect
  let top = 0;
  let left = 0;
  if (side === 'right') {
    top = rect.top + rect.height / 2;
    left = rect.right + gap;
  } else {
    top = rect.bottom + gap;
    left = rect.left + rect.width / 2;
  }

  const transform = side === 'right' ? 'translateY(-50%)' : 'translateX(-50%)';

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        top,
        left,
        transform,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
      className="max-w-[260px] rounded-md bg-[#1e1e1e] px-2.5 py-1.5 text-[11px] font-medium leading-none text-white shadow-[0_4px_12px_rgba(0,0,0,0.24),0_0_0_1px_rgba(255,255,255,0.08)]"
    >
      <p className="m-0 whitespace-nowrap">{text}</p>
      {/* tiny arrow */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          width: 8,
          height: 8,
          background: '#1e1e1e',
          transform: 'rotate(45deg)',
          ...(side === 'right'
            ? { left: -4, top: '50%', marginTop: -4 }
            : { top: -4, left: '50%', marginLeft: -4 }),
          boxShadow: side === 'right' ? '-1px 1px 0 rgba(255,255,255,0.08)' : '0 -1px 0 rgba(255,255,255,0.08)',
        }}
      />
    </div>,
    document.body,
  );
}
