'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FigIcon } from './FigIcon';
import {
  formatColor,
  gradientStops,
  hexToHsv,
  hsvToHex,
  parseColor,
  replaceGradientStop,
  resolveColor,
  type ColorFormat,
  type Hsv,
} from './color';

/**
 * Figma's paint picker.
 *
 * It is a dialog, not a menu: it stays open while you drag the reticle, sample
 * a colour, or type a value, and it closes on Escape or on its own close
 * button. Clicking through to the canvas keeps it open too, because in Figma
 * you pick a colour *while* watching the shape change.
 */

export type PaintType = 'solid' | 'gradient' | 'pattern' | 'image' | 'video' | 'shader';

const TYPES: { id: PaintType; label: string; icon: string }[] = [
  { id: 'solid', label: 'Solid', icon: 'Paint solid' },
  { id: 'gradient', label: 'Gradient', icon: 'Paint gradient' },
  { id: 'pattern', label: 'Pattern', icon: 'Paint pattern' },
  { id: 'image', label: 'Image', icon: 'Paint image' },
  { id: 'video', label: 'Video', icon: 'Paint video' },
  { id: 'shader', label: 'Shader', icon: 'Paint shader' },
];

const FORMATS: { id: ColorFormat; label: string }[] = [
  { id: 'hex', label: 'Hex' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'css', label: 'CSS' },
];

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

export interface PaintPickerProps {
  anchor: HTMLElement | null;
  value: string;
  /** overrides the type derived from `value`, for layer-level video and shader */
  type?: PaintType;
  alpha: number;
  blend?: string;
  /** every colour already used on the page, for the "On this page" swatches */
  pageColors: string[];
  tokens: { id: string; name: string; value: string; type: string }[];
  onChange: (value: string) => void;
  onAlpha: (alpha: number) => void;
  onBlend?: (mode: string) => void;
  onType: (type: PaintType) => void;
  onCreateToken?: (hex: string) => void;
  onClose: () => void;
}

