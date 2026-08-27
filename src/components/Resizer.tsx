'use client';

import { useRef, useState } from 'react';

interface ResizerProps {
  /** which panel the handle belongs to — decides which way a drag grows it */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  label: string;
  onResize: (width: number) => void;
  /** double-click, and the arrow keys' anchor */
  onReset: () => void;
}

/** px per arrow-key press; Shift multiplies it, as elsewhere in the editor */
const STEP = 16;

/**
 * The drag handle between a panel and the canvas.
 *
 * It takes no layout width of its own — the hit area is a pseudo-element
 * straddling the panel's existing 1px border, so adding a handle never shifts
 * the panel it sits beside.
 */
export function Resizer({ side, width, min, max, label, onResize, onReset }: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, width: 0 });

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // stop the pointer-down from starting a text selection across the panel
    event.preventDefault();
    origin.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    // keep the resize cursor while the pointer is out over the canvas
    document.body.classList.add('fig-resizing');
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = event.clientX - origin.current.x;
    // dragging right grows the left panel and shrinks the right one
    onResize(origin.current.width + (side === 'left' ? dx : -dx));
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    document.body.classList.remove('fig-resizing');
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onReset();
      return;
    }
    const towards = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!towards) return;
    event.preventDefault();
    event.stopPropagation(); // the editor nudges the selection with the arrows
    const step = STEP * (event.shiftKey ? 4 : 1);
    onResize(width + towards * step * (side === 'left' ? 1 : -1));
  };

  return (
    <div
      className="fig-resizer"
      data-side={side}
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
