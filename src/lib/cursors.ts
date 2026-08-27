/**
 * Canvas cursors.
 *
 * The native `default`/`crosshair` cursors are the OS's, so they change shape
 * between machines and vanish against dark artwork. Figma ships its own for
 * exactly that reason — a solid slate arrow ringed in white, with a soft
 * shadow so it reads on any fill. These are SVG data URIs, sized for a 1x
 * pointer and left to the browser to scale on retina.
 */

const INK = '#363B3E';

/** `url(...)` with the SVG inlined, plus the hotspot and a native fallback. */
function cursor(svg: string, hotX: number, hotY: number, fallback: string) {
  const uri = `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
  return `url("${uri}") ${hotX} ${hotY}, ${fallback}`;
}

/**
 * The move tool's arrow — Figma's tailless pointer: two long edges from the
 * tip, a notch in the trailing edge, tip on the hotspot.
 */
export const ARROW = cursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="24" viewBox="0 0 22 24">
     <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
       <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.28"/>
     </filter>
     <path d="M2.4 1.6 L16.4 8.4 L10.3 12 L5.4 18.9 Z"
           fill="${INK}" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"
           filter="url(#s)"/>
   </svg>`,
  2,
  1,
  'default',
);

/** Drawing tools get a crosshair with the same white halo as the arrow. */
export const CROSSHAIR = cursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
     <g stroke="#fff" stroke-width="3" stroke-linecap="butt">
       <path d="M12 1 L12 23"/><path d="M1 12 L23 12"/>
     </g>
     <g stroke="${INK}" stroke-width="1" stroke-linecap="butt">
       <path d="M12 1 L12 23"/><path d="M1 12 L23 12"/>
     </g>
   </svg>`,
  12,
  12,
  'crosshair',
);