export function PaintPicker({
  anchor,
  value,
  type: typeOverride,
  alpha,
  blend = 'normal',
  pageColors,
  tokens,
  onChange,
  onAlpha,
  onBlend,
  onType,
  onCreateToken,
  onClose,
}: PaintPickerProps) {
  const type = typeOverride ?? paintTypeOf(value);

  // A gradient has no single colour: the picker edits one stop at a time, and
  // writes back into the original string. Editing the whole value instead used
  // to replace the gradient with a flat colour on the first drag.
  const stops = type === 'gradient' || type === 'pattern' ? gradientStops(value) : [];
  const [stopIndex, setStopIndex] = useState(0);
  const stop = stops[Math.min(stopIndex, stops.length - 1)];

  // a fill can be `var(--ink)` or `rgb(...)`; the picker edits a real colour,
  // so resolve first rather than starting from an unrelated grey
  const solid = resolveColor(stop?.raw ?? value, tokens) ?? '#D9D9D9';

  const [tab, setTab] = useState<'custom' | 'libraries'>('custom');
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [draft, setDraft] = useState<string | null>(null);
  // hue lives here rather than being re-derived: black and grey have no hue, so
  // round-tripping would snap the strip back to red every time you hit an edge
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(solid));
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = hexToHsv(solid);
    setHsv((current) => (hsvToHex(current) === solid ? current : next));
  }, [solid]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = 240;
      // measure rather than assume: the dialog's height changes with the tab,
      // and guessing it wrong runs the bottom off the screen
      const height = dialog.current?.offsetHeight ?? 460;
      setBox({
        // opens beside the inspector, never over it
        left: Math.max(8, (anchor.closest('.fig')?.getBoundingClientRect().left ?? rect.left) - width - 8),
        top: Math.max(8, Math.min(rect.top - 24, window.innerHeight - height - 8)),
      });
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, tab]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);

  /** Writes a colour back where it came from: the paint, or one gradient stop. */
  const write = (hex: string) => {
    onChange(stops.length ? replaceGradientStop(value, stopIndex, hex) : hex);
  };

  const apply = (next: Hsv) => {
    setHsv(next);
    setDraft(null);
    write(hsvToHex(next));
  };

  if (!box || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Color picker"
      data-testid="paint-picker"
      ref={dialog}
      className="fig fig-picker"
      style={{ left: box.left, top: box.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="fig-picker-head">
        <div role="tablist" aria-label="Color source" className="fig-picker-tabs">
          {(['custom', 'libraries'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="fig-picker-tab"
              onClick={() => setTab(id)}
            >
              {id === 'custom' ? 'Custom' : 'Libraries'}
            </button>
          ))}
        </div>
        <div className="fig-picker-head-actions">
          {onCreateToken && (
            <button
              type="button"
              className="fig-btn"
              title="New style or variable"
              aria-label="New style or variable"
              onClick={() => onCreateToken(hsvToHex(hsv))}
            >
              <FigIcon name="Add fill" />
            </button>
          )}
          <button type="button" className="fig-btn" title="Close" aria-label="Close" onClick={onClose}>
            <FigIcon name="Close" />
          </button>
        </div>
      </header>

      {tab === 'custom' ? (
        <>
          <div className="fig-picker-types">
            <fieldset role="radiogroup" aria-label="Paint type">
              {TYPES.map((entry) => (
                <label
                  key={entry.id}
                  className="fig-picker-type"
                  data-on={type === entry.id}
                  title={entry.label}
                >
                  <input
                    type="radio"
                    name="paint-type"
                    value={entry.id}
                    checked={type === entry.id}
                    onChange={() => onType(entry.id)}
                  />
                  <FigIcon name={entry.icon} />
                  <span className="fig-sr">{entry.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="fig-picker-type-actions">
              {onBlend && (
                <Dropdown
                  label="Blend mode"
                  icon="Blend mode"
                  value={blend}
                  options={BLEND_MODES.map((mode) => ({ id: mode, label: titleCase(mode) }))}
                  onPick={onBlend}
                />
              )}
              <button
                type="button"
                className="fig-btn"
                title="Check color contrast"
                aria-label="Check color contrast"
                onClick={() => setFormat((f) => (f === 'hex' ? 'rgb' : 'hex'))}
              >
                <FigIcon name="Check color contrast" />
              </button>
            </div>
          </div>

          {stops.length > 1 && (
            <div className="fig-picker-stops" role="radiogroup" aria-label="Gradient stops">
              <span className="fig-picker-stops-preview" style={{ background: value }} />
              <div className="fig-picker-stops-chits">
                {stops.map((entry, index) => (
                  <button
                    key={`${entry.start}-${entry.raw}`}
                    type="button"
                    role="radio"
                    aria-checked={index === stopIndex}
                    aria-label={`Stop ${index + 1}`}
                    title={entry.raw}
                    className="fig-swatch fig-picker-stop"
                    data-on={index === stopIndex || undefined}
                    style={{ background: entry.raw }}
                    onClick={() => setStopIndex(index)}
                  />
                ))}
              </div>
            </div>
          )}

          <Spectrum hsv={hsv} onChange={apply} />

          <div className="fig-picker-controls">
            <EyeDropper onPick={(hex) => apply(hexToHsv(hex))} />
            <div className="fig-picker-sliders">
              <Slider
                label="Hue"
                value={hsv.h}
                max={359}
                text={`${Math.round(hsv.h)}°`}
                track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
                thumb={hsvToHex({ h: hsv.h, s: 1, v: 1 })}
                onChange={(h) => apply({ ...hsv, h })}
              />
              <Slider
                label="Opacity"
                value={alpha}
                max={1}
                step={0.01}
                text={`${Math.round(alpha * 100)}%`}
                track={`linear-gradient(90deg, transparent, ${hsvToHex(hsv)}), var(--fig-checker)`}
                thumb={hsvToHex(hsv)}
                onChange={onAlpha}
              />
            </div>
          </div>

          <div className="fig-picker-format">
            <Dropdown
              label="Color format"
              value={format}
              inline
              options={FORMATS.map((f) => ({ id: f.id, label: f.label }))}
              onPick={(id) => {
                setDraft(null);
                setFormat(id as ColorFormat);
              }}
            />
            <div className="fig-input fig-paint">
              <input
                aria-label="Color"
                value={draft ?? formatColor(hsvToHex(hsv), format, alpha)}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => {
                  setDraft(null);
                  const next = parseColor(e.target.value, format);
                  if (next) apply(hexToHsv(next));
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                style={{ marginLeft: 8, paddingRight: 0 }}
              />
              <input
                aria-label="Opacity"
                className="fig-paint-alpha"
                value={String(Math.round(alpha * 100))}
                spellCheck={false}
                onChange={(e) => {
                  const next = Number(e.target.value.replace(/[^0-9]/g, ''));
                  if (Number.isFinite(next)) onAlpha(Math.min(100, Math.max(0, next)) / 100);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="glyph fig-paint-percent">%</span>
            </div>
          </div>

          <div className="fig-picker-swatches">
            <Dropdown
              label="Color swatch set selector"
              value="page"
              inline
              wide
              options={[{ id: 'page', label: 'On this page' }]}
              onPick={() => undefined}
            />
            <div className="fig-picker-chits">
              {pageColors.length === 0 ? (
                <span style={{ color: 'var(--fig-dim)' }}>No colours on this page yet.</span>
              ) : (
                pageColors.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className="fig-swatch fig-picker-chit"
                    aria-label={`Solid color hex: ${hex.replace('#', '')}`}
                    title={hex}
                    style={{ background: hex }}
                    onClick={() => apply(hexToHsv(hex))}
                  />
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="fig-picker-libraries">
          {tokens.length === 0 ? (
            <span style={{ color: 'var(--fig-dim)', padding: 8 }}>
              No variables yet — create them in the Theme tab.
            </span>
          ) : (
            tokens.map((token) => (
              <button
                key={token.id}
                type="button"
                className="fig-btn"
                data-text="true"
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                onClick={() => {
                  write(`var(--${token.name})`);
                  onClose();
                }}
              >
                <span
                  className="fig-swatch"
                  style={{ margin: 0, background: token.type === 'color' ? token.value : 'transparent' }}
                />
                {token.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** The saturation / value square, with a reticle you can drag or arrow around. */
function Spectrum({ hsv, onChange }: { hsv: Hsv; onChange: (next: Hsv) => void }) {
  const surface = useRef<HTMLDivElement>(null);

  const pick = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const s = clamp((event.clientX - rect.left) / rect.width);
    const v = 1 - clamp((event.clientY - rect.top) / rect.height);
    onChange({ ...hsv, s, v });
  };

  return (
    <div className="fig-picker-spectrum">
      <div
        ref={surface}
        className="fig-picker-surface"
        style={{
          background:
            `linear-gradient(to top, #000, transparent), ` +
            `linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          pick(event);
          const move = (e: PointerEvent) => pick(e);
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Color picker reticle"
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        className="fig-picker-reticle"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: hsvToHex(hsv),
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[
            e.key
          ];
          if (!by) return;
          e.preventDefault();
          onChange({ ...hsv, s: clamp(hsv.s + by[0]), v: clamp(hsv.v + by[1]) });
        }}
      />
    </div>
  );
}

/** Figma's slim slider: a gradient track and a round thumb showing the value. */
function Slider({
  label,
  value,
  max,
  step = 1,
  text,
  track,
  thumb,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  text: string;
  track: string;
  thumb: string;
  onChange: (next: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);

  const pick = (event: { clientX: number }) => {
    const rect = rail.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(clamp((event.clientX - rect.left) / rect.width) * max);
  };

  return (
    <div
      ref={rail}
      className="fig-picker-slider"
      style={{ background: track }}
      onPointerDown={(event) => {
        event.preventDefault();
        pick(event);
        const move = (e: PointerEvent) => pick(e);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className="fig-picker-thumb"
        style={{ left: `${(value / max) * 100}%`, background: thumb }}
        onKeyDown={(e) => {
          const by = { ArrowLeft: -step, ArrowRight: step }[e.key];
          if (by === undefined) return;
          e.preventDefault();
          onChange(Math.min(max, Math.max(0, value + by)));
        }}
      />
    </div>
  );
}

/**
 * The eyedropper. Chrome ships the real thing; elsewhere the button is hidden
 * rather than pretending, because a dead control is worse than a missing one.
 */
function EyeDropper({ onPick }: { onPick: (hex: string) => void }) {
  const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
  if (!supported) return <span style={{ width: 24, flex: 'none' }} />;

  return (
    <button
      type="button"
      className="fig-btn"
      title="Sample color"
      aria-label="Sample color"
      onClick={async () => {
        try {
          const Dropper = (window as unknown as {
            EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> };
          }).EyeDropper;
          const { sRGBHex } = await new Dropper().open();
          const parsed = parseColor(sRGBHex, 'hex') ?? parseColor(sRGBHex, 'rgb');
          if (parsed) onPick(parsed);
        } catch {
          // the user pressed Escape out of the dropper
        }
      }}
    >
      <FigIcon name="Sample color" />
    </button>
  );
}

/** Figma's select: a trigger showing the value, and a listbox with a tick. */
function Dropdown({
  label,
  value,
  options,
  onPick,
  icon,
  inline,
  wide,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
  icon?: string;
  inline?: boolean;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', flex: wide ? 1 : undefined }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        title={label}
        className={icon ? 'fig-btn' : 'fig-picker-select'}
        data-on={open || undefined}
        style={wide ? { flex: 1 } : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? (
          <FigIcon name={icon} />
        ) : (
          <>
            <span>{current?.label ?? value}</span>
            <FigIcon name="Select chevron" size={16} />
          </>
        )}
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="fig-picker-list" data-inline={inline || undefined}>
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={option.id === value}
                className="fig-btn"
                data-text="true"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => {
                  onPick(option.id);
                  setOpen(false);
                }}
              >
                <span style={{ width: 16, flex: 'none', display: 'inline-flex' }}>
                  {option.id === value && <FigIcon name="Selected check" size={16} />}
                </span>
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function paintTypeOf(value: string): PaintType {
  if (!value) return 'solid';
  if (/repeating-(linear|radial|conic)-gradient\(/.test(value)) return 'pattern';
  if (/gradient\(/.test(value)) return 'gradient';
  if (/^url\(/.test(value)) return 'image';
  return 'solid';
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
