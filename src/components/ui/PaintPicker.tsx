'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FigIcon } from './FigIcon';
import { readImageFile } from '../../lib/images';
import { BLEND_MODES } from './blend';
import {
  contrastGrades,
  contrastRatio,
  formatColor,
  formatGradient,
  formatPattern,
  gradientStops,
  hexToHsv,
  hsvToHex,
  imageSrc,
  parseColor,
  parseGradient,
  parsePattern,
  replaceGradientStop,
  resolveColor,
  type ColorFormat,
  type Gradient,
  type GradientKind,
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

export interface PaintPickerProps {
  anchor: HTMLElement | null;
  value: string;
  /** overrides the type derived from `value`, for layer-level video and shader */
  type?: PaintType;
  alpha: number;
  blend?: string;
  /** every colour already used on the page, for the "On this page" swatches */
  pageColors: string[];
  /** what this paint sits on, so the contrast check has something to measure against */
  backdrop?: string;
  tokens: { id: string; name: string; value: string; type: string }[];
  onChange: (value: string) => void;
  onAlpha: (alpha: number) => void;
  onBlend?: (mode: string) => void;
  onType: (type: PaintType) => void;
  onCreateToken?: (hex: string) => void;
  /**
   * The body for a type the picker cannot edit from the paint string alone.
   * Video and Shader are layer properties, so their controls belong to whoever
   * owns the layer — the picker only makes room for them.
   */
  typeBody?: ReactNode;
  onClose: () => void;
}

export function PaintPicker({
  anchor,
  value,
  type: typeOverride,
  alpha,
  blend = 'normal',
  pageColors,
  backdrop = '#FFFFFF',
  tokens,
  onChange,
  onAlpha,
  onBlend,
  onType,
  onCreateToken,
  typeBody,
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
  const [contrast, setContrast] = useState(false);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [draft, setDraft] = useState<string | null>(null);
  // hue lives here rather than being re-derived: black and grey have no hue, so
  // round-tripping would snap the strip back to red every time you hit an edge
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(solid));
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  // held in state, not a ref: the dialog only mounts once `box` exists, so an
  // effect that wants to measure it has to re-run when it appears
  const [dialog, setDialog] = useState<HTMLDivElement | null>(null);

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
      const height = dialog?.offsetHeight ?? 460;
      setBox({
        // opens beside the inspector, never over it
        left: Math.max(8, (anchor.closest('.fig')?.getBoundingClientRect().left ?? rect.left) - width - 8),
        top: Math.max(8, Math.min(rect.top - 24, window.innerHeight - height - 8)),
      });
    };
    place();
    const frame = requestAnimationFrame(place);
    // The body changes height with the paint type — the gradient ramp and the
    // contrast report both add rows. Watching the dialog is what keeps the
    // bottom of it on screen; re-placing only on open left it hanging off.
    const observer = new ResizeObserver(place);
    if (dialog) observer.observe(dialog);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, tab, dialog]);

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
      ref={setDialog}
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
                  options={BLEND_MODES.map((mode) => ({
                    id: mode.value,
                    label: mode.label,
                    divider: mode.divider,
                  }))}
                  onPick={onBlend}
                />
              )}
              <button
                type="button"
                className="fig-btn"
                title="Check color contrast"
                aria-label="Check color contrast"
                aria-expanded={contrast}
                data-on={contrast || undefined}
                onClick={() => setContrast((v) => !v)}
              >
                <FigIcon name="Check color contrast" />
              </button>
            </div>
          </div>

          {contrast && <ContrastReport color={hsvToHex(hsv)} backdrop={backdrop} />}

          {type === 'gradient' && (
            <GradientRamp
              value={value}
              index={stopIndex}
              onIndex={setStopIndex}
              onChange={onChange}
            />
          )}
          {type === 'pattern' && <PatternControls value={value} onChange={onChange} />}

          {type === 'image' ? (
            <ImageBody value={value} onChange={onChange} />
          ) : type === 'video' || type === 'shader' ? (
            <div className="fig-picker-body">
              {typeBody ?? (
                <span style={{ color: 'var(--fig-dim)', padding: 8 }}>
                  This layer now paints with {type === 'video' ? 'a video' : 'a shader'}.
                </span>
              )}
            </div>
          ) : (
            <>
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
          )}
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

