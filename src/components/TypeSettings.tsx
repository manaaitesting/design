'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './ui/Icons';
import { FigButton, FigField, FigGroup, FigPopover, FigSelect, FigText } from './ui/Figma';
import { useCustomFonts } from './Session';
import { customFamilies, fontFor, nearestStyle, AXIS_LABEL, type FontAxis } from '../lib/fonts';
import type { FontSpec, SceneNode } from '../document/types';

/**
 * Type settings.
 *
 * The sliders button beside the Typography header opens this: everything about
 * a face that is a *choice* rather than a size — how it is aligned and cased,
 * what it does with numbers and quotation marks, and, for a variable family,
 * where on each of its axes it sits.
 *
 * Three tabs, as Figma has them. Basics is what you reach for while designing;
 * Details is the typographic fine print, which is worth having but not worth
 * the panel space; Variable is the family's own axes, and is empty for a static
 * face because there is nothing there to move.
 */

type Tab = 'basics' | 'details' | 'variable';

export function TypeSettings({
  node,
  font,
  patch,
  set,
  onClose,
}: {
  node: SceneNode;
  font: FontSpec;
  patch: (delta: Partial<FontSpec>) => void;
  set: (delta: Partial<SceneNode>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('basics');
  const custom = useCustomFonts();
  const uploaded = useMemo(() => customFamilies(custom), [custom]);
  const face = fontFor(font.family, uploaded);

  return (
    <div className="fig-type">
      <header className="fig-type-tabs">
        {(['basics', 'details', 'variable'] as Tab[]).map((entry) => (
          <button
            key={entry}
            type="button"
            data-on={tab === entry ? 'true' : undefined}
            onClick={() => setTab(entry)}
          >
            {entry === 'basics' ? 'Basics' : entry === 'details' ? 'Details' : 'Variable'}
          </button>
        ))}
        <FigButton title="Close" onClick={onClose}>
          <Icon.Close />
        </FigButton>
      </header>

      <Preview font={font} />

      {tab === 'basics' && <Basics node={node} font={font} patch={patch} set={set} />}
      {tab === 'details' && <Details font={font} patch={patch} />}
      {tab === 'variable' && <Variable font={font} axes={face?.axes ?? []} patch={patch} />}
    </div>
  );
}

/**
 * The specimen at the top of the dialog.
 *
 * It is the layer's own text set in the layer's own type, which is the only
 * preview worth having: a slider that changes the slant is much easier to
 * understand when the thing it slants is the sentence you are working on.
 */
function Preview({ font }: { font: FontSpec }) {
  const variations = Object.entries(font.variations ?? {});
  return (
    <div className="fig-type-preview">
      <span
        style={{
          fontFamily: font.family,
          fontWeight: font.weight,
          fontStyle: font.italic ? 'italic' : undefined,
          fontVariationSettings: variations.length
            ? variations.map(([tag, value]) => `"${tag}" ${value}`).join(', ')
            : undefined,
          letterSpacing: font.letterSpacing ? `${font.letterSpacing}em` : undefined,
          textTransform:
            font.case === 'upper'
              ? 'uppercase'
              : font.case === 'lower'
                ? 'lowercase'
                : font.case === 'title'
                  ? 'capitalize'
                  : undefined,
          fontVariantCaps: font.case === 'small' ? 'small-caps' : undefined,
        }}
      >
        Preview
      </span>
    </div>
  );
}

/** A dialog row: a grey caption, then the control. */
function Row({ label, children, dim }: { label?: string; children: ReactNode; dim?: boolean }) {
  return (
    <div className="fig-type-row" data-dim={dim ? 'true' : undefined}>
      <span className="fig-type-label">{label}</span>
      {children}
    </div>
  );
}

/** Figma's — / ✓ pair: a feature that is either off or on. */
function OnOff({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fig-seg fig-seg-pair" data-disabled={disabled ? 'true' : undefined}>
      <button
        type="button"
        title="Off"
        data-on={!value ? 'true' : undefined}
        onClick={() => !disabled && onChange(false)}
      >
        <Icon.Minus />
      </button>
      <button
        type="button"
        title="On"
        data-on={value ? 'true' : undefined}
        onClick={() => !disabled && onChange(true)}
      >
        ✓
      </button>
    </div>
  );
}

const CASE_OPTIONS = [
  { value: 'none', label: <Icon.Minus />, title: 'As typed' },
  { value: 'upper', label: 'AG', title: 'Uppercase' },
  { value: 'lower', label: 'ag', title: 'Lowercase' },
  { value: 'title', label: 'Ag', title: 'Title case' },
  { value: 'small', label: 'Aɢ', title: 'Small caps' },
] as const;

function Basics({
  node,
  font,
  patch,
  set,
}: {
  node: SceneNode;
  font: FontSpec;
  patch: (delta: Partial<FontSpec>) => void;
  set: (delta: Partial<SceneNode>) => void;
}) {
  const [moreDecoration, setMoreDecoration] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const decoration = !node.underline
    ? 'none'
    : node.underline.line === 'strikethrough'
      ? 'strike'
      : 'underline';

  const setDecoration = (
    value: 'none' | 'underline' | 'strike',
    style: NonNullable<SceneNode['underline']>['style'] = node.underline?.style ?? 'solid',
  ) =>
    set({
      underline:
        value === 'none'
          ? null
          : {
              line: value === 'strike' ? 'strikethrough' : 'underline',
              style,
              color: node.underline?.color ?? font.color,
              thickness: node.underline?.thickness ?? 1,
              offset: node.underline?.offset ?? 2,
            },
    });

  return (
    <>
      <Row label="Alignment">
        <FigGroup
          value={font.align}
          onChange={(align) => patch({ align })}
          options={[
            { value: 'left', label: <Icon.AlignH at="left" />, title: 'Align left' },
            { value: 'center', label: <Icon.AlignH at="center" />, title: 'Align center' },
            { value: 'right', label: <Icon.AlignH at="right" />, title: 'Align right' },
            { value: 'justify', label: <Icon.AlignH at="justify" />, title: 'Justify' },
          ]}
        />
      </Row>

      <Row label="Decoration">
        <FigGroup
          value={decoration}
          onChange={(value) => setDecoration(value)}
          options={[
            { value: 'none', label: <Icon.Minus />, title: 'None' },
            { value: 'underline', label: <span style={{ textDecoration: 'underline' }}>U</span>, title: 'Underline' },
            { value: 'strike', label: <span style={{ textDecoration: 'line-through' }}>S</span>, title: 'Strikethrough' },
          ]}
        />
        <span ref={setAnchor} style={{ display: 'inline-flex' }}>
          <FigButton
            title="Underline style"
            on={moreDecoration}
            disabled={decoration === 'none'}
            onClick={() => setMoreDecoration((v) => !v)}
          >
            <Icon.Chevron />
          </FigButton>
        </span>
        {moreDecoration && (
          <FigPopover anchor={anchor} width={170} variant="dark" onClose={() => setMoreDecoration(false)}>
            <ul role="listbox" aria-label="Underline style" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {(['solid', 'double', 'dashed', 'dotted', 'wavy'] as const).map((style) => (
                <li key={style}>
                  <button
                    type="button"
                    className="fig-menu-item"
                    onClick={() => {
                      setDecoration(decoration === 'none' ? 'underline' : decoration, style);
                      setMoreDecoration(false);
                    }}
                  >
                    <span className="fig-menu-mark">
                      {node.underline?.style === style ? '✓' : ''}
                    </span>
                    <span style={{ textDecoration: `underline ${style}` }}>
                      {style[0].toUpperCase() + style.slice(1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </FigPopover>
        )}
      </Row>

      <Row label="Case">
        <FigGroup
          value={font.case ?? 'none'}
          onChange={(value) => patch({ case: value })}
          options={CASE_OPTIONS.map((option) => ({ ...option }))}
        />
      </Row>

      <div className="fig-type-rule" />

      <Row label="Vertical trim">
        <FigGroup
          value={font.verticalTrim ?? 'standard'}
          onChange={(verticalTrim) => patch({ verticalTrim })}
          options={[
            { value: 'standard', label: <Icon.Trim tight={false} />, title: 'Standard — keep the line box' },
            { value: 'cap', label: <Icon.Trim tight />, title: 'Cap height — trim to the letters' },
          ]}
        />
      </Row>

      <Row label="List style">
        <FigGroup
          value={font.list ?? 'none'}
          onChange={(list) => patch({ list })}
          options={[
            { value: 'none', label: <Icon.Minus />, title: 'No list' },
            { value: 'bullet', label: <Icon.List ordered={false} />, title: 'Bulleted' },
            { value: 'number', label: <Icon.List ordered />, title: 'Numbered' },
          ]}
        />
      </Row>

      <Row label="Paragraph spacing">
        <FigField
          value={font.paragraphSpacing ?? 0}
          min={0}
          title="Space between paragraphs"
          onChange={(paragraphSpacing) => patch({ paragraphSpacing })}
        />
      </Row>

      <Row label="Truncate text">
        <FigGroup
          value={font.maxLines ? 'on' : 'off'}
          onChange={(value) => patch({ maxLines: value === 'on' ? (font.maxLines || 1) : 0 })}
          options={[
            { value: 'off', label: <Icon.Minus />, title: 'Keep every line' },
            { value: 'on', label: 'A…', title: 'Truncate with an ellipsis' },
          ]}
        />
        {!!font.maxLines && (
          <FigField
            value={font.maxLines}
            min={1}
            max={99}
            width={52}
            title="Lines to keep"
            onChange={(maxLines) => patch({ maxLines })}
          />
        )}
      </Row>

      <Row label="Wrap style">
        <FigSelect
          value={font.wrap ?? 'auto'}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'balance', label: 'Balance' },
            { value: 'pretty', label: 'Pretty' },
          ]}
          title="How the browser chooses where lines break"
          onChange={(wrap) => patch({ wrap })}
        />
      </Row>
    </>
  );
}

function Details({ font, patch }: { font: FontSpec; patch: (delta: Partial<FontSpec>) => void }) {
  const caps = font.case === 'upper' || font.case === 'small';
  return (
    <>
      <div className="fig-type-legend">Indentation</div>
      <Row label="Hanging punctuation">
        <OnOff
          value={!!font.hangingPunctuation}
          onChange={(hangingPunctuation) => patch({ hangingPunctuation })}
        />
      </Row>
      <Row label="Hanging lists" dim={!font.list || font.list === 'none'}>
        <OnOff
          value={font.hangingList !== false}
          disabled={!font.list || font.list === 'none'}
          onChange={(hangingList) => patch({ hangingList })}
        />
      </Row>
      <Row label="Paragraph indent">
        <FigField
          value={font.paragraphIndent ?? 0}
          min={0}
          title="First-line indent"
          onChange={(paragraphIndent) => patch({ paragraphIndent })}
        />
      </Row>

      <div className="fig-type-rule" />
      <div className="fig-type-legend">Letter case</div>
      <Row label="Case">
        <FigGroup
          value={font.case ?? 'none'}
          onChange={(value) => patch({ case: value })}
          options={CASE_OPTIONS.map((option) => ({ ...option }))}
        />
      </Row>
      {/* both features only do anything to capitals, so they read as unavailable
          until the text has some — which is Figma's own behaviour */}
      <Row label="Case-sensitive forms" dim={!caps}>
        <OnOff value={!!font.caseSensitive} onChange={(caseSensitive) => patch({ caseSensitive })} />
      </Row>
      <Row label="Capital spacing" dim={!caps}>
        <OnOff value={!!font.capitalSpacing} onChange={(capitalSpacing) => patch({ capitalSpacing })} />
      </Row>

      <div className="fig-type-rule" />
      <div className="fig-type-legend">Numbers</div>
      <Row label="Figure style">
        <FigSelect
          value={font.numeric ?? 'normal'}
          options={[
            { value: 'normal', label: 'Default' },
            { value: 'tabular', label: 'Tabular' },
            { value: 'oldstyle', label: 'Old-style' },
          ]}
          title="Tabular figures line up in a column; old-style figures sit in running text"
          onChange={(numeric) => patch({ numeric })}
        />
      </Row>
      <Row label="Position">
        <FigSelect
          value={font.numberPosition ?? 'normal'}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'super', label: 'Superscript' },
            { value: 'sub', label: 'Subscript' },
          ]}
          title="Number position"
          onChange={(numberPosition) => patch({ numberPosition })}
        />
      </Row>
      <Row label="Slashed zero">
        <OnOff value={!!font.slashedZero} onChange={(slashedZero) => patch({ slashedZero })} />
      </Row>
      <Row label="Fractions">
        <OnOff value={!!font.fractions} onChange={(fractions) => patch({ fractions })} />
      </Row>
      <Row label="Ordinals">
        <OnOff value={!!font.ordinals} onChange={(ordinals) => patch({ ordinals })} />
      </Row>

      <div className="fig-type-rule" />
      <div className="fig-type-legend">Features</div>
      <Row label="OpenType">
        <FigText
          value={(font.features ?? []).join(', ')}
          placeholder="ss01, dlig…"
          onChange={(value) =>
            patch({
              features: value
                .split(/[,\s]+/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </Row>
    </>
  );
}

/**
 * The family's own axes.
 *
 * A variable font is one file that interpolates, so these are continuous rather
 * than a list of cuts — and `wght` is written back to the layer's weight as
 * well, because a design that says 550 has to keep saying 550 when it is
 * exported to CSS that only knows `font-weight`.
 */
function Variable({
  font,
  axes,
  patch,
}: {
  font: FontSpec;
  axes: FontAxis[];
  patch: (delta: Partial<FontSpec>) => void;
}) {
  if (!axes.length) {
    return (
      <div className="fig-note" style={{ margin: '12px 0 4px' }}>
        This family is a set of fixed cuts, so it has no axes to move. Pick a
        variable family — the font menu lists them under “Variable fonts” — to
        set a weight between the ones it ships.
      </div>
    );
  }

  const valueOf = (axis: FontAxis) =>
    font.variations?.[axis.tag] ?? (axis.tag === 'wght' ? font.weight : axis.def);

  const setAxis = (axis: FontAxis, raw: number) => {
    const value = Math.min(axis.max, Math.max(axis.min, raw));
    const variations = { ...(font.variations ?? {}), [axis.tag]: value };
    patch(axis.tag === 'wght' ? { variations, weight: Math.round(value) } : { variations });
  };

  return (
    <>
      {axes.map((axis) => {
        const value = valueOf(axis);
        // the named cuts along this axis, as the dots under Figma's slider
        const stops =
          axis.tag === 'wght'
            ? [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].filter(
                (stop) => stop >= axis.min && stop <= axis.max,
              )
            : [];
        return (
          <div key={axis.tag} className="fig-axis">
            <div className="fig-type-row">
              <span className="fig-type-label">{AXIS_LABEL(axis.tag)}</span>
              <FigField
                value={Number(value.toFixed(2))}
                min={axis.min}
                max={axis.max}
                step={axis.max - axis.min <= 4 ? 0.1 : 1}
                title={`${axis.tag} — ${axis.min} to ${axis.max}`}
                onChange={(next) => setAxis(axis, next)}
              />
            </div>
            <div className="fig-axis-track">
              <input
                type="range"
                className="fig-slider"
                min={axis.min}
                max={axis.max}
                step={axis.max - axis.min <= 4 ? 0.01 : 1}
                value={value}
                aria-label={AXIS_LABEL(axis.tag)}
                onChange={(event) => setAxis(axis, Number(event.target.value))}
              />
              {stops.length > 1 && (
                <div className="fig-axis-stops" aria-hidden>
                  {stops.map((stop) => (
                    <span
                      key={stop}
                      style={{ left: `${((stop - axis.min) / (axis.max - axis.min)) * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="fig-more"
        title="Go back to the family's named cuts"
        onClick={() => {
          const reset = nearestStyle(font.family, font.weight, !!font.italic);
          patch({ variations: undefined, weight: reset.weight });
        }}
      >
        Reset to named styles
      </button>
    </>
  );
}
