'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import {
  FigBlendMenu,
  FigButton,
  FigField,
  FigMenuItem,
  FigPaintRow,
  FigPopover,
  FigSection,
  FigSelect,
} from './ui/Figma';
import { EFFECT_LABEL, EFFECT_MENU, EFFECT_PRESETS, effectsOf, newEffect } from '../document/effects';
import { defaultParams, SHADER_BY_ID, SHADERS } from '../webgl/shaders';
import type { Effect, EffectType, SceneNode } from '../document/types';

const EFFECT_ICON: Record<EffectType, ReactNode> = {
  'inner-shadow': <Icon.InnerShadow />,
  'drop-shadow': <Icon.DropShadow />,
  'layer-blur': <Icon.LayerBlur />,
  'background-blur': <Icon.BackgroundBlur />,
  noise: <Icon.Noise />,
  texture: <Icon.Texture />,
  glass: <Icon.Glass />,
  shader: <Icon.Waves />,
};

/** the effect types whose settings include a colour, and so a blend mode */
const TINTED: EffectType[] = ['inner-shadow', 'drop-shadow', 'noise', 'shader'];

/**
 * Effects.
 *
 * Figma's list, and Figma's shape of interaction: + opens a dark menu of the
 * eight effect types, each row names one effect and opens its own settings
 * dialog beside the panel, and the eye keeps an effect's settings while taking
 * it off the layer.
 */