/**
 * Figma's contrast check.
 *
 * The button promised this and toggled the colour format instead. What it owes
 * you is the WCAG ratio between the paint you are picking and whatever sits
 * behind it, plus which thresholds that ratio clears.
 */
function ContrastReport({ color, backdrop }: { color: string; backdrop: string }) {
  const ratio = contrastRatio(color, backdrop);

  return (
    <div className="fig-picker-contrast">
      <div className="fig-picker-contrast-head">
        <span
          className="fig-picker-contrast-sample"
          style={{ background: backdrop, color }}
          aria-hidden="true"
        >
          Aa
        </span>
        <span>
          <strong aria-label={`Contrast ratio ${ratio.toFixed(2)} to 1`}>
            {ratio.toFixed(2)}
          </strong>
          <span style={{ color: 'var(--fig-dim)' }}> : 1</span>
        </span>
      </div>
      <div className="fig-picker-contrast-grades">
        {contrastGrades(ratio).map((grade) => (
          <span
            key={grade.label}
            className="fig-picker-grade"
            data-pass={grade.passes || undefined}
            title={`${grade.label} ${grade.passes ? 'passes' : 'fails'}`}
          >
            {grade.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The gradient ramp — Figma's stop bar.
 *
 * The stop chits below edit *colour*; this edits the gradient itself: which of
 * the three shapes it is, which way it runs, and where each stop sits. Dragging
 * a stop past its neighbour re-sorts on release, so the ramp always reads left
 * to right the way the paint does.
 */
function GradientRamp({
  value,
  index,
  onIndex,
  onChange,
}: {
  value: string;
  index: number;
  onIndex: (index: number) => void;
  onChange: (next: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const gradient = parseGradient(value);
  if (!gradient) return null;

  const write = (next: Gradient) => onChange(formatGradient(next));
  const selected = Math.min(index, gradient.stops.length - 1);

  const dragStop = (event: React.PointerEvent, at: number) => {
    event.preventDefault();
    onIndex(at);
    const move = (e: PointerEvent) => {
      const rect = rail.current?.getBoundingClientRect();
      if (!rect) return;
      const position = clamp((e.clientX - rect.left) / rect.width) * 100;
      const stops = gradient.stops.map((stop, i) => (i === at ? { ...stop, at: position } : stop));
      write({ ...gradient, stops });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // a stop dragged past its neighbour keeps its colour but takes its place
      const moving = gradient.stops[at];
      const sorted = [...gradient.stops].sort((a, b) => a.at - b.at);
      onIndex(Math.max(0, sorted.indexOf(moving)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="fig-picker-gradient">
      <div className="fig-picker-gradient-row">
        <Dropdown
          label="Gradient type"
          value={gradient.kind}
          inline
          wide
          options={[
            { id: 'linear', label: 'Linear' },
            { id: 'radial', label: 'Radial' },
            { id: 'conic', label: 'Angular' },
          ]}
          onPick={(kind) => write({ ...gradient, kind: kind as GradientKind })}
        />
        {gradient.kind !== 'radial' && (
          <NumberBox
            label="Gradient angle"
            value={gradient.angle}
            suffix="°"
            onChange={(angle) => write({ ...gradient, angle })}
          />
        )}
        <button
          type="button"
          className="fig-btn"
          title="Reverse the gradient"
          aria-label="Reverse the gradient"
          onClick={() =>
            write({
              ...gradient,
              stops: gradient.stops.map((stop) => ({ ...stop, at: 100 - stop.at })).reverse(),
            })
          }
        >
          <FigIcon name="Flip horizontal" />
        </button>
      </div>

      <div ref={rail} className="fig-picker-ramp" style={{ background: value }}>
        {gradient.stops.map((stop, at) => (
          <button
            key={at}
            type="button"
            role="radio"
            aria-checked={at === selected}
            aria-label={`Gradient stop ${at + 1}`}
            className="fig-picker-ramp-stop"
            data-on={at === selected || undefined}
            style={{ left: `${stop.at}%`, background: stop.color }}
            onPointerDown={(event) => dragStop(event, at)}
          />
        ))}
      </div>

      <div className="fig-picker-gradient-row">
        <button
          type="button"
          className="fig-btn"
          data-text="true"
          title="Add a stop"
          onClick={() => {
            // a new stop lands halfway to the next one, taking a blend of both
            const current = gradient.stops[selected];
            const next = gradient.stops[selected + 1] ?? gradient.stops[selected - 1] ?? current;
            const stops = [...gradient.stops];
            stops.splice(selected + 1, 0, {
              color: current.color,
              at: (current.at + next.at) / 2,
            });
            write({ ...gradient, stops });
            onIndex(selected + 1);
          }}
        >
          <FigIcon name="Add fill" />
          Add stop
        </button>
        <button
          type="button"
          className="fig-btn"
          title="Remove this stop"
          aria-label="Remove this stop"
          disabled={gradient.stops.length <= 2}
          onClick={() => {
            write({ ...gradient, stops: gradient.stops.filter((_, i) => i !== selected) });
            onIndex(Math.max(0, selected - 1));
          }}
        >
          <FigIcon name="Remove" />
        </button>
      </div>
    </div>
  );
}

/**
 * A pattern is a repeating two-stripe gradient, so its colours are edited by
 * the stop chits like any other gradient — what it needs of its own is the
 * geometry: which way the stripes run and how wide they are.
 */
function PatternControls({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const spec = parsePattern(value);
  if (!spec) return null;

  return (
    <div className="fig-picker-gradient">
      <div className="fig-picker-gradient-row">
        <NumberBox
          label="Pattern angle"
          value={spec.angle}
          suffix="°"
          onChange={(angle) => onChange(formatPattern({ ...spec, angle }))}
        />
        <NumberBox
          label="Stripe width"
          value={spec.size}
          min={1}
          suffix="px"
          onChange={(size) => onChange(formatPattern({ ...spec, size }))}
        />
      </div>
    </div>
  );
}

/**
 * The image tab. A file picked here is inlined as a data URL, which is what
 * makes an exported document self-contained — a link to a local file would
 * survive exactly as long as this machine's filesystem.
 */
function ImageBody({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const src = imageSrc(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fig-picker-image">
      <div
        className="fig-picker-image-preview"
        role="img"
        aria-label={src ? 'Image preview' : 'No image chosen'}
        style={src ? { backgroundImage: `url(${src})` } : undefined}
      />
      <div className="fig-picker-gradient-row">
        <label className="fig-btn" data-text="true" style={{ flex: 1, cursor: 'default' }}>
          Choose image…
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                setError(null);
                const image = await readImageFile(file);
                onChange(`url(${image.src})`);
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : 'Could not read that image.');
              }
            }}
          />
        </label>
      </div>
      <div className="fig-picker-gradient-row">
        <div className="fig-input" style={{ flex: 1 }}>
          <input
            aria-label="Image URL"
            placeholder="https://…/photo.jpg"
            value={draft ?? src}
            spellCheck={false}
            style={{ paddingLeft: 8 }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              setDraft(null);
              const next = e.target.value.trim();
              if (next && next !== src) onChange(`url(${next})`);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
      </div>
      {error && <span style={{ color: 'var(--fig-danger, #E5484D)', padding: '0 8px' }}>{error}</span>}
    </div>
  );
}

/** A compact numeric field for the picker's own rows. */
function NumberBox({
  label,
  value,
  onChange,
  suffix,
  min = -Infinity,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  suffix?: string;
  min?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="fig-input" style={{ flex: '0 0 64px' }} title={label}>
      <input
        aria-label={label}
        value={draft ?? `${Math.round(value)}${suffix ?? ''}`}
        spellCheck={false}
        style={{ paddingLeft: 8 }}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          setDraft(null);
          const next = Number.parseFloat(e.target.value.replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(next)) onChange(Math.max(min, next));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
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
  options: { id: string; label: string; divider?: boolean }[];
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
              {option.divider && (
                <div style={{ height: 1, background: 'var(--fig-line)', margin: '4px 6px' }} />
              )}
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
