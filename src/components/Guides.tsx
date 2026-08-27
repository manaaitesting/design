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
  const align = guides.align ?? 'stretch';
  const stretch = align === 'stretch';
  // Stretch is the only mode the margin describes; the others pin a run of
  // fixed-width tracks, and Figma greys the margin out for them.
  const justify = stretch ? 'flex-start' : align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';

  return (
    <div
      style={{
        ...base,
        display: 'flex',
        flexDirection: isColumns ? 'row' : 'column',
        justifyContent: justify,
        gap: guides.gutter,
        padding: stretch ? (isColumns ? `0 ${guides.margin}px` : `${guides.margin}px 0`) : 0,
      }}
    >
      {Array.from({ length: Math.max(1, guides.count) }, (_, i) => (
        <div
          key={i}
          style={
            stretch
              ? { flex: '1 1 0', background: guides.color }
              : {
                  flex: 'none',
                  background: guides.color,
                  [isColumns ? 'width' : 'height']: Math.max(1, guides.width ?? 64),
                }
          }
        />
      ))}
    </div>
  );
}
