'use client';

import { useState } from 'react';
import { useUI } from '../state/ui';
import { SHORTCUTS } from '../lib/shortcuts';

/**
 * Figma's ⌃⇧? panel.
 *
 * It is docked to the bottom rather than floated in the middle, because it is
 * meant to be left open while you work: you read a chord, you press it on the
 * canvas behind, and the row ticks. A modal in the way of the canvas would be
 * used once and closed. That is also why this one deliberately does *not* take
 * the keyboard the way the export sheet does — the whole point is that the keys
 * still reach the canvas while you are looking at them.
 */
export function Shortcuts() {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcutsOpen);
  const used = useUI((s) => s.usedShortcuts);
  const [group, setGroup] = useState(0);

  if (!open) return null;
  const current = SHORTCUTS[Math.min(group, SHORTCUTS.length - 1)];
  const seen = new Set(used);
  const learned = SHORTCUTS.flatMap((g) => g.rows).filter((row) => row.code && seen.has(row.code)).length;

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 350,
        background: 'var(--color-panel)',
        borderTop: '1px solid var(--fig-line)',
        boxShadow: 'var(--shadow-pop)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '45vh',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          borderBottom: '1px solid var(--fig-line)',
          overflowX: 'auto',
        }}
      >
        {SHORTCUTS.map((entry, index) => (
          <button
            key={entry.title}
            type="button"
            className="fig-palette-row"
            data-on={index === group}
            data-shortcut-tab={entry.title}
            onClick={() => setGroup(index)}
            style={{ width: 'auto', padding: '4px 10px', borderRadius: 5, whiteSpace: 'nowrap' }}
          >
            {entry.title}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.5, fontSize: 11, whiteSpace: 'nowrap' }}>
          {learned} of {SHORTCUTS.flatMap((g) => g.rows).filter((r) => r.code).length} used
        </span>
        <button
          type="button"
          className="fig-palette-row"
          aria-label="Close keyboard shortcuts"
          onClick={() => setOpen(false)}
          style={{ width: 'auto', padding: '4px 10px', borderRadius: 5 }}
        >
          ✕
        </button>
      </div>

      <div
        className="scroll"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '2px 24px',
          padding: '10px 14px 14px',
          alignContent: 'start',
        }}
      >
        {current.rows.map((row) => {
          // a row with no chord id is one the handler reads a range of keys for
          // — the digits, the arrows — and there is nothing single to tick
          const done = !!row.code && seen.has(row.code);
          return (
            <div
              key={`${row.keys}-${row.label}`}
              data-shortcut={row.code ?? row.keys}
              data-used={done || undefined}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '3px 0',
                fontSize: 12,
                opacity: done ? 1 : 0.85,
              }}
            >
              <span
                style={{
                  minWidth: 74,
                  fontVariantNumeric: 'tabular-nums',
                  color: done ? 'var(--color-select-line)' : 'inherit',
                  fontWeight: done ? 600 : 500,
                }}
              >
                {row.keys}
              </span>
              <span style={{ flex: 1, opacity: 0.8 }}>{row.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
