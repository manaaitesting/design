'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';
import { panelOrder } from '../document/layers';

/**
 * ⌘R — one name across the selection.
 *
 * Renaming a single layer has always been a double-click in the layers panel.
 * What this is for is the other case: twenty icons called "Vector" that should
 * be "icon-01" upwards. So the name is a pattern rather than a string, and the
 * tokens are what make it one.
 *
 * The layers are numbered in the order the panel lists them — front-most first —
 * because that is the order on screen while you are typing, and a number that
 * counts in some other direction is a number you have to work out rather than
 * read.
 */

/** `$&` is the layer's own name; `$n` counts down the list, `$N` up it. */
const TOKEN = /\$(&|n+|N+)/g;

export function applyPattern(pattern: string, name: string, index: number, total: number): string {
  return pattern.replace(TOKEN, (_, token: string) => {
    if (token === '&') return name;
    const ascending = token[0] === 'n';
    const value = ascending ? index + 1 : total - index;
    // `$nn` is the same count, written wide enough to sort as text
    return String(value).padStart(token.length, '0');
  });
}

export function RenameDialog() {
  const open = useUI((s) => s.renameOpen);
  const setOpen = useUI((s) => s.setRenameOpen);
  const selection = useUI((s) => s.selection);
  const pageId = useUI((s) => s.page);
  const doc = useDoc();
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  /** the selection in the order the panel lists it, which is what `$n` counts */
  const targets = useMemo(() => {
    const order = panelOrder(doc, pageId);
    return [...selection].filter((id) => doc[id]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [selection, doc, pageId]);

  const shared = targets.length && targets.every((id) => doc[id].name === doc[targets[0]].name)
    ? doc[targets[0]].name
    : '';
  const [pattern, setPattern] = useState(shared);

  // the field starts on the name they already share, and is selected so typing
  // replaces it — the same as opening a rename anywhere else
  useEffect(() => {
    if (!open) return;
    setPattern(shared);
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
    // `shared` is read once, when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !targets.length) return null;

  const preview = targets.map((id, index) => applyPattern(pattern, doc[id].name, index, targets.length));

  const apply = () => {
    if (!pattern.trim()) return;
    targets.forEach((id, index) => {
      store.update(id, { name: preview[index] });
    });
    store.commit();
    setOpen(false);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 400 }}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Rename layers"
        style={{
          width: 380,
          maxWidth: '92vw',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head" style={{ height: 42 }}>
          <span style={{ fontWeight: 500 }}>Rename</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>
            {targets.length} layer{targets.length === 1 ? '' : 's'}
          </span>
        </div>

        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="fig-input">
            <input
              ref={inputRef}
              aria-label="New name"
              autoFocus
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </div>

          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-dim)', lineHeight: 1.5 }}>
            <code>$&amp;</code> current name · <code>$n</code> number down the list ·{' '}
            <code>$N</code> up it · <code>$nn</code> pads to two digits
          </p>

          {targets.length > 1 && (
            <ul
              aria-label="Rename preview"
              style={{
                margin: 0,
                padding: '6px 8px',
                listStyle: 'none',
                maxHeight: 120,
                overflowY: 'auto',
                background: 'var(--color-bg)',
                borderRadius: 6,
                fontSize: 11,
                color: 'var(--color-ink-dim)',
              }}
            >
              {preview.slice(0, 8).map((name, index) => (
                <li key={targets[index]}>{name}</li>
              ))}
              {preview.length > 8 && <li>…and {preview.length - 8} more</li>}
            </ul>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="fig-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="fig-btn" onClick={apply}>
              Rename
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
