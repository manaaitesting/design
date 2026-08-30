'use client';

import {
  Children,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import { FigIcon } from './FigIcon';
import { PaintPicker, type PaintType } from './PaintPicker';
import { blendLabel, blendModes, blends } from './blend';
import { scrubValue } from './Controls';

/**
 * A menu anchored to a button but rendered at the document root.
 *
 * The inspector scrolls, so anything positioned inside it is clipped by that
 * scroll container — the menu appears cut off against the panel edge instead of
 * floating over the canvas. Figma's dialogs live outside the panel; these do too.
 */
const POPOVER_LOOK: Record<'menu' | 'dark' | 'card', CSSProperties> = {
  menu: {
    background: '#fff',
    borderRadius: 6,
    padding: 4,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
  },
  dark: {
    background: '#1e1e1e',
    borderRadius: 10,
    padding: 6,
    color: '#fff',
    boxShadow:
      '0 0 0 0.5px rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.25), 0 10px 34px rgba(0,0,0,0.4)',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 0,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.06), 0 12px 32px -8px rgba(0,0,0,0.28)',
  },
};

export function FigPopover({
  anchor,
  onClose,
  width = 190,
  align = 'right',
  placement = 'below',
  variant = 'menu',
  maxHeight,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  width?: number;
  align?: 'left' | 'right';
  /**
   * How tall the popover may get before it scrolls itself.
   *
   * A dialog that does its own scrolling inside — the font list — has to be
   * allowed to be as tall as its content, or it ends up with two scrollbars
   * doing half a job each.
   */
  maxHeight?: number;
  /**
   * 'below' hangs the menu off the button. 'beside' puts it outside the
   * inspector entirely, to the panel's left — which is where Figma opens its
   * styles-and-variables dialog, so it never covers the rows you are editing.
   */
  placement?: 'below' | 'beside';
  /**
   * 'menu' is the white list Figma hangs off a panel button. 'dark' is the
   * floating menu it uses for choices that belong to the canvas rather than the
   * panel — blend modes, the effect types. 'card' is a settings dialog, which
   * brings its own header and padding.
   */
  variant?: 'menu' | 'dark' | 'card';
  children: ReactNode;
}) {
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = placement === 'beside' ? anchor.closest('.fig')?.getBoundingClientRect() : null;
      const left = panel ? panel.left - width - 8 : align === 'right' ? rect.right - width : rect.left;
      const top = panel ? rect.top : rect.bottom + 4;
      // A dialog opened from a row near the foot of the panel would otherwise
      // be scrolled rather than shown: lift it by however much it overhangs.
      const height = element?.scrollHeight ?? 0;
      const lowest = window.innerHeight - Math.min(height, window.innerHeight - 16) - 8;
      setBox({
        // never let the menu hang off any edge of the window
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(top, height ? lowest : window.innerHeight - 16)),
      });
    };
    place();
    // a dialog that grows — Duo noise adding its second colour — has to be
    // re-placed, or the new row lands under the bottom of the window
    const observer = element ? new ResizeObserver(place) : null;
    if (element) observer!.observe(element);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align, width, placement, element]);

  useEffect(() => {
    // A press on the anchor is that control's own business: closing here as
    // well would fight the toggle, and the menu would flicker back open.
    const close = (event: PointerEvent) => {
      if (anchor && event.target instanceof Node && anchor.contains(event.target)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [onClose, anchor]);

  if (!box || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={setElement}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width,
        // the 8px matches the gap `place()` leaves below a popover it has had
        // to lift; any more and a dialog that exactly fits grows its own
        // scrollbar, which is what put two of them in the font picker
        maxHeight: `min(${maxHeight ?? (variant === 'dark' ? 600 : 420)}px, calc(100vh - ${box.top + 8}px))`,
        overflowY: 'auto',
        ...POPOVER_LOOK[variant],
        zIndex: 90,
      }}
      // portalled to the body, so it has to bring the panel's variables with it
      className={`fig-shell${variant === 'dark' ? ' fig-menu-dark' : ''}`}
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
  width,
  trailing,
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
  /** a field that should not take its share of the row — the truncate count */
  width?: number;
  /** a control at the field's trailing edge — the size field's preset caret */
  trailing?: ReactNode;
  /** shows Figma's hover-revealed variable button inside the field */
  onApplyVariable?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // A field driven by something else — a bound variable — says what is driving
  // it rather than the number that came out, which is the whole point of the
  // binding: the value is the variable's to change, not this field's.
  const shown =
    draft ??
    (disabled && placeholder
      ? placeholder
      : value === 'mixed'
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
      const next = scrubValue(e, from, e.clientX - startX, step, sensitivity);
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
    <div className="fig-input" title={title} style={width ? { flex: 'none', width } : undefined}>
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
      {trailing}
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
  title,
  live = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  glyph?: ReactNode;
  /** names the field for anyone who cannot see the label beside it */
  title?: string;
  /**
   * Reports every keystroke rather than waiting for Enter or a blur.
   *
   * A name field must not: renaming a layer on every keystroke fills the undo
   * stack with half-typed names. A search field must, because the list it
   * filters is the feedback.
   */
  live?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="fig-input">
      {glyph !== undefined && <span className="glyph">{glyph}</span>}
      <input
        value={draft ?? value}
        placeholder={placeholder}
        title={title}
        aria-label={title}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          if (live) onChange(e.target.value);
        }}
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
  /** offered but not choosable here — Figma greys these rather than hiding them */
  disabled?: boolean;
}

