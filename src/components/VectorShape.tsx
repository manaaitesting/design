'use client';

import type { SceneNode } from '../document/types';

/** Builds an SVG path from a point list, optionally rounding the joins. */
export function pathFrom(points: [number, number][], closed: boolean, smooth = 0): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;

  if (!smooth) {
    const [first, ...rest] = points;
    return `M ${first[0]} ${first[1]} ${rest.map(([x, y]) => `L ${x} ${y}`).join(' ')}${closed ? ' Z' : ''}`;
  }

  // Catmull-Rom through the points, converted to cubic béziers
  const list = closed ? [...points, points[0]] : points;
  const tension = Math.min(smooth, 1) / 6;
  let d = `M ${list[0][0]} ${list[0][1]}`;
  for (let i = 0; i < list.length - 1; i++) {
    const p0 = list[Math.max(0, i - 1)];
    const p1 = list[i];
    const p2 = list[i + 1];
    const p3 = list[Math.min(list.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension];
    const c2 = [p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return closed ? `${d} Z` : d;
}

export function VectorShape({ node }: { node: SceneNode }) {
  const points = node.points ?? [];
  if (points.length < 2) return null;
  const stroke = node.border;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${Math.max(node.w, 1)} ${Math.max(node.h, 1)}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path
        d={pathFrom(points, !!node.closed, node.smooth ?? 0)}
        fill={node.closed && node.fill && node.fillVisible !== false ? node.fill : 'none'}
        stroke={stroke ? stroke.color : 'none'}
        strokeWidth={stroke ? stroke.width : 0}
        strokeDasharray={
          stroke?.style === 'dashed'
            ? `${stroke.width * 4} ${stroke.width * 3}`
            : stroke?.style === 'dotted'
              ? `0 ${stroke.width * 2.2}`
              : undefined
        }
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
