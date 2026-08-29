'use client';

import type { RefObject } from 'react';
import { usePresence } from './Session';
import { toScreen, useUI } from '../state/ui';
import { readableOn } from '../lib/color';

export function Cursors({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const presence = usePresence();
  const viewport = useUI((s) => s.viewport);
  const shown = useUI((s) => s.view.cursors);
  void containerRef;
  if (!shown) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {presence.map((p) => {
        if (!p.cursor) return null;
        const { x, y } = toScreen(viewport, p.cursor.x, p.cursor.y);
        return (
          <div key={p.clientId} style={{ position: 'absolute', left: x, top: y }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: p.identity.color,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: 8,
                top: 6,
                fontSize: 11,
                fontWeight: 500,
                lineHeight: '14px',
                padding: '1px 6px',
                borderRadius: 3,
                background: p.identity.color,
                color: readableOn(p.identity.color),
                whiteSpace: 'nowrap',
              }}
            >
              {p.identity.name}
              {p.spotlight && <span style={{ opacity: 0.8 }}> · presenting</span>}
            </span>
            {/* whatever they are saying, riding along beside the pointer */}
            {p.chat && (
              <span
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 24,
                  maxWidth: 260,
                  fontSize: 11,
                  lineHeight: '15px',
                  padding: '2px 7px',
                  borderRadius: 10,
                  background: p.identity.color,
                  color: readableOn(p.identity.color),
                }}
              >
                {p.chat}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