/** A dropdown that reads as a borderless field until hovered, like Figma's. */
export function FigSelect<T extends string>({
  value,
  options,
  onChange,
  glyph,
  title,
  width,
  mixed,
  beside,
}: {
  value: T;
  options: FigOption<T>[];
  onChange: (value: T) => void;
  glyph?: ReactNode;
  title?: string;
  width?: number | string;
  /**
   * The selected layers disagree. Figma leaves the trigger reading "Mixed" and
   * ticks nothing, so no option is claimed to apply to all of them.
   */
  mixed?: boolean;
  /**
   * Open to the left of the panel rather than under the field.
   *
   * A long menu hanging off a row halfway down the inspector covers the rows
   * you are about to check it against, and near the foot of the panel it has
   * nowhere to hang at all. Anything with more than a handful of entries goes
   * beside the panel by default, the way the font picker and the style menu do.
   */
  beside?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, w: 0, ready: false });
  const current = options.find((o) => o.value === value);

  /**
   * Below the field, unless below runs off the window.
   *
   * A panel is tall and a select near its bottom would otherwise open into
   * nothing — the menu is measured first, then placed above the field if that
   * is where it fits, and nudged up if neither side has room.
   */
  const aside = beside ?? options.length > 8;

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const height = list.current?.getBoundingClientRect().height ?? 0;
    const panel = aside ? anchor.current.closest('.fig')?.getBoundingClientRect() : null;
    const menuWidth = list.current?.getBoundingClientRect().width ?? rect.width;
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const flip = !panel && height > below && above > below;
    // beside the panel, the menu lines up with the row that opened it; under
    // the field it hangs off the bottom unless there is no room down there
    const top = panel
      ? Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))
      : flip
        ? Math.max(8, rect.top - height - 4)
        : Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - height - 8));
    const left = panel ? Math.max(8, panel.left - menuWidth - 8) : rect.left;
    setPos({ x: left, y: top, w: rect.width, ready: true });
  }, [open, options.length, aside]);

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
        // Figma's selects are comboboxes over a list of options, and a screen
        // reader — or a test — should be able to tell one from a plain button
        role="combobox"
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{ flex: width ? 'none' : '1 1 0', width, cursor: 'default' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {glyph !== undefined && <span className="glyph">{glyph}</span>}
        <span className="fig-value">{mixed ? 'Mixed' : (current?.label ?? value)}</span>
        <span className="fig-caret">
          <Icon.Caret />
        </span>
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            // measured before it is placed; showing it first would flash it in
            // the wrong spot on every open
            visibility: pos.ready ? 'visible' : 'hidden',
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
                role="option"
                disabled={option.disabled}
                aria-selected={!mixed && option.value === value}
                aria-disabled={option.disabled || undefined}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  background: !mixed && option.value === value ? 'var(--fig-blue)' : undefined,
                  color: !mixed && option.value === value ? '#fff' : undefined,
                  opacity: option.disabled ? 0.4 : undefined,
                }}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {/* decorative: aria-selected already says which one is chosen,
                    and a tick inside the name would read as part of the label */}
                <span aria-hidden="true" style={{ width: 10, display: 'inline-flex' }}>
                  {!mixed && option.value === value ? '✓' : ''}
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

/**
 * What every paint picker in the panel needs to know.
 *
 * In Figma there is one colour picker, and it is the same one wherever a colour
 * appears — a fill, a stroke, a shadow, the text colour, a grid. It always
 * offers the document's colours, the file's variables, and a contrast reading.
 * Threading four props through every section that happens to show a swatch is
 * how that stops being true for the ones nobody remembered, so the panel
 * publishes it once and the rows read it.
 */
export interface PaintEnvironment {
  /** every colour already used on the page, for the "On this page" swatches */
  pageColors: string[];
  tokens: { id: string; name: string; value: string; type: string }[];
  /** turns the picked colour into a variable and returns its reference */
  onCreateToken?: (hex: string) => void;
}

const PaintContext = createContext<PaintEnvironment>({ pageColors: [], tokens: [] });

