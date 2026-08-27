'use client';

import type { GuideSpec } from '../document/types';

/**
 * Layout guides drawn over a frame.
 *
 * A design aid, like Figma's layout grids — deliberately not exported, since
 * columns you measure against are not columns you ship.
 */
export function Guides({ guides }: { guides: GuideSpec }) {
  if (!guides.visible) return null;

  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 1,
  };

  if (guides.type === 'grid') {
    const size = Math.max(1, guides.size);
    return (
      <div
        style={{
          ...base,
          backgroundImage: `linear-gradient(to right, ${guides.color} 1px, transparent 1px), linear-gradient(to bottom, ${guides.color} 1px, transparent 1px)`,
          backgroundSize: `${size}px ${size}px`,
        }}
      />
    );
  }

  const isColumns = guides.type === 'columns';
  return (
    <div
      style={{
        ...base,
        display: 'flex',
        flexDirection: isColumns ? 'row' : 'column',
        gap: guides.gutter,
        padding: isColumns ? `0 ${guides.margin}px` : `${guides.margin}px 0`,
      }}
    >
      {Array.from({ length: Math.max(1, guides.count) }, (_, i) => (
        <div key={i} style={{ flex: '1 1 0', background: guides.color }} />
      ))}
    </div>
  );
}
