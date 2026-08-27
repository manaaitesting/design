'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icons';

// ── Numeric field ────────────────────────────────────────────────────────

interface NumberFieldProps {
  value: number | 'mixed';
  onChange: (value: number) => void;
  glyph?: ReactNode;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  /** px moved per unit while scrubbing the glyph */
  sensitivity?: number;
  disabled?: boolean;
  title?: string;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Matches Paper's inputs: a 24px glyph gutter you can drag horizontally to
 * scrub the value, and a text field that accepts arithmetic ("120/2", "8*3").
 */
export function NumberField({
  value,
  onChange,
  glyph,
  suffix,
  min = -Infinity,
  max = Infinity,
  step = 1,
  sensitivity = 1,
  disabled,
  title,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === 'mixed' ? 'Mixed' : `${format(value)}${suffix ?? ''}`);

  const commit = (raw: string) => {
    setDraft(null);
    const cleaned = raw.replace(/[^0-9+\-*/.() ]/g, '').trim();
    if (!cleaned) return;
    let next: number;
    try {
      // arithmetic only — the character filter above rules out anything else
      next = Function(`"use strict";return (${cleaned})`)() as number;
    } catch {
      return;
    }
    if (!Number.isFinite(next)) return;
    onChange(Math.min(max, Math.max(min, next)));
  };

  const startScrub = (event: React.PointerEvent) => {
    if (disabled || value === 'mixed') return;
    event.preventDefault();
    const startX = event.clientX;
    const startValue = value;
    const move = (e: PointerEvent) => {
      const delta = ((e.clientX - startX) / sensitivity) * step;
      const next = Math.round((startValue + delta) / step) * step;
      onChange(Math.min(max, Math.max(min, next)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="field" data-scrub={glyph ? 'true' : undefined} title={title}>
      {glyph && (
        <span className="field-glyph" onPointerDown={startScrub}>
          {glyph}
        </span>
      )}
      <input
        value={display}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== 'mixed') {
            e.preventDefault();
            const bump = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            onChange(Math.min(max, Math.max(min, value + bump)));
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}

// ── Text field ───────────────────────────────────────────────────────────

export function TextField({
  value,
  onChange,
  glyph,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  glyph?: ReactNode;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="field">
      {glyph && <span className="field-glyph">{glyph}</span>}
      <input
        value={draft ?? value}
        placeholder={placeholder}
        spellCheck={false}
        style={glyph ? undefined : { paddingLeft: 8 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onChange(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}

// ── Segmented ────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  style,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div className="seg" style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          data-on={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ── Icon button row (radio group of icons) ───────────────────────────────

export function IconChoice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; icon: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" style={{ flex: '1 1 0' }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          data-on={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

// ── Popover select ───────────────────────────────────────────────────────

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** renders a hairline above this item */
  divider?: boolean;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  glyph,
  width,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  glyph?: ReactNode;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, w: 0 });
  const current = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 4, w: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="control"
        style={{ flex: width ? undefined : '1 1 0', width, padding: '0 6px 0 0', gap: 0 }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {glyph && (
          <span style={{ width: 24, display: 'flex', justifyContent: 'center', color: 'var(--color-ink-dim)' }}>
            {glyph}
          </span>
        )}
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            paddingLeft: glyph ? 0 : 8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current?.label ?? value}
        </span>
        <span style={{ color: 'var(--color-ink-dim)', display: 'flex' }}>
          <Icon.Caret />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            minWidth: Math.max(pos.w, 120),
            maxHeight: '60vh',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 8,
            padding: 4,
            boxShadow: 'var(--shadow-pop)',
            zIndex: 200,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {options.map((option) => (
            <div key={option.value}>
              {option.divider && (
                <div style={{ height: 1, background: 'var(--color-line)', margin: '4px 6px' }} />
              )}
              <button
                type="button"
                className="btn"
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  gap: 6,
                  color: 'var(--color-ink)',
                  background: option.value === value ? 'var(--color-select)' : undefined,
                  ...(option.value === value ? { color: '#fff' } : null),
                }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span style={{ width: 12, display: 'inline-flex' }}>
                  {option.value === value ? '✓' : ''}
                </span>
                {option.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Section ──────────────────────────────────────────────────────────────

export function Section({
  title,
  children,
  action,
  actions,
  empty,
  onAdd,
  defaultOpen = true,
  collapsible = false,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
  empty?: boolean;
  onAdd?: () => void;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const showBody = !empty && (!collapsible || open);

  return (
    <div className="panel-section" style={empty ? { paddingBottom: 0 } : undefined}>
      <div className="section-head" data-empty={empty ? 'true' : 'false'}>
        <span
          style={{ flex: 1, cursor: collapsible ? 'default' : undefined }}
          onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        >
          {title}
        </span>
        {actions}
        {action}
        {collapsible && (
          <button
            type="button"
            className="btn"
            style={{ width: 24, padding: 0 }}
            title={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((v) => !v)}
          >
            <span style={{ display: 'inline-flex', transform: open ? undefined : 'rotate(-90deg)' }}>
              <Icon.Caret />
            </span>
          </button>
        )}
        {onAdd && (
          <button type="button" className="btn" style={{ width: 24, padding: 0 }} onClick={onAdd}>
            {empty ? <Icon.Plus /> : <Icon.Minus />}
          </button>
        )}
      </div>
      {showBody && children}
    </div>
  );
}

// ── Colour ───────────────────────────────────────────────────────────────

/**
 * Accepts a hex, a CSS colour function, or a theme token — `var(--brand)` has
 * to survive verbatim so the token stays live instead of being flattened.
 */
function normalizeColor(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^(var|rgb|rgba|hsl|hsla|color|oklch|oklab)\(/i.test(raw)) return raw;

  const value = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.split('').map((c) => c + c).join('')}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6,8}$/.test(value)) return `#${value.toUpperCase()}`;
  // bare CSS keywords like "transparent" or "rebeccapurple"
  if (/^[a-zA-Z]+$/.test(raw)) return raw.toLowerCase();
  return null;
}

export function ColorRow({
  color,
  alpha,
  onColor,
  onAlpha,
  onRemove,
}: {
  color: string;
  alpha: number;
  onColor: (hex: string) => void;
  onAlpha: (alpha: number) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const isHex = /^#[0-9a-fA-F]{6}$/.test(color);
  const swatch = isHex ? color : '#DDDDDD';

  const commit = useCallback(
    (raw: string) => {
      setDraft(null);
      const next = normalizeColor(raw);
      if (next) onColor(next);
    },
    [onColor],
  );

  return (
    <div className="control" style={{ marginTop: 8, padding: '0 8px', gap: 8 }}>
      <button
        type="button"
        aria-label="Pick colour"
        onClick={() => picker.current?.click()}
        style={{
          width: 16,
          height: 16,
          flex: 'none',
          borderRadius: 3,
          border: '1px solid rgba(0,0,0,0.12)',
          // non-hex values (tokens, gradients, rgba) preview as themselves
          background: color || swatch,
          padding: 0,
          cursor: 'default',
        }}
      />
      <input
        ref={picker}
        type="color"
        value={swatch}
        onChange={(e) => onColor(e.target.value.toUpperCase())}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
      <input
        value={draft ?? (isHex ? color.replace('#', '') : color)}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          e.stopPropagation();
        }}
        style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none' }}
      />
      <input
        value={`${Math.round(alpha * 100)}`}
        spellCheck={false}
        onChange={(e) => {
          const next = Number(e.target.value.replace(/[^0-9]/g, ''));
          if (Number.isFinite(next)) onAlpha(Math.min(100, Math.max(0, next)) / 100);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: 26,
          flex: 'none',
          border: 0,
          background: 'transparent',
          outline: 'none',
          textAlign: 'right',
        }}
      />
      <span style={{ color: 'var(--color-ink-dim)', flex: 'none' }}>%</span>
      {onRemove && (
        <button type="button" className="btn" style={{ width: 18, padding: 0, flex: 'none' }} onClick={onRemove}>
          <Icon.Minus />
        </button>
      )}
    </div>
  );
}
