import type { ReactNode, SVGProps } from 'react';

/** All chrome icons share a 16px box and a 1.25px stroke, matching Paper's rail. */
function Svg({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** an evenly spaced dot field, for the blur and texture glyphs */
function grid(step: number, radius: number): ReactNode {
  const dots = [];
  for (let row = 0; row < step; row++) {
    for (let column = 0; column < step; column++) {
      dots.push(
        <circle
          key={`${row}-${column}`}
          cx={3.2 + (column * 9.6) / (step - 1)}
          cy={3.2 + (row * 9.6) / (step - 1)}
          r={radius}
          fill="currentColor"
          strokeWidth={0}
        />,
      );
    }
  }
  return dots;
}

/** a deliberately irregular dot field — noise, not a grid */
function scatter(): ReactNode {
  const points: [number, number, number][] = [
    [3.2, 3.6, 1.05], [7.4, 2.9, 0.75], [11.8, 4.2, 1.05], [5.1, 6.6, 0.75],
    [9.4, 7.2, 1.05], [2.9, 9.8, 0.9], [12.4, 9.1, 0.75], [6.6, 11.4, 1.05],
    [10.4, 12.2, 0.9],
  ];
  return points.map(([cx, cy, r], index) => (
    <circle key={index} cx={cx} cy={cy} r={r} fill="currentColor" strokeWidth={0} />
  ));
}

export const Icon = {
  // ── Tools ──────────────────────────────────────────────────────────────
  Move: () => (
    <Svg>
      <path d="M3.5 2.2v10l2.7-2.7h4.1L3.5 2.2Z" fill="currentColor" strokeWidth={1} />
    </Svg>
  ),
  Reset: () => (
    <Svg>
      <path d="M12.2 7.5a4.7 4.7 0 1 1-1.5-3.4M12.4 2.2v3.2H9.2" />
    </Svg>
  ),
  Play: () => (
    <Svg>
      <path d="M5 3.4 11.4 7.5 5 11.6V3.4Z" fill="currentColor" strokeWidth={1} strokeLinejoin="round" />
    </Svg>
  ),
  Hand: () => (
    <Svg>
      <path d="M5 7.5V4.2a.9.9 0 0 1 1.8 0v3M6.8 7V3.4a.9.9 0 0 1 1.8 0V7M8.6 7.2V4.4a.9.9 0 0 1 1.8 0v3.4M10.4 7.6V6a.9.9 0 0 1 1.8 0v3.4c0 2.2-1.5 4-3.7 4S5 12.2 5 10.2V9L3.7 9.9a.9.9 0 0 0-.3 1.2" />
    </Svg>
  ),
  Frame: () => (
    <Svg>
      <path d="M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11" />
    </Svg>
  ),
  /** Figma's section: a board with bracketed corners, not the frame's cross. */
  Section: () => (
    <Svg>
      <path d="M2.6 5.6V3.6a1 1 0 0 1 1-1h2M10.4 2.6h2a1 1 0 0 1 1 1v2M13.4 10.4v2a1 1 0 0 1-1 1h-2M5.6 13.4h-2a1 1 0 0 1-1-1v-2" />
      <path d="M6.6 8h2.8" strokeWidth={1} />
    </Svg>
  ),
  Square: () => (
    <Svg>
      <rect x={3} y={3} width={10} height={10} rx={1.5} />
    </Svg>
  ),
  Circle: () => (
    <Svg>
      <circle cx={8} cy={8} r={5} />
    </Svg>
  ),
  Pen: () => (
    <Svg>
      <path d="M3 13 4.2 9.6 10.6 3.2a1.4 1.4 0 0 1 2 2L6.2 11.6 3 13Z" />
    </Svg>
  ),
  Text: () => (
    <Svg>
      <path d="M2 12.5 5.2 3.5h.6l3.2 9M3.1 9.6h4.4M10.6 12.5V7.2M10.6 8.6c.4-1 1.2-1.5 2-1.5 1 0 1.4.6 1.4 1.7v4.1" />
    </Svg>
  ),
  Comment: () => (
    <Svg>
      <circle cx={8} cy={8} r={5.2} />
      <path d="M8 5.8v4.4M5.8 8h4.4" />
    </Svg>
  ),
  ImageAi: () => (
    <Svg>
      <path d="M2.8 11.2 6 8l2.4 2.4M13.2 9.4V4a1.2 1.2 0 0 0-1.2-1.2H4A1.2 1.2 0 0 0 2.8 4v8A1.2 1.2 0 0 0 4 13.2h5.6" />
      <path d="M12.4 10.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2Z" />
    </Svg>
  ),
  SvgAi: () => (
    <Svg>
      <path d="M9.6 2.8H4A1.2 1.2 0 0 0 2.8 4v8A1.2 1.2 0 0 0 4 13.2h8a1.2 1.2 0 0 0 1.2-1.2V6.4" />
      <path d="M12.4 1.8l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L10.6 3.6l1.3-.5.5-1.3Z" />
      <circle cx={8} cy={8} r={1.8} />
    </Svg>
  ),
  Shader: () => (
    <Svg>
      <rect x={2.8} y={2.8} width={10.4} height={10.4} rx={1.4} />
      <path d="M8 5.4 10.6 8 8 10.6 5.4 8 8 5.4Z" />
    </Svg>
  ),

  // ── Chrome ─────────────────────────────────────────────────────────────
  PanelToggle: () => (
    <Svg>
      <rect x={2.5} y={3.5} width={11} height={9} rx={1.4} />
      <path d="M6.5 3.5v9" />
    </Svg>
  ),
  Logo: () => (
    <Svg>
      <path d="M3 3h4.5v4.5H3zM8.5 8.5H13V13H8.5z" fill="currentColor" strokeWidth={0.9} />
      <path d="M8.5 3H13v4.5H8.5zM3 8.5h4.5V13H3z" />
    </Svg>
  ),
  Chevron: ({ open = false }: { open?: boolean }) => (
    <Svg size={12}>
      <path d={open ? 'M4 6.5 8 10l4-3.5' : 'M6.5 4 10 8l-3.5 4'} transform="translate(-2,-2) scale(1.15)" />
    </Svg>
  ),
  Caret: () => (
    <Svg size={12}>
      <path d="M3.5 5 6 7.5 8.5 5" />
    </Svg>
  ),
  Plus: () => (
    <Svg size={14}>
      <path d="M8 3.6v8.8M3.6 8h8.8" />
    </Svg>
  ),
  Minus: () => (
    <Svg size={14}>
      <path d="M3.6 8h8.8" />
    </Svg>
  ),
  Close: () => (
    <Svg size={14}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  ),
  Eye: ({ off = false }: { off?: boolean }) => (
    <Svg size={14}>
      <path d="M1.6 8S4.1 3.9 8 3.9 14.4 8 14.4 8 11.9 12.1 8 12.1 1.6 8 1.6 8Z" />
      <circle cx={8} cy={8} r={1.9} />
      {off && <path d="M3 13 13 3" />}
    </Svg>
  ),
  Lock: ({ open = false }: { open?: boolean }) => (
    <Svg size={14}>
      <rect x={3.8} y={7} width={8.4} height={6} rx={1.3} />
      <path d={open ? 'M6 7V5.2a2 2 0 0 1 3.9-.6' : 'M6 7V5.2a2 2 0 0 1 4 0V7'} />
    </Svg>
  ),
  Search: () => (
    <Svg size={14}>
      <circle cx={7.2} cy={7.2} r={4} />
      <path d="M10.2 10.2 13.4 13.4" />
    </Svg>
  ),
  Page: () => (
    <Svg size={14}>
      <path d="M4 2.6h4.6L12 6v7.4H4V2.6Z" />
      <path d="M8.4 2.6V6H12" />
    </Svg>
  ),
  Sliders: () => (
    <Svg size={14}>
      <path d="M5.2 2.6v4M5.2 9.4v4M10.8 2.6v6.8M10.8 12v1.4" />
      <circle cx={5.2} cy={7.7} r={1.3} />
      <circle cx={10.8} cy={10.7} r={1.3} />
    </Svg>
  ),
  Corners: () => (
    <Svg size={14}>
      <path d="M2.6 6V3.9a1.3 1.3 0 0 1 1.3-1.3H6M10 2.6h2.1a1.3 1.3 0 0 1 1.3 1.3V6M13.4 10v2.1a1.3 1.3 0 0 1-1.3 1.3H10M6 13.4H3.9a1.3 1.3 0 0 1-1.3-1.3V10" />
    </Svg>
  ),
  Collapse: () => (
    <Svg size={14}>
      <path d="M6.4 2.6v3.8H2.6M9.6 13.4V9.6h3.8M2.6 9.6h3.8v3.8M13.4 6.4H9.6V2.6" />
    </Svg>
  ),

  // ── Field glyphs ───────────────────────────────────────────────────────
  Angle: () => (
    <Svg size={13}>
      <path d="M3 12.5h10L3 4v8.5Z" />
      <path d="M5.4 12.5a3 3 0 0 0-1-2.3" strokeWidth={1} />
    </Svg>
  ),
  AspectLock: () => (
    <Svg size={14}>
      <rect x={3} y={3} width={7} height={7} rx={1.2} />
      <path d="M6 12.9h4.8a1.2 1.2 0 0 0 1.2-1.2V6.9" />
    </Svg>
  ),
  FlipH: () => (
    <Svg size={14}>
      <path d="M8 2.4v11.2" strokeDasharray="1.6 1.6" />
      <path d="M6.2 5.2 3.2 8l3 2.8V5.2ZM9.8 5.2 12.8 8l-3 2.8V5.2Z" />
    </Svg>
  ),
  FlipV: () => (
    <Svg size={14}>
      <path d="M2.4 8h11.2" strokeDasharray="1.6 1.6" />
      <path d="M5.2 6.2 8 3.2l2.8 3H5.2ZM5.2 9.8 8 12.8l2.8-3H5.2Z" />
    </Svg>
  ),
  ArrowRight: () => (
    <Svg size={14}>
      <path d="M3.4 8h9.2M9.4 4.8 12.6 8l-3.2 3.2" />
    </Svg>
  ),
  ArrowDown: () => (
    <Svg size={14}>
      <path d="M8 3.4v9.2M4.8 9.4 8 12.6l3.2-3.2" />
    </Svg>
  ),
  Gap: () => (
    <Svg size={13}>
      <path d="M2.6 3.4v9.2M13.4 3.4v9.2" />
      <path d="M6 8h4M8.6 6.4 10.2 8 8.6 9.6M7.4 6.4 5.8 8l1.6 1.6" strokeWidth={1} />
    </Svg>
  ),
  /** The second gap Figma reveals once a layout can wrap: space between lines. */
  GapCross: () => (
    <Svg size={13}>
      <path d="M3.4 2.6h9.2M3.4 13.4h9.2" />
      <path d="M8 6v4M6.4 7.4 8 5.8l1.6 1.6M6.4 8.6 8 10.2l1.6-1.6" strokeWidth={1} />
    </Svg>
  ),
  PadV: () => (
    <Svg size={13}>
      <path d="M2.6 2.6h10.8M2.6 13.4h10.8" />
      <rect x={5} y={5.4} width={6} height={5.2} rx={0.8} strokeWidth={1} strokeDasharray="1.4 1.2" />
    </Svg>
  ),
  PadH: () => (
    <Svg size={13}>
      <path d="M2.6 2.6v10.8M13.4 2.6v10.8" />
      <rect x={5.4} y={5} width={5.2} height={6} rx={0.8} strokeWidth={1} strokeDasharray="1.4 1.2" />
    </Svg>
  ),
  FontSize: () => (
    <Svg size={13}>
      <path d="M2.2 12 5.4 4h.5l3.2 8M3.2 9.4h4.4M11.6 12V6.4M9.8 8.2l1.8-1.8 1.8 1.8" strokeWidth={1.1} />
    </Svg>
  ),
  LineHeight: () => (
    <Svg size={13}>
      <path d="M2.4 3h11.2M2.4 8h7M2.4 13h11.2" strokeWidth={1.1} />
    </Svg>
  ),
  Letter: () => (
    <Svg size={13}>
      <path d="M3 3v10M13 3v10M6.2 10.6 8 5.4h.2l1.8 5.2M6.9 9h2.4" strokeWidth={1.1} />
    </Svg>
  ),
  Opacity: () => (
    <Svg size={13}>
      <circle cx={8} cy={8} r={5} />
      <path d="M8 3a5 5 0 0 0 0 10Z" fill="currentColor" strokeWidth={0} />
    </Svg>
  ),
  Blend: () => (
    <Svg size={13}>
      <circle cx={6.2} cy={8} r={3.6} />
      <circle cx={9.8} cy={8} r={3.6} />
    </Svg>
  ),
  Scale: () => (
    <Svg size={13}>
      <path d="M3 8V3h5M13 8v5H8M3 3l4.2 4.2M13 13 8.8 8.8" />
    </Svg>
  ),

  // ── Object alignment (Figma's top row) ─────────────────────────────────
  ObjAlign: ({ edge }: { edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' }) => (
    <Svg size={14}>
      {edge === 'left' && (
        <>
          <path d="M2.6 2.4v11.2" />
          <rect x={4.6} y={4} width={7.4} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={4.6} y={9} width={4.6} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {edge === 'hcenter' && (
        <>
          <path d="M8 2.4v11.2" />
          <rect x={4} y={4} width={8} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={5.6} y={9} width={4.8} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {edge === 'right' && (
        <>
          <path d="M13.4 2.4v11.2" />
          <rect x={4} y={4} width={7.4} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={6.8} y={9} width={4.6} height={3} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {edge === 'top' && (
        <>
          <path d="M2.4 2.6h11.2" />
          <rect x={4} y={4.6} width={3} height={7.4} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={9} y={4.6} width={3} height={4.6} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {edge === 'vcenter' && (
        <>
          <path d="M2.4 8h11.2" />
          <rect x={4} y={4} width={3} height={8} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={9} y={5.6} width={3} height={4.8} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {edge === 'bottom' && (
        <>
          <path d="M2.4 13.4h11.2" />
          <rect x={4} y={4} width={3} height={7.4} rx={0.8} fill="currentColor" strokeWidth={0} />
          <rect x={9} y={6.8} width={3} height={4.6} rx={0.8} fill="currentColor" strokeWidth={0} />
        </>
      )}
    </Svg>
  ),
  CornerTL: () => (
    <Svg size={12}>
      <path d="M3 9.5V6a3 3 0 0 1 3-3h3.5" />
    </Svg>
  ),
  CornerTR: () => (
    <Svg size={12}>
      <path d="M2.5 3H6a3 3 0 0 1 3 3v3.5" />
    </Svg>
  ),
  CornerBL: () => (
    <Svg size={12}>
      <path d="M3 2.5V6a3 3 0 0 0 3 3h3.5" />
    </Svg>
  ),
  CornerBR: () => (
    <Svg size={12}>
      <path d="M9 2.5V6a3 3 0 0 1-3 3H2.5" />
    </Svg>
  ),
  StrokeWeight: () => (
    <Svg size={13}>
      <path d="M2.6 4h10.8M2.6 8h10.8M2.6 12h10.8" strokeWidth={1} />
    </Svg>
  ),
  StrokeStyle: () => (
    <Svg size={13}>
      <rect x={2.6} y={2.6} width={10.8} height={10.8} rx={1.4} />
      <rect x={5} y={5} width={6} height={6} rx={0.8} strokeDasharray="1.6 1.4" />
    </Svg>
  ),
  Copy: () => (
    <Svg size={14}>
      <rect x={5.4} y={5.4} width={7.4} height={7.4} rx={1.4} />
      <path d="M10.2 3.9V3.5a1.4 1.4 0 0 0-1.4-1.4H3.5a1.4 1.4 0 0 0-1.4 1.4v5.3a1.4 1.4 0 0 0 1.4 1.4h.4" />
    </Svg>
  ),
  Component: ({ solid = false }: { solid?: boolean }) => (
    <Svg size={13}>
      <path
        d="M8 1.6 11.3 4.9 8 8.2 4.7 4.9 8 1.6ZM4.9 4.7 1.6 8l3.3 3.3L8.2 8 4.9 4.7ZM11.1 4.7 7.8 8l3.3 3.3L14.4 8l-3.3-3.3ZM8 7.8 11.3 11.1 8 14.4 4.7 11.1 8 7.8Z"
        fill={solid ? 'currentColor' : 'none'}
        strokeWidth={solid ? 0 : 1.1}
      />
    </Svg>
  ),
  Variable: () => (
    <Svg size={12}>
      <path d="M6 1.2 10.6 3.9v5.4L6 12 1.4 9.3V3.9L6 1.2Z" />
      <circle cx={6} cy={6.6} r={1.05} fill="currentColor" strokeWidth={0} />
    </Svg>
  ),
  GridFlow: () => (
    <Svg size={14}>
      <rect x={2.8} y={2.8} width={4.2} height={4.2} rx={1} />
      <rect x={9} y={2.8} width={4.2} height={4.2} rx={1} />
      <rect x={2.8} y={9} width={4.2} height={4.2} rx={1} />
      <rect x={9} y={9} width={4.2} height={4.2} rx={1} />
    </Svg>
  ),
  Freeform: () => (
    <Svg size={14}>
      <rect x={2.6} y={2.6} width={4} height={4} rx={1} />
      <rect x={8.4} y={5.6} width={4} height={4} rx={1} />
      <rect x={5} y={9.4} width={4} height={4} rx={1} />
    </Svg>
  ),
  Tokens: () => (
    <Svg size={14}>
      <rect x={2.6} y={2.6} width={4.4} height={4.4} rx={1} />
      <rect x={9} y={2.6} width={4.4} height={4.4} rx={1} />
      <rect x={2.6} y={9} width={4.4} height={4.4} rx={1} />
      <rect x={9} y={9} width={4.4} height={4.4} rx={1} />
    </Svg>
  ),
  Rotate90: () => (
    <Svg size={14}>
      <path d="M8 2.6a5.4 5.4 0 1 1-5.4 5.4" />
      <path d="M5.6 4.4 8 2.6 6.2 0.4" transform="translate(0,1.6)" />
    </Svg>
  ),
  /** Figma's "Resize to fit": four brackets closing in on the content. */
  ResizeToFit: () => (
    <Svg size={14}>
      <path d="M6 2.6H3.9a1.3 1.3 0 0 0-1.3 1.3V6M10 2.6h2.1a1.3 1.3 0 0 1 1.3 1.3V6M13.4 10v2.1a1.3 1.3 0 0 1-1.3 1.3H10M6 13.4H3.9a1.3 1.3 0 0 1-1.3-1.3V10" />
      <path d="M6.4 6.4h3.2v3.2H6.4z" />
    </Svg>
  ),
  /** Figma's auto-layout mark: items packed inside a frame with a gap between. */
  AutoLayout: () => (
    <Svg size={14}>
      <rect x={2.2} y={2.2} width={11.6} height={11.6} rx={2} />
      <rect x={4.5} y={4.6} width={2.8} height={6.8} rx={0.9} fill="currentColor" strokeWidth={0} />
      <rect x={8.7} y={4.6} width={2.8} height={6.8} rx={0.9} fill="currentColor" strokeWidth={0} />
    </Svg>
  ),
  /** Figma's "Absolute position": a layer pinned to a corner, out of the flow. */
  Absolute: () => (
    <Svg size={14}>
      <rect x={2.4} y={2.4} width={11.2} height={11.2} rx={2} strokeDasharray="1.6 1.4" strokeWidth={1} />
      <rect x={7.4} y={7.4} width={4.6} height={4.6} rx={1} fill="currentColor" strokeWidth={0} />
    </Svg>
  ),
  /** Text baseline alignment — glyphs sitting on a shared rule. */
  Baseline: () => (
    <Svg size={14}>
      <path d="M2.4 12.2h11.2" strokeWidth={1.4} />
      <path d="M4 9.6 5.8 4.4h.4l1.8 5.2M4.6 8.2h3M10.2 9.6V5" strokeWidth={1.1} />
    </Svg>
  ),
  /** Canvas stacking — which of two overlapping siblings paints in front. */
  Stack: ({ first = false }: { first?: boolean }) => (
    <Svg size={14}>
      {first ? (
        <>
          <rect x={6.6} y={6.6} width={6.6} height={6.6} rx={1.2} strokeWidth={1} />
          <rect x={2.8} y={2.8} width={6.6} height={6.6} rx={1.2} fill="currentColor" strokeWidth={0} />
        </>
      ) : (
        <>
          <rect x={2.8} y={2.8} width={6.6} height={6.6} rx={1.2} strokeWidth={1} />
          <rect x={6.6} y={6.6} width={6.6} height={6.6} rx={1.2} fill="currentColor" strokeWidth={0} />
        </>
      )}
    </Svg>
  ),
  /** Strokes included in layout — the border counted inside the box. */
  StrokeInLayout: () => (
    <Svg size={14}>
      <rect x={2.4} y={2.4} width={11.2} height={11.2} rx={2} strokeWidth={1.6} />
      <rect x={5.6} y={5.6} width={4.8} height={4.8} rx={1} strokeWidth={1} strokeDasharray="1.4 1.2" />
    </Svg>
  ),
  // ── Effects ────────────────────────────────────────────────────────────
  // Figma draws each effect as its own 16px glyph, which is what makes the
  // add-effect menu readable at a glance; a row of identical squares would not.
  InnerShadow: () => (
    <Svg>
      <rect x={2.6} y={2.6} width={10.8} height={10.8} rx={2} />
      <path d="M4.6 6.4a2 2 0 0 1 2-2h4.8" strokeWidth={2} opacity={0.45} />
    </Svg>
  ),
  DropShadow: () => (
    <Svg>
      <rect x={2.2} y={2.2} width={9.4} height={9.4} rx={2} />
      <path d="M5.2 13.6h6.6a2 2 0 0 0 2-2V5.2" strokeWidth={2} opacity={0.45} />
    </Svg>
  ),
  LayerBlur: () => <Svg>{grid(3, 1.05)}</Svg>,
  BackgroundBlur: () => (
    <Svg>
      <rect x={2.6} y={2.6} width={10.8} height={10.8} rx={1.6} />
      <path d="M6.2 2.6v10.8M9.8 2.6v10.8M2.6 6.2h10.8M2.6 9.8h10.8" opacity={0.5} />
    </Svg>
  ),
  Noise: () => <Svg>{scatter()}</Svg>,
  Texture: () => <Svg>{grid(4, 0.7)}</Svg>,
  Glass: () => (
    <Svg>
      <circle cx={8} cy={8} r={5.4} />
      <path d="M5.2 10.8a4 4 0 0 0 5.6-5.6" opacity={0.55} />
    </Svg>
  ),
  Waves: () => (
    <Svg>
      <path d="M2.4 6c1.1-1.3 2.2-1.3 3.3 0s2.2 1.3 3.3 0 2.2-1.3 3.3 0" />
      <path d="M2.4 10c1.1-1.3 2.2-1.3 3.3 0s2.2 1.3 3.3 0 2.2-1.3 3.3 0" />
    </Svg>
  ),
  /** spread and radius: a circle with rays, the way Figma marks a soft edge */
  Spread: () => (
    <Svg>
      <circle cx={8} cy={8} r={2.4} />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9 11 5M5 11l-1.1 1.1" opacity={0.7} />
    </Svg>
  ),
  /** the blend-mode droplet in an effect's settings header */
  Droplet: () => (
    <Svg>
      <path d="M8 2.4 4.9 6.6a3.9 3.9 0 1 0 6.2 0L8 2.4Z" />
    </Svg>
  ),
  Dots: () => (
    <Svg size={14}>
      <circle cx={3.4} cy={8} r={1.05} fill="currentColor" strokeWidth={0} />
      <circle cx={8} cy={8} r={1.05} fill="currentColor" strokeWidth={0} />
      <circle cx={12.6} cy={8} r={1.05} fill="currentColor" strokeWidth={0} />
    </Svg>
  ),
  Wrap: () => (
    <Svg size={14}>
      <path d="M2.6 4.4h8.2a2.4 2.4 0 0 1 0 4.8H4.2" />
      <path d="M6.2 7.2 4 9.2l2.2 2" />
    </Svg>
  ),

  /** Figma's Text case: the same two letters, cased four ways. */
  TextCase: ({ at }: { at: 'none' | 'upper' | 'lower' | 'title' }) => (
    <Svg size={14}>
      <text
        x={8}
        y={11}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={600}
        fill="currentColor"
        stroke="none"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {at === 'upper' ? 'AA' : at === 'lower' ? 'aa' : at === 'title' ? 'Aa' : '—'}
      </text>
    </Svg>
  ),
  /** Truncate: lines, the last one cut short by an ellipsis. */
  Truncate: () => (
    <Svg size={13}>
      <path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h4.6" />
      <circle cx={9.6} cy={11.6} r={0.7} fill="currentColor" strokeWidth={0} />
      <circle cx={11.6} cy={11.6} r={0.7} fill="currentColor" strokeWidth={0} />
      <circle cx={13.6} cy={11.6} r={0.7} fill="currentColor" strokeWidth={0} />
    </Svg>
  ),

  // ── Alignment ──────────────────────────────────────────────────────────
  AlignH: ({ at }: { at: 'left' | 'center' | 'right' }) => (
    <Svg size={14}>
      {at === 'left' && <path d="M3 3v10M5.4 6h7M5.4 10h4" />}
      {at === 'center' && <path d="M8 2.4v11.2M4 6h8M5.6 10h4.8" />}
      {at === 'right' && <path d="M13 3v10M3.6 6h7M6.6 10h4" />}
    </Svg>
  ),
  AlignV: ({ at }: { at: 'top' | 'middle' | 'bottom' }) => (
    <Svg size={14}>
      {at === 'top' && <path d="M3 3h10M6 5.4v7M10 5.4v4" />}
      {at === 'middle' && <path d="M2.4 8h11.2M6 4v8M10 5.6v4.8" />}
      {at === 'bottom' && <path d="M3 13h10M6 3.6v7M10 6.6v4" />}
    </Svg>
  ),

  // ── Shapes ─────────────────────────────────────────────────────────────
  Polygon: () => (
    <Svg>
      <path d="M8 2.8 13.4 12.4H2.6L8 2.8Z" strokeLinejoin="round" />
    </Svg>
  ),
  Star: () => (
    <Svg>
      <path
        d="M8 2.4l1.7 3.9 4.2.4-3.2 2.8 1 4.1L8 11.4 4.3 13.6l1-4.1L2.1 6.7l4.2-.4L8 2.4Z"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  Line: () => (
    <Svg>
      <path d="M3 13 13 3" />
    </Svg>
  ),
  Arrow: () => (
    <Svg>
      <path d="M3 13 13 3M8.6 3H13v4.4" strokeLinejoin="round" />
    </Svg>
  ),
  /** The vector-edit mark: a path with its anchors showing. */
  Anchor: () => (
    <Svg>
      <path d="M3.6 11.4c0-4 2.4-6.8 8-7" />
      <rect x={2} y={10} width={3} height={3} fill="#fff" strokeWidth={1.2} />
      <rect x={11} y={3} width={3} height={3} fill="#fff" strokeWidth={1.2} />
    </Svg>
  ),
  /** Boolean operations, drawn the way Figma draws them: two overlapping discs. */
  Boolean: ({ op }: { op: 'union' | 'subtract' | 'intersect' | 'exclude' }) => (
    <Svg>
      {op === 'union' && (
        <path
          d="M6.2 3.4a2.8 2.8 0 0 0-2.8 2.8v3.6a2.8 2.8 0 0 0 2.8 2.8h3.6a2.8 2.8 0 0 0 2.8-2.8V6.2a2.8 2.8 0 0 0-2.8-2.8H6.2Z"
          fill="currentColor"
          fillOpacity={0.25}
        />
      )}
      {op !== 'union' && (
        <>
          <rect x={2.6} y={2.6} width={7.2} height={7.2} rx={1.4} />
          <rect x={6.2} y={6.2} width={7.2} height={7.2} rx={1.4} />
        </>
      )}
      {op === 'intersect' && (
        <rect x={6.2} y={6.2} width={3.6} height={3.6} fill="currentColor" strokeWidth={0} />
      )}
      {op === 'subtract' && (
        <path d="M2.6 4a1.4 1.4 0 0 1 1.4-1.4h4.4A1.4 1.4 0 0 1 9.8 4v2.2H6.2v3.6H4A1.4 1.4 0 0 1 2.6 8.4V4Z" fill="currentColor" fillOpacity={0.3} strokeWidth={0} />
      )}
      {op === 'exclude' && (
        <>
          <path d="M2.6 4a1.4 1.4 0 0 1 1.4-1.4h4.4A1.4 1.4 0 0 1 9.8 4v2.2H6.2v3.6H4A1.4 1.4 0 0 1 2.6 8.4V4Z" fill="currentColor" fillOpacity={0.3} strokeWidth={0} />
          <path d="M9.8 6.2h2.2a1.4 1.4 0 0 1 1.4 1.4V12a1.4 1.4 0 0 1-1.4 1.4H7.6A1.4 1.4 0 0 1 6.2 12V9.8h3.6V6.2Z" fill="currentColor" fillOpacity={0.3} strokeWidth={0} />
        </>
      )}
    </Svg>
  ),
  /** A mask: the shape below deciding what of the layer above shows. */
  Mask: () => (
    <Svg>
      <circle cx={6.4} cy={8} r={4.4} />
      <path d="M6.4 3.6a4.4 4.4 0 0 1 0 8.8 4.4 4.4 0 0 0 4.4-4.4 4.4 4.4 0 0 0-4.4-4.4Z" fill="currentColor" strokeWidth={0} />
      <rect x={7.6} y={4.2} width={5.8} height={7.6} rx={1} strokeDasharray="1.6 1.3" strokeWidth={1} />
    </Svg>
  ),
  /** A slice: a region marked for export, drawn as a dashed crop. */
  Slice: () => (
    <Svg>
      <path d="M3 3h10v10H3z" strokeDasharray="2 1.6" />
      <path d="M6 1.6v2M10 12.4v2M1.6 10h2M12.4 6h2" strokeWidth={1.2} />
    </Svg>
  ),

  /** Rulers down two edges of the canvas. */
  Ruler: () => (
    <Svg>
      <path d="M2.6 2.6h10.8M2.6 2.6v10.8" strokeWidth={1.3} />
      <path d="M5.4 2.6v2M8 2.6v3M10.6 2.6v2M2.6 5.4h2M2.6 8h3M2.6 10.6h2" strokeWidth={1} />
    </Svg>
  ),
};
