'use client';

import { withAlpha } from '../document/css';
import type { GuideSpec } from '../document/types';
import { useUI } from '../state/ui';

/**
 * Layout guides drawn over a frame.
 *
 * A design aid, like Figma's layout grids — deliberately not exported, since
 * columns you measure against are not columns you ship.
 */
export function Guides({ guides }: { guides: GuideSpec }) {
  // two switches, as Figma has them: each grid on the frame carries its own eye,
  // and the view menu turns every frame's off at once while you look at the
  // design without them
  const shown = useUI((state) => state.view.layoutGuides);
  if (!guides.visible || !shown) return null;

  const paint = withAlpha(guides.color, guides.opacity ?? 1);

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
          backgroundImage: `linear-gradient(to right, ${paint} 1px, transparent 1px), linear-gradient(to bottom, ${paint} 1px, transparent 1px)`,
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
              ? { flex: '1 1 0', background: paint }
              : {
                  flex: 'none',
                  background: paint,
                  [isColumns ? 'width' : 'height']: Math.max(1, guides.width ?? 64),
                }
          }
        />
      ))}
    </div>
  );
}