export function PaintProvider({
  value,
  children,
}: {
  value: PaintEnvironment;
  children: ReactNode;
}) {
  return <PaintContext.Provider value={value}>{children}</PaintContext.Provider>;
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
  pageColors,
  backdrop,
  tokens,
  onCreateToken,
  typeBody,
  alphaField,
  trailing,
  mixed,
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
  /** colours already used on the page; defaults to the panel's PaintProvider */
  pageColors?: string[];
  /** what this paint sits on, for the picker's contrast check */
  backdrop?: string;
  tokens?: { id: string; name: string; value: string; type: string }[];
  onCreateToken?: (hex: string) => void;
  /** the picker body for Video and Shader, which are layer properties */
  typeBody?: ReactNode;
  /** puts the opacity in a field box of its own, as Selection colors has it */
  alphaField?: boolean;
  /** an action revealed at the trailing edge of the paint field on hover */
  trailing?: ReactNode;
  /**
   * The selected layers do not share this paint. Figma says so rather than
   * showing one of them, which would invite you to flatten the rest by accident.
   */
  mixed?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);
  const checkbox = useId();
  const isHex = !mixed && /^#[0-9a-fA-F]{6}$/.test(color);
  const hex = mixed ? 'Mixed' : isHex ? color.slice(1).toUpperCase() : color;

  // Fill keeps swatch, hex and opacity in one box; Selection colors gives the
  // opacity a box of its own, which is what `alphaField` switches on.
  // an explicit prop still wins; the context is what a row gets for free
  const environment = useContext(PaintContext);
  const swatches = pageColors ?? environment.pageColors;
  const variables = tokens ?? environment.tokens;
  const createToken = onCreateToken ?? environment.onCreateToken;

  const alphaControls = onAlpha ? (
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
            // a percent every two pixels, so the whole range is one comfortable pull
            const next = scrubValue(e, from, e.clientX - startX, 0.01, 2);
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
  ) : null;

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
          aria-label={mixed ? 'Mixed paint' : isHex ? `Solid color hex: ${hex}` : 'Paint'}
          title="Open the color picker"
          style={{ background: mixed ? 'var(--fig-checker)' : color || '#DDDDDD' }}
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
            pageColors={swatches}
            backdrop={backdrop}
            tokens={variables}
            onChange={onColor}
            onAlpha={(next) => onAlpha?.(next)}
            onBlend={onBlend}
            onType={(kind) => onKind?.(kind)}
            onCreateToken={createToken}
            typeBody={typeBody}
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

        {!alphaField && alphaControls}
        {trailing && <span className="fig-paint-trailing">{trailing}</span>}
      </div>
      {alphaField && alphaControls && (
        <div className="fig-input fig-paint fig-paint-alpha-field">{alphaControls}</div>
      )}

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

/** One row of a dark floating menu — the blend modes, the effect types. */
export function FigMenuItem({
  label,
  icon,
  tag,
  selected,
  divider,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  /** the "Beta" pill Figma puts beside an unfinished entry */
  tag?: string;
  selected?: boolean;
  divider?: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {divider && <div className="fig-menu-sep" />}
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className="fig-menu-item"
        onClick={onSelect}
      >
        <span className="fig-menu-mark">
          {icon ?? (selected ? <FigIcon name="Selected check" size={16} /> : null)}
        </span>
        {label}
        {tag && <span className="fig-menu-tag">{tag}</span>}
      </button>
    </>
  );
}

/**
 * Blend mode.
 *
 * Figma puts it behind a header icon rather than an inline dropdown, and opens
 * a dark menu over the canvas — the same menu whether it is the layer's blend
 * mode or one effect's, which is why it lives here rather than in the panel.
 */
export function FigBlendMenu({
  value,
  onChange,
  icon,
  title,
  container,
}: {
  value: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
  title?: string;
  /** a group or frame, which is the only thing that can pass through */
  container?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <FigButton
        title={`${title ?? 'Apply blend mode'} — ${blendLabel(value)}`}
        on={open || blends(value)}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ?? <FigIcon name="Apply blend mode" />}
      </FigButton>
      {open && (
        <FigPopover anchor={anchor.current} width={190} variant="dark" onClose={() => setOpen(false)}>
          <ul role="listbox" aria-label="Blend mode" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {blendModes(container ?? false).map((mode) => (
              <li key={mode.value}>
                <FigMenuItem
                  label={mode.label}
                  selected={mode.value === value}
                  divider={mode.divider}
                  onSelect={() => {
                    onChange(mode.value);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        </FigPopover>
      )}
    </span>
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
  add,
  onAdd,
  onRemove,
  empty,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** an add control of the section's own — a + that opens a menu, say */
  add?: ReactNode;
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
        {add}
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
