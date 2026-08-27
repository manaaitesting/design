'use client';

import { Children, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import { FigIcon } from './FigIcon';
import { PaintPicker, type PaintType } from './PaintPicker';

/**
 * A menu anchored to a button but rendered at the document root.
 *
 * The inspector scrolls, so anything positioned inside it is clipped by that
 * scroll container — the menu appears cut off against the panel edge instead of
 * floating over the canvas. Figma's dialogs live outside the panel; these do too.
 */
export function FigPopover({
  anchor,
  onClose,
  width = 190,
  align = 'right',
  placement = 'below',
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  width?: number;
  align?: 'left' | 'right';
  /**
   * 'below' hangs the menu off the button. 'beside' puts it outside the
   * inspector entirely, to the panel's left — which is where Figma opens its
   * styles-and-variables dialog, so it never covers the rows you are editing.
   */
  placement?: 'below' | 'beside';
  children: ReactNode;
}) {
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = placement === 'beside' ? anchor.closest('.fig')?.getBoundingClientRect() : null;
      const left = panel ? panel.left - width - 8 : align === 'right' ? rect.right - width : rect.left;
      const top = panel ? rect.top : rect.bottom + 4;
      setBox({
        // never let the menu hang off any edge of the window
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - 16)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align, width, placement]);

  useEffect(() => {
    const close = () => onClose();
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  if (!box || typeof document === 'undefined') return null;

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width,
        maxHeight: `min(320px, calc(100vh - ${box.top + 16}px))`,
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 6,
        padding: 4,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
        zIndex: 90,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Figma's inputs: a small glyph you can scrub, and a value you can type maths into. */
export function FigField({
  value,
  onChange,
  glyph,
  suffix,
  min = -Infinity,
  max = Infinity,
  step = 1,
  sensitivity = 1,
  title,
  disabled,
  placeholder,
  onApplyVariable,
}: {
  value: number | 'mixed';
  onChange: (value: number) => void;
  glyph?: ReactNode;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  sensitivity?: number;
  title?: string;
  disabled?: boolean;
  placeholder?: string;
  /** shows Figma's hover-revealed variable button inside the field */
  onApplyVariable?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown =
    draft ??
    (value === 'mixed'
      ? 'Mixed'
      : `${Number.isInteger(value) ? value : Number(value.toFixed(2))}${suffix ?? ''}`);

  const commit = (raw: string) => {
    setDraft(null);
    const cleaned = raw.replace(/[^0-9+\-*/.() ]/g, '').trim();
    if (!cleaned) return;
    let next: number;
    try {
      next = Function(`"use strict";return (${cleaned})`)() as number;
    } catch {
      return;
    }
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
  };

  const scrub = (event: React.PointerEvent) => {
    if (disabled || value === 'mixed') return;
    event.preventDefault();
    const startX = event.clientX;
    const from = value;
    const move = (e: PointerEvent) => {
      const delta = ((e.clientX - startX) / sensitivity) * step;
      onChange(Math.min(max, Math.max(min, Math.round((from + delta) / step) * step)));
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
    <div className="fig-input" title={title}>
      {glyph !== undefined && (
        <span className="glyph" onPointerDown={scrub}>
          {glyph}
        </span>
      )}
      <input
        value={shown}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
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
        }}
      />
      {onApplyVariable && (
        <button
          type="button"
          className="fig-variable"
          title="Apply variable"
          aria-label="Apply variable"
          onClick={onApplyVariable}
        >
          <FigIcon name="Apply variable" size={12} />
        </button>
      )}
    </div>
  );
}

export function FigText({
  value,
  onChange,
  placeholder,
  glyph,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  glyph?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="fig-input">
      {glyph !== undefined && <span className="glyph">{glyph}</span>}
      <input
        value={draft ?? value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onChange(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/** True when the button carries a readable label rather than just an icon. */
function hasLabel(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) => typeof child === 'string' || typeof child === 'number',
  );
}

export function FigButton({
  children,
  onClick,
  title,
  on,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  on?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className="fig-btn"
      title={title}
      aria-label={title}
      data-on={on ? 'true' : undefined}
      data-text={hasLabel(children) ? 'true' : undefined}
      disabled={disabled}
      onClick={(event) => {
        event.currentTarget.blur();
        onClick?.();
      }}
      style={style}
    >
      {children}
    </button>
  );
}

export function FigGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="fig-seg">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-label={option.title}
          data-on={value === option.value ? 'true' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface FigOption<T extends string> {
  value: T;
  label: string;
  divider?: boolean;
}

/** A dropdown that reads as a borderless field until hovered, like Figma's. */
export function FigSelect<T extends string>({
  value,
  options,
  onChange,
  glyph,
  title,
  width,
}: {
  value: T;
  options: FigOption<T>[];
  onChange: (value: T) => void;
  glyph?: ReactNode;
  title?: string;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, w: 0 });
  const current = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 4, w: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="fig-input"
        title={title}
        style={{ flex: width ? 'none' : '1 1 0', width, cursor: 'default' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {glyph !== undefined && <span className="glyph">{glyph}</span>}
        <span className="fig-value">{current?.label ?? value}</span>
        <span className="fig-caret">
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
            maxHeight: '58vh',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 6,
            padding: 4,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
            zIndex: 240,
            fontSize: 11,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {options.map((option) => (
            <div key={option.value}>
              {option.divider && (
                <div style={{ height: 1, background: 'var(--fig-border)', margin: '4px 6px' }} />
              )}
              <button
                type="button"
                className="fig-btn"
                data-text="true"
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  background: option.value === value ? 'var(--fig-blue)' : undefined,
                  color: option.value === value ? '#fff' : undefined,
                }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span style={{ width: 10, display: 'inline-flex' }}>
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

function normalizeColor(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^(var|rgb|rgba|hsl|hsla|color|oklch|oklab)\(/i.test(raw)) return raw;
  const value = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.split('').map((c) => c + c).join('')}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6,8}$/.test(value)) return `#${value.toUpperCase()}`;
  if (/^[a-zA-Z]+$/.test(raw)) return raw.toLowerCase();
  return null;
}

/** Figma's paint row: swatch, hex, opacity, visibility, remove. */
export function FigPaintRow({
  color,
  alpha,
  visible = true,
  onColor,
  onAlpha,
  onVisible,
  onRemove,
  onKind,
  kind,
  blend,
  onBlend,
  pageColors = [],
  tokens = [],
  onCreateToken,
}: {
  color: string;
  alpha: number;
  visible?: boolean;
  onColor: (value: string) => void;
  onAlpha?: (value: number) => void;
  onVisible?: () => void;
  onRemove?: () => void;
  /** switches the paint to a gradient, pattern, image, video or shader */
  onKind?: (kind: PaintType) => void;
  /** forces the picker's selected type, for layer-level video and shader */
  kind?: PaintType;
  blend?: string;
  onBlend?: (mode: string) => void;
  /** colours already used on the page, offered as swatches in the picker */
  pageColors?: string[];
  tokens?: { id: string; name: string; value: string; type: string }[];
  onCreateToken?: (hex: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);
  const checkbox = useId();
  const isHex = /^#[0-9a-fA-F]{6}$/.test(color);
  const hex = isHex ? color.slice(1).toUpperCase() : color;

  return (
    <div className="fig-row tight">
      {/* Figma keeps the swatch, the hex and the opacity in *one* field box,
          with the % as the scrub handle. Splitting them into two boxes is the
          single most visible way this panel stops looking like Figma. */}
      <div className="fig-input fig-paint" style={{ flex: '1 1 0' }}>
        <button
          ref={swatch}
          type="button"
          className="fig-swatch"
          aria-label={isHex ? `Solid color hex: ${hex}` : 'Paint'}
          title="Open the color picker"
          style={{ background: color || '#DDDDDD' }}
          onClick={() => setPicking((v) => !v)}
        >
          {/* Figma's chit carries its own alpha wedge rather than dimming the swatch */}
          <span className="fig-swatch-alpha" style={{ opacity: 1 - alpha }} />
        </button>
        {picking && (
          <PaintPicker
            anchor={swatch.current}
            value={color}
            type={kind}
            alpha={alpha}
            blend={blend}
            pageColors={pageColors}
            tokens={tokens}
            onChange={onColor}
            onAlpha={(next) => onAlpha?.(next)}
            onBlend={onBlend}
            onType={(kind) => onKind?.(kind)}
            onCreateToken={onCreateToken}
            onClose={() => setPicking(false)}
          />
        )}
        <input
          aria-label="Color"
          value={draft ?? hex}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            setDraft(null);
            const next = normalizeColor(e.target.value);
            if (next) onColor(next);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{ marginLeft: 4, paddingRight: 0 }}
        />

        {onAlpha && (
          <>
            <input
              aria-label="Opacity"
              value={String(Math.round(alpha * 100))}
              spellCheck={false}
              className="fig-paint-alpha"
              onChange={(e) => {
                const next = Number(e.target.value.replace(/[^0-9]/g, ''));
                if (Number.isFinite(next)) onAlpha(Math.min(100, Math.max(0, next)) / 100);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span
              className="glyph fig-paint-percent"
              onPointerDown={(event) => {
                // scrubbing the % sign changes opacity, as it does in Figma
                event.preventDefault();
                const startX = event.clientX;
                const from = alpha;
                const move = (e: PointerEvent) => {
                  const next = from + (e.clientX - startX) / 200;
                  onAlpha(Math.min(1, Math.max(0, next)));
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  document.body.style.cursor = '';
                };
                document.body.style.cursor = 'ew-resize';
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              %
            </span>
          </>
        )}
      </div>

      {onVisible && (
        // Figma uses a real checkbox here, so the row is operable from the keyboard
        <span className="fig-btn fig-check" title={visible ? 'Hide' : 'Show'}>
          <input
            id={checkbox}
            type="checkbox"
            checked={visible}
            onChange={onVisible}
            aria-label="Toggle visibility"
          />
          <label htmlFor={checkbox}>
            <Icon.Eye off={!visible} />
          </label>
        </span>
      )}
      {onRemove && (
        <FigButton title="Remove" onClick={onRemove}>
          <FigIcon name="Remove" />
        </FigButton>
      )}
    </div>
  );
}

/** Figma's 9px grey caption above a group of fields. */
export function FigLabel({ children }: { children: ReactNode }) {
  return <div className="fig-label">{children}</div>;
}

/**
 * Figma groups related fields in a <fieldset> with a <legend> caption — worth
 * copying, because it is what makes the panel navigable by screen reader.
 */
export function FigGroupSet({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="fig-label" style={{ padding: 0 }}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Figma's "Apply styles and variables" button — the four-dot glyph beside a
 * section header. Here it lists the document's theme tokens.
 */
export function FigTokenPicker({
  tokens,
  onPick,
  title,
}: {
  tokens: { id: string; name: string; value: string; type: string }[];
  onPick: (reference: string) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLSpanElement>(null);

  return (
    <span ref={button} style={{ display: 'inline-flex' }}>
      <FigButton title={title} on={open} onClick={() => setOpen((v) => !v)}>
        <FigIcon name="Fill, Apply styles and variables" />
      </FigButton>
      {open && (
        <FigPopover anchor={button.current} placement="beside" width={240} onClose={() => setOpen(false)}>
          {tokens.length === 0 ? (
            <div style={{ padding: 6, color: 'var(--fig-dim)' }}>
              No tokens yet — create them in the Theme tab.
            </div>
          ) : (
            tokens.map((token) => (
              <button
                key={token.id}
                type="button"
                className="fig-btn"
                data-text="true"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => {
                  onPick(`var(--${token.name})`);
                  setOpen(false);
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    border: '1px solid rgba(0,0,0,0.1)',
                    background: token.type === 'color' ? token.value : 'transparent',
                  }}
                />
                {token.name}
              </button>
            ))
          )}
        </FigPopover>
      )}
    </span>
  );
}

export function FigSection({
  title,
  children,
  actions,
  onAdd,
  onRemove,
  empty,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  onAdd?: () => void;
  onRemove?: () => void;
  empty?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const collapsible = !empty && !!children;
  // A section that removes its rows individually (Fill) keeps its + at all
  // times; one that is a single optional value (Stroke, Guides) swaps + for −.
  const alwaysAdd = !onRemove;

  return (
    <div className="fig-section">
      <div className="fig-head" data-empty={empty ? 'true' : undefined}>
        <button
          type="button"
          className="fig-chevron"
          data-hidden={!collapsible}
          aria-expanded={open}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => collapsible && setOpen((v) => !v)}
        >
          <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : undefined }}>
            <Icon.Chevron />
          </span>
        </button>
        <h2 className="fig-title">{title}</h2>
        {/* Figma fades the styles-and-variables button out until the header is
            hovered; the add button stays. */}
        {actions && <span className="fig-head-fade">{actions}</span>}
        {onAdd && (alwaysAdd || empty) && (
          <FigButton title={`Add ${title.toLowerCase()}`} onClick={onAdd}>
            <FigIcon name="Add fill" />
          </FigButton>
        )}
        {!empty && onRemove && (
          <FigButton title={`Remove ${title.toLowerCase()}`} onClick={onRemove}>
            <FigIcon name="Remove" />
          </FigButton>
        )}
      </div>
      {!empty && open && children}
    </div>
  );
}