export function EffectsSection({
  node,
  set,
}: {
  node: SceneNode;
  set: (patch: Partial<SceneNode>) => void;
}) {
  const effects = effectsOf(node);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [styling, setStyling] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLSpanElement | null>(null);
  const [styleAnchor, setStyleAnchor] = useState<HTMLSpanElement | null>(null);

  /**
   * Writing the list retires the pre-list fields at the same time. Leaving
   * `shadow` behind would be harmless today — `effectsOf` prefers the list —
   * but it is a second copy of the truth, and those drift.
   */
  const write = (next: Effect[]) =>
    set({
      effects: next,
      shadow: null,
      innerShadow: null,
      shadows: [],
      filters: node.filters ? { ...node.filters, blur: 0, backdropBlur: 0 } : null,
    });

  const patch = (id: string, delta: Partial<Effect>) =>
    write(effects.map((effect) => (effect.id === id ? { ...effect, ...delta } : effect)));

  const add = (type: EffectType) => {
    const effect = newEffect(type);
    // a shader effect needs something to draw the moment it is added
    if (type === 'shader') effect.shader = { id: SHADERS[0].id, params: defaultParams(SHADERS[0]) };
    write([...effects, effect]);
    setAdding(false);
    setOpenId(effect.id);
  };

  return (
    <FigSection
      title="Effects"
      empty={!effects.length}
      actions={
        <span ref={setStyleAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="Effects, apply styles" on={styling} onClick={() => setStyling((v) => !v)}>
            <FigIcon name="Effects, Apply styles" />
          </FigButton>
          {styling && (
            <FigPopover
              anchor={styleAnchor}
              width={196}
              variant="dark"
              onClose={() => setStyling(false)}
            >
              <ul role="listbox" aria-label="Effect styles" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {EFFECT_PRESETS.map((preset) => (
                  <li key={preset.name}>
                    <FigMenuItem
                      label={preset.name}
                      onSelect={() => {
                        write(preset.effects());
                        setStyling(false);
                        setOpenId(null);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </FigPopover>
          )}
        </span>
      }
      add={
        <span ref={setAddAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="Add effect" on={adding} onClick={() => setAdding((v) => !v)}>
            <FigIcon name="Add effect" />
          </FigButton>
          {adding && (
            <FigPopover
              anchor={addAnchor}
              width={196}
              variant="dark"
              onClose={() => setAdding(false)}
            >
              <ul role="listbox" aria-label="Add effect" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {EFFECT_MENU.map((entry) => (
                  <li key={entry.type}>
                    <FigMenuItem
                      label={EFFECT_LABEL[entry.type]}
                      icon={EFFECT_ICON[entry.type]}
                      tag={entry.type === 'shader' ? 'Beta' : undefined}
                      divider={entry.divider}
                      onSelect={() => add(entry.type)}
                    />
                  </li>
                ))}
              </ul>
            </FigPopover>
          )}
        </span>
      }
    >
      {effects.map((effect) => (
        <EffectRow
          key={effect.id}
          effect={effect}
          open={openId === effect.id}
          onOpen={() => setOpenId((id) => (id === effect.id ? null : effect.id))}
          onClose={() => setOpenId(null)}
          onChange={(delta) => patch(effect.id, delta)}
          onRemove={() => {
            write(effects.filter((other) => other.id !== effect.id));
            setOpenId(null);
          }}
        />
      ))}
    </FigSection>
  );
}

function EffectRow({
  effect,
  open,
  onOpen,
  onClose,
  onChange,
  onRemove,
}: {
  effect: Effect;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (delta: Partial<Effect>) => void;
  onRemove: () => void;
}) {
  // a callback ref, not useRef: a row that opens the moment it is added has no
  // ref set on its first render, and a popover anchored to null never places
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  return (
    <div className="fig-row" ref={setAnchor}>
      <button
        type="button"
        className="fig-effect"
        data-open={open ? 'true' : undefined}
        data-hidden={effect.visible === false ? 'true' : undefined}
        title={`${EFFECT_LABEL[effect.type]} settings`}
        aria-expanded={open}
        onClick={onOpen}
      >
        {EFFECT_ICON[effect.type]}
        <span>{EFFECT_LABEL[effect.type]}</span>
      </button>
      <FigButton
        title={effect.visible === false ? 'Show effect' : 'Hide effect'}
        onClick={() => onChange({ visible: effect.visible === false })}
      >
        <Icon.Eye off={effect.visible === false} />
      </FigButton>
      <FigButton title="Remove effect" onClick={onRemove}>
        <FigIcon name="Remove" />
      </FigButton>
      {open && (
        <FigPopover
          anchor={anchor}
          width={252}
          variant="card"
          placement="beside"
          onClose={onClose}
        >
          <EffectDialog effect={effect} onChange={onChange} onClose={onClose} />
        </FigPopover>
      )}
    </div>
  );
}

/** The settings dialog: a header that can retype the effect, then its controls. */
function EffectDialog({
  effect,
  onChange,
  onClose,
}: {
  effect: Effect;
  onChange: (delta: Partial<Effect>) => void;
  onClose: () => void;
}) {
  const [retyping, setRetyping] = useState(false);
  const [title, setTitle] = useState<HTMLButtonElement | null>(null);

  return (
    <div className="fig-card">
      <header className="fig-card-head">
        <button
          ref={setTitle}
          type="button"
          className="fig-card-title"
          title="Change effect type"
          onClick={() => setRetyping((v) => !v)}
        >
          {EFFECT_ICON[effect.type]}
          {EFFECT_LABEL[effect.type]}
          <Icon.Caret />
        </button>
        {retyping && (
          <FigPopover anchor={title} width={196} variant="dark" align="left" onClose={() => setRetyping(false)}>
            <ul role="listbox" aria-label="Effect type" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {EFFECT_MENU.map((entry) => (
                <li key={entry.type}>
                  <FigMenuItem
                    label={EFFECT_LABEL[entry.type]}
                    icon={EFFECT_ICON[entry.type]}
                    tag={entry.type === 'shader' ? 'Beta' : undefined}
                    divider={entry.divider}
                    selected={entry.type === effect.type}
                    onSelect={() => {
                      onChange({
                        type: entry.type,
                        // a shader has to have something to draw
                        shader:
                          entry.type === 'shader' && !effect.shader
                            ? { id: SHADERS[0].id, params: defaultParams(SHADERS[0]) }
                            : effect.shader,
                      });
                      setRetyping(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          </FigPopover>
        )}
        {TINTED.includes(effect.type) && (
          <FigBlendMenu
            value={effect.blend}
            title="Effect blend mode"
            icon={<Icon.Droplet />}
            onChange={(blend) => onChange({ blend })}
          />
        )}
        <FigButton title="Close" onClick={onClose}>
          <Icon.Close />
        </FigButton>
      </header>

      {(effect.type === 'drop-shadow' || effect.type === 'inner-shadow') && (
        <ShadowFields effect={effect} onChange={onChange} />
      )}
      {(effect.type === 'layer-blur' || effect.type === 'background-blur') && (
        <BlurFields effect={effect} onChange={onChange} />
      )}
      {effect.type === 'noise' && <NoiseFields effect={effect} onChange={onChange} />}
      {effect.type === 'texture' && <TextureFields effect={effect} onChange={onChange} />}
      {effect.type === 'glass' && <GlassFields effect={effect} onChange={onChange} />}
      {effect.type === 'shader' && <ShaderFields effect={effect} onChange={onChange} />}
    </div>
  );
}

type FieldProps = { effect: Effect; onChange: (delta: Partial<Effect>) => void };

/** A dialog row: a grey caption, then the control. A blank caption keeps the grid. */
function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="fig-card-row">
      <span className="fig-card-label">{label}</span>
      {children}
    </div>
  );
}

/** The segmented switch inside a dialog — Uniform/Progressive, Mono/Duo/Multi. */
function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="fig-pills" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          data-on={option.value === value ? 'true' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const AXIS = (letter: string) => <span style={{ fontSize: 11 }}>{letter}</span>;

function ShadowFields({ effect, onChange }: FieldProps) {
  return (
    <>
      <Row label="Position">
        <FigField value={effect.x} glyph={AXIS('X')} title="X offset" onChange={(x) => onChange({ x })} />
      </Row>
      <Row>
        <FigField value={effect.y} glyph={AXIS('Y')} title="Y offset" onChange={(y) => onChange({ y })} />
      </Row>
      <Row label="Blur">
        <FigField
          value={effect.blur}
          glyph={<Icon.LayerBlur />}
          min={0}
          title="Blur"
          onChange={(blur) => onChange({ blur })}
        />
      </Row>
      <Row label="Spread">
        <FigField
          value={effect.spread}
          glyph={<Icon.Spread />}
          title="Spread"
          onChange={(spread) => onChange({ spread })}
        />
      </Row>
      <Row label="Color">
        <FigPaintRow
          color={effect.color}
          alpha={effect.opacity}
          alphaField
          onColor={(color) => onChange({ color })}
          onAlpha={(opacity) => onChange({ opacity })}
        />
      </Row>
    </>
  );
}

function BlurFields({ effect, onChange }: FieldProps) {
  return (
    <>
      <div className="fig-card-row">
        <Pills
          value={effect.progressive ? 'progressive' : 'uniform'}
          options={[
            { value: 'uniform', label: 'Uniform' },
            { value: 'progressive', label: 'Progressive' },
          ]}
          onChange={(mode) => onChange({ progressive: mode === 'progressive' })}
        />
      </div>
      {effect.progressive ? (
        <>
          <Row label="Start">
            <FigField
              value={effect.start}
              glyph={<Icon.LayerBlur />}
              min={0}
              title="Blur at the start"
              onChange={(start) => onChange({ start })}
            />
          </Row>
          <Row label="End">
            <FigField
              value={effect.end}
              glyph={<Icon.LayerBlur />}
              min={0}
              title="Blur at the end"
              onChange={(end) => onChange({ end })}
            />
          </Row>
        </>
      ) : (
        <Row label="Blur">
          <FigField
            value={effect.blur}
            glyph={<Icon.LayerBlur />}
            min={0}
            title="Blur"
            onChange={(blur) => onChange({ blur })}
          />
        </Row>
      )}
    </>
  );
}

function NoiseFields({ effect, onChange }: FieldProps) {
  return (
    <>
      <div className="fig-card-row">
        <Pills
          value={effect.variant}
          options={[
            { value: 'mono', label: 'Mono' },
            { value: 'duo', label: 'Duo' },
            { value: 'multi', label: 'Multi' },
          ]}
          onChange={(variant) => onChange({ variant })}
        />
      </div>
      <Row label="Noise size">
        <FigField
          value={effect.sizeX}
          glyph={AXIS('X')}
          min={0.05}
          max={20}
          step={0.1}
          sensitivity={20}
          title="Noise size"
          // the grain is square, so Y follows X — Figma greys its Y out too
          onChange={(size) => onChange({ sizeX: size, sizeY: size })}
        />
      </Row>
      <Row>
        <FigField value={effect.sizeY} glyph={AXIS('Y')} disabled title="Noise size, locked to X" onChange={() => {}} />
      </Row>
      <Row label="Density">
        <FigField
          value={Math.round(effect.density * 100)}
          glyph={<Icon.Noise />}
          min={0}
          max={100}
          suffix="%"
          title="Density"
          onChange={(density) => onChange({ density: density / 100 })}
        />
      </Row>
      {effect.variant === 'multi' ? (
        <Row label="Opacity">
          <FigField
            value={Math.round(effect.grain * 100)}
            glyph={<Icon.Opacity />}
            min={0}
            max={100}
            suffix="%"
            title="Opacity"
            onChange={(grain) => onChange({ grain: grain / 100 })}
          />
        </Row>
      ) : (
        <>
          <Row label={effect.variant === 'duo' ? 'Colors' : 'Color'}>
            <FigPaintRow
              color={effect.color}
              alpha={effect.opacity}
              alphaField
              onColor={(color) => onChange({ color })}
              onAlpha={(opacity) => onChange({ opacity })}
            />
          </Row>
          {effect.variant === 'duo' && (
            <Row>
              <FigPaintRow
                color={effect.color2}
                alpha={effect.opacity2}
                alphaField
                onColor={(color2) => onChange({ color2 })}
                onAlpha={(opacity2) => onChange({ opacity2 })}
              />
            </Row>
          )}
        </>
      )}
    </>
  );
}

function TextureFields({ effect, onChange }: FieldProps) {
  return (
    <>
      <Row label="Size">
        <FigField
          value={effect.sizeX}
          glyph={AXIS('X')}
          min={0.05}
          max={20}
          step={0.1}
          sensitivity={20}
          title="Texture size"
          onChange={(size) => onChange({ sizeX: size, sizeY: size })}
        />
      </Row>
      <Row>
        <FigField value={effect.sizeY} glyph={AXIS('Y')} disabled title="Texture size, locked to X" onChange={() => {}} />
      </Row>
      <Row label="Radius">
        <FigField
          value={effect.radius}
          glyph={<Icon.Spread />}
          min={0}
          title="Radius"
          onChange={(radius) => onChange({ radius })}
        />
      </Row>
      <label className="fig-card-check">
        <input
          type="checkbox"
          checked={effect.clip}
          onChange={() => onChange({ clip: !effect.clip })}
        />
        Clip to shape
      </label>
    </>
  );
}

function GlassFields({ effect, onChange }: FieldProps) {
  return (
    <>
      <Row label="Blur">
        <FigField
          value={effect.blur}
          glyph={<Icon.LayerBlur />}
          min={0}
          title="Blur"
          onChange={(blur) => onChange({ blur })}
        />
      </Row>
      <Row label="Refraction">
        <FigField
          value={Math.round(effect.refraction * 100)}
          glyph={<Icon.Glass />}
          min={0}
          max={100}
          suffix="%"
          title="Refraction"
          onChange={(refraction) => onChange({ refraction: refraction / 100 })}
        />
      </Row>
      <Row label="Depth">
        <FigField
          value={effect.depth}
          glyph={<Icon.Spread />}
          min={0}
          max={64}
          title="Depth"
          onChange={(depth) => onChange({ depth })}
        />
      </Row>
    </>
  );
}

function ShaderFields({ effect, onChange }: FieldProps) {
  const spec = effect.shader ?? { id: SHADERS[0].id, params: defaultParams(SHADERS[0]) };

  return (
    <Row label="Shader">
      <FigSelect
        value={spec.id}
        options={SHADERS.map((entry) => ({ value: entry.id, label: entry.name }))}
        title="Shader"
        onChange={(id) => {
          const next = SHADER_BY_ID.get(id);
          if (next) onChange({ shader: { id, params: defaultParams(next) } });
        }}
      />
    </Row>
  );
}
