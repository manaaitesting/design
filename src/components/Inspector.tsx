'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import {
  FigBlendMenu,
  FigButton,
  FigField,
  FigGroup,
  FigGroupSet,
  FigLabel,
  FigMenuItem,
  FigPaintRow,
  PaintProvider,
  type PaintEnvironment,
  FigPopover,
  FigSection,
  FigSelect,
  FigText,
  type FigOption,
} from './ui/Figma';
import { EffectsSection } from './EffectsSection';
import { InstancePropsSection, PropBindingRow, PropertiesSection } from './ComponentProps';
import { StyleBadge, StylePicker } from './StylePicker';
import type { Style } from '../document/store';
import { VariableMenu, variableLabel } from './VariablePicker';
import { Presence } from './Presence';
import { Inspect } from './Inspect';
import {
  useCollections,
  useCustomFonts,
  useDoc,
  useStore,
  useStyles,
  useTokens,
  useTokenVars,
  useVarNames,
} from './Session';
import { canHoldModes, inScope } from '../document/variables';
import { useUI } from '../state/ui';
import {
  alignAnchors,
  applyMirror,
  canEditPoints,
  cloneAnchor,
  clonePaths,
  editablePaths,
  mirrorOf,
  runningIndex,
  selectionBounds,
  type Anchor,
  type HandleMirror,
} from '../document/geometry';
import { resolveColor } from './ui/color';
import { measureChildren } from '../lib/measure';
import {
  customFamilies,
  ensureFont,
  FONT_SIZES,
  fontFor,
  nearestStyle,
  readFontFile,
  styleLabel,
  stylesOf,
  type FontFace,
} from '../lib/fonts';
import { FontPicker } from './FontPicker';
import { TypeSettings } from './TypeSettings';
import { ADJUST_LABEL, isNeutral, NO_ADJUST, type ImageAdjust } from '../document/adjust';
import { DEFAULT_FONT, DEFAULT_GUIDES, TYPE_LABEL } from '../document/defaults';
import { nodeToSvg } from '../export/raster';
import { runExports } from '../export/run';
import { defaultParams, SHADER_BY_ID, SHADERS } from '../webgl/shaders';
import {
  descendants,
  isCanvasRoot,
  ROOT_ID,
  type ConditionBranch,
  type Easing,
  type TransitionSpec,
  type Interaction,
  type InteractionAction,
  type TransitionDirection,
  type TransitionType,
  type Trigger,
  type Align,
  type AlignContent,
  type Doc,
  type FlexSpec,
  type Justify,
  type NumericField,
  type Constraint,
  type LineStyle,
  type FontSpec,
  type Paint,
  type StyleKind,
  type SceneNode,
  type SizeMode,
  type ExportSetting,
  type Token,
  DEVICES,
  type BooleanOp,
  type PrototypeDevice,
} from '../document/types';
import { FRAME_PRESETS } from '../document/presets';
import type { PaintType } from './ui/PaintPicker';
import { conditionError } from '../document/condition';
import { newId } from '../lib/id';
import {
  ACTION_LABEL,
  DEFAULT_BEZIER,
  DEFAULT_OVERLAY,
  DEFAULT_SPRING,
  describe,
  destinationsOn,
  easingCss,
  flowsOn,
  frameOf,
  interactionsOf,
  isTouch,
  needsDestination,
  newInteraction,
  nextFlowName,
  shortTrigger,
  triggerLabel,
} from '../document/prototype';

type Setter = (patch: Partial<SceneNode>) => void;

/**
 * What a field should show for the whole selection.
 *
 * Figma reports "Mixed" rather than picking a winner. Showing the first layer's
 * number makes the panel claim something about the others that is not true —
 * and worse, scrubbing that field then silently flattens every layer onto a
 * value you were only ever shown by accident.
 */
function shared<T>(nodes: SceneNode[], read: (node: SceneNode) => T): T | 'mixed' {
  if (!nodes.length) return 'mixed';
  const first = read(nodes[0]);
  return nodes.every((node) => Object.is(read(node), first)) ? first : 'mixed';
}

/** Figma calls these Fixed / Hug contents / Fill container. */
const SIZE_MODES: FigOption<SizeMode>[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'fit', label: 'Hug contents' },
  { value: 'fill', label: 'Fill container' },
];

const LINE_STYLES: FigOption<LineStyle>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dash' },
  { value: 'dotted', label: 'Dot' },
];

const STROKE_POSITIONS: FigOption<'inside' | 'center' | 'outside'>[] = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
];



// ── Panel ────────────────────────────────────────────────────────────────

export function Inspector() {
  const doc = useDoc();
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const setExportOpen = useUI((s) => s.setExportOpen);
  const tokenVars = useTokenVars();
  const width = useUI((s) => s.rightWidth);
  const tab = useUI((s) => s.inspectorTab);
  const setTab = useUI((s) => s.setInspectorTab);
  const vectorEdit = useUI((s) => s.vectorEdit);
  const page = useUI((s) => s.page);

  const nodes = selection.map((id) => doc[id]).filter(Boolean) as SceneNode[];
  const node = nodes[0];
  const set: Setter = (patch) => store.updateMany(selection, patch);

  // One paint environment for the whole panel: in Figma every swatch opens the
  // same picker, with the document's colours and the file's variables in it.
  const allTokens = store.listTokens();
  const paintEnvironment = useMemo<PaintEnvironment>(
    () => ({
      pageColors: pageColors(doc, page, allTokens),
      tokens: allTokens,
      onCreateToken: (hex: string) => {
        store.addToken({ name: `color-${allTokens.length + 1}`, type: 'color', value: hex });
      },
    }),
    [doc, page, allTokens, store],
  );

  return (
    <PaintProvider value={paintEnvironment}>
    <div className="fig" style={{ ...(tokenVars as React.CSSProperties), width }}>
      <Presence />

      <div className="fig-tabs">
        <button
          type="button"
          className="fig-tab"
          data-on={tab === 'design'}
          onClick={() => setTab('design')}
        >
          Design
        </button>
        <button
          type="button"
          className="fig-tab"
          data-on={tab === 'prototype'}
          onClick={() => setTab('prototype')}
        >
          Prototype
        </button>
        <button
          type="button"
          className="fig-tab"
          data-on={tab === 'inspect'}
          title="Inspect  ⇧D"
          onClick={() => setTab('inspect')}
        >
          Inspect
        </button>
      </div>

      {tab === 'prototype' ? (
        <PrototypeTab node={node} />
      ) : tab === 'inspect' ? (
        <Inspect node={node} />
      ) : (
        <div className="scroll" style={{ flex: 1 }}>
          {!node ? (
            <PageSection />
          ) : vectorEdit === node.id ? (
            // Point editing replaces the layer's own panel with the point's,
            // exactly as Figma's does — the position of a rectangle is not what
            // you are adjusting while you are inside it.
            <>
              <LayerHeader node={node} />
              <VectorSection node={node} />
              <FillSection node={node} nodes={nodes} set={set} />
              <StrokeSection node={node} nodes={nodes} set={set} />
            </>
          ) : (
            <>
              <LayerHeader node={node} />
              <ComponentSection node={node} />
              <PropertiesSection node={node} />
              <InstancePropsSection node={node} />
              <PositionSection node={node} nodes={nodes} set={set} />
              <LayoutSection node={node} nodes={nodes} set={set} />
              <AppearanceSection node={node} nodes={nodes} set={set} />
              <ShapeSection node={node} nodes={nodes} set={set} />
              <ModesSection node={node} />
              {node.type === 'text' && <TypographySection node={node} set={set} />}
              {/* the parameters belong to whichever layer carries the shader, not
                  only to a layer that is nothing but one */}
              {node.shader && <ShaderSection node={node} set={set} />}
              {node.type !== 'shader' && <FillSection node={node} nodes={nodes} set={set} />}
              <StrokeSection node={node} nodes={nodes} set={set} />
              <EffectsSection node={node} set={set} />
              <SelectionColors />
              {node.type === 'frame' && <GuidesSection node={node} set={set} />}
              {node.type === 'frame' && <VideoSection node={node} set={set} />}
              <ExportSection
                node={node}
                nodes={nodes}
                set={set}
                onExport={() => setExportOpen(true)}
              />
            </>
          )}
        </div>
      )}
    </div>
    </PaintProvider>
  );
}

// ── Layer header ─────────────────────────────────────────────────────────

/**
 * Figma's hyperlink button — ⌘K on a text layer.
 *
 * The link belongs to the layer, so it survives everything the layer does:
 * the export writes it as an `<a href>`, and a click in the prototype follows
 * it. Clearing the field removes the link, which is how Figma's does it too.
 */
function LinkButton({ node }: { node: SceneNode }) {
  const store = useStore();
  const linkEditor = useUI((s) => s.linkEditor);
  const setLinkEditor = useUI((s) => s.setLinkEditor);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  // ⌘K asks for this popover from the canvas, where the button is not
  useEffect(() => {
    if (linkEditor === node.id) {
      setOpen(true);
      setLinkEditor(null);
    }
  }, [linkEditor, node.id, setLinkEditor]);

  return (
    <span ref={setAnchor} style={{ display: 'inline-flex' }}>
      <FigButton
        title={node.link ? `Link: ${node.link}` : 'Create link  ⌘K'}
        on={open || !!node.link}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Link />
      </FigButton>
      {open && (
        <FigPopover anchor={anchor} width={244} onClose={() => setOpen(false)}>
          <div style={{ padding: '4px 6px 8px' }}>
            <FigLabel>Link</FigLabel>
            <div className="fig-row" style={{ marginTop: 0 }}>
              <FigText
                value={node.link ?? ''}
                placeholder="https://…"
                onChange={(value) => store.update(node.id, { link: value.trim() || null })}
              />
            </div>
            {node.link && (
              <FigButton
                style={{ width: '100%', justifyContent: 'flex-start', marginTop: 4 }}
                onClick={() => {
                  store.update(node.id, { link: null });
                  setOpen(false);
                }}
              >
                <FigIcon name="Remove" />
                <span>Remove link</span>
              </FigButton>
            )}
          </div>
        </FigPopover>
      )}
    </span>
  );
}

/**
 * The layer type, with Figma's dimension presets behind it.
 *
 * Figma writes the *type* at the head of the panel — "Frame", "Text" — and
 * hangs the device sizes off it, which is where people look for them. The name
 * is edited beside it here rather than only in the layers panel, so both are
 * one click away.
 */
function TypeMenu({ node }: { node: SceneNode }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const sizeable = node.type === 'frame' || node.type === 'section';

  return (
    <span ref={setAnchor} style={{ display: 'inline-flex' }}>
      <button
        type="button"
        className="fig-node-type"
        title={sizeable ? 'Frame dimension presets' : TYPE_LABEL[node.type] ?? node.type}
        aria-label={
          sizeable ? `${TYPE_LABEL[node.type] ?? node.type}, frame dimension presets` : undefined
        }
        disabled={!sizeable}
        onClick={() => sizeable && setOpen((v) => !v)}
      >
        <span>{TYPE_LABEL[node.type] ?? node.type}</span>
        {sizeable && (
          <span className="fig-caret">
            <Icon.Caret />
          </span>
        )}
      </button>
      {open && (
        <FigPopover
          anchor={anchor}
          width={262}
          align="left"
          variant="dark"
          maxHeight={440}
          onClose={() => setOpen(false)}
        >
          <ul
            role="listbox"
            aria-label="Frame dimension presets"
            style={{ margin: 0, padding: 0, listStyle: 'none', overflowX: 'hidden' }}
          >
            {FRAME_PRESETS.map((preset) => (
              <li key={preset.name}>
                <button
                  type="button"
                  className="fig-menu-item"
                  data-divider={preset.divider ? 'true' : undefined}
                  style={preset.divider ? { marginTop: 5 } : undefined}
                  onClick={() => {
                    setOpen(false);
                    store.update(node.id, {
                      w: preset.w,
                      h: preset.h,
                      wMode: 'fixed',
                      hMode: 'fixed',
                    });
                  }}
                >
                  <span className="fig-menu-mark">
                    {node.w === preset.w && node.h === preset.h ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {preset.name}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.45)', flex: 'none' }}>
                    {preset.w} × {preset.h}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </FigPopover>
      )}
    </span>
  );
}


/**
 * Figma keeps the boolean operations in the panel header, not only on a
 * shortcut: the button applies Union and its caret offers the other three, and
 * on a boolean group it changes the operation rather than nesting a new one.
 */
function BooleanMenu({ selection, node }: { selection: string[]; node: SceneNode }) {
  const store = useStore();
  const select = useUI((s) => s.select);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isBoolean = node.type === 'boolean';
  // Figma offers the operations on anything with an outline to combine, one
  // layer included — a boolean group of one is a legal, and editable, result.
  // Text is the exception: it has no path until it is outlined.
  if (node.type === 'text' || node.type === 'page') return null;

  const apply = (op: BooleanOp) => {
    setOpen(false);
    if (isBoolean && selection.length === 1) {
      store.setBooleanOp(node.id, op);
      return;
    }
    const combined = store.booleanGroup(selection, op);
    if (combined) select([combined]);
  };

  return (
    <>
      <FigButton
        title={isBoolean ? 'Boolean operation' : 'Union selection  ⌥⌘U'}
        onClick={() => apply(isBoolean ? (node.op ?? 'union') : 'union')}
      >
        <FigIcon name="Union" />
      </FigButton>
      <span ref={setAnchor} style={{ display: 'inline-flex' }}>
        <FigButton title="Boolean operations" on={open} onClick={() => setOpen((v) => !v)}>
          <FigIcon name="Boolean operations" />
        </FigButton>
      </span>
      {open && (
        <FigPopover anchor={anchor} width={210} variant="dark" onClose={() => setOpen(false)}>
          <ul role="listbox" aria-label="Boolean operations" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {BOOLEAN_OPS.map((op) => (
              <li key={op.value}>
                <button type="button" className="fig-menu-item" onClick={() => apply(op.value)}>
                  <span className="fig-menu-mark">{isBoolean && node.op === op.value ? '✓' : ''}</span>
                  <span style={{ flex: 1 }}>{op.label}</span>
                  <span style={{ color: 'rgba(255,255,255,0.45)' }}>{op.shortcut}</span>
                </button>
              </li>
            ))}
            {/* Figma keeps Flatten at the foot of this menu: it is the same
                gesture, applied once and for all rather than kept live. */}
            <li>
              <button
                type="button"
                className="fig-menu-item"
                onClick={() => {
                  setOpen(false);
                  const flattened = store.flatten(selection);
                  if (flattened) select([flattened]);
                }}
              >
                <span className="fig-menu-mark" />
                <span style={{ flex: 1 }}>Flatten</span>
                <span style={{ color: 'rgba(255,255,255,0.45)' }}>⌘E</span>
              </button>
            </li>
          </ul>
        </FigPopover>
      )}
    </>
  );
}

const BOOLEAN_OPS: { value: BooleanOp; label: string; shortcut: string }[] = [
  { value: 'union', label: 'Union', shortcut: '⌥⌘U' },
  { value: 'subtract', label: 'Subtract', shortcut: '⌥⌘S' },
  { value: 'intersect', label: 'Intersect', shortcut: '⌥⌘I' },
  { value: 'exclude', label: 'Exclude', shortcut: '⌥⌘E' },
];


function LayerHeader({ node }: { node: SceneNode }) {
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const page = useUI((s) => s.page);
  const setVectorEdit = useUI((s) => s.setVectorEdit);
  const setContextMenu = useUI((s) => s.setContextMenu);
  const many = selection.length > 1;

  return (
    <div className="fig-section" style={{ paddingBottom: 8 }}>
      <div className="fig-row" style={{ marginTop: 8 }}>
        {!many && <TypeMenu node={node} />}
        {/* the layer name lives in the layers panel — the header keeps only
            the actions, so the spacer holds them at the right edge */}
        <div style={{ flex: 1, minWidth: 0 }} />
        {node.instanceOf ? (
          <FigButton
            title="Detach instance"
            onClick={() => store.detachInstance(node.id)}
            style={{ color: '#9747FF' }}
          >
            <Icon.Component />
          </FigButton>
        ) : (
          <FigButton
            title={node.isComponent ? 'Already a component' : 'Create component'}
            disabled={node.isComponent}
            onClick={() => store.createComponent(node.id)}
            style={node.isComponent ? { color: '#9747FF' } : undefined}
          >
            <Icon.Component solid={node.isComponent} />
          </FigButton>
        )}
        {node.type === 'text' && <LinkButton node={node} />}
        {canEditPoints(node.type) && (
          <FigButton
            title="Edit object  ⏎"
            onClick={() => setVectorEdit(node.id)}
          >
            <FigIcon name="Edit object" />
          </FigButton>
        )}
        <FigButton
          title="Select matching layers  ⌥⌘A"
          onClick={() => {
            const matches = store.selectMatching(node.id, page);
            if (matches.length) select(matches);
          }}
        >
          <FigIcon name="Select matching layers" />
        </FigButton>
        <BooleanMenu selection={selection} node={node} />
        <FigButton
          title="More actions"
          onClick={() => {
            const rect = document.querySelector('.fig')?.getBoundingClientRect();
            setContextMenu({ x: (rect?.left ?? 0) - 160, y: 120, stack: selection });
          }}
        >
          <Icon.Dots />
        </FigButton>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

/** Shown when the selection is a main component or an instance of one. */
function ComponentSection({ node }: { node: SceneNode }) {
  const store = useStore();
  const doc = useDoc();
  const select = useUI((s) => s.select);
  if (!node.isComponent && !node.instanceOf) return null;

  const main = node.instanceOf ? doc[node.instanceOf] : null;
  // every main in the document is a swap target, which is what makes the
  // control a swap rather than a link back to this one
  const mains = Object.values(doc).filter((entry) => entry.isComponent);
  const instances = node.isComponent
    ? Object.values(doc).filter((n) => n.instanceOf === node.id).length
    : 0;

  return (
    <div className="fig-section">
      <div className="fig-head" style={{ color: '#9747FF' }}>
        <span>{node.isComponent ? 'Main component' : 'Instance'}</span>
      </div>

      {node.isComponent ? (
        <>
          <div style={{ color: 'var(--fig-dim)', paddingBottom: 4 }}>
            {instances === 0
              ? 'No instances yet — changes here will flow to any you place.'
              : `${instances} instance${instances === 1 ? '' : 's'} follow this component.`}
          </div>
          <div className="fig-row">
            <FigButton
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                const id = store.createInstance(node.id, node.parent ?? ROOT_ID);
                if (id) select([id]);
              }}
            >
              Place instance
            </FigButton>
          </div>
          <ComponentDocs node={node} editable />
        </>
      ) : (
        <>
          <FigLabel>Follows</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            {mains.length > 1 ? (
              <FigSelect
                value={node.instanceOf ?? ''}
                options={mains.map((entry) => ({ value: entry.id, label: entry.name }))}
                glyph={<Icon.Component solid />}
                title="Swap instance"
                onChange={(mainId) => {
                  const next = store.swapInstance(node.id, mainId);
                  if (next) select([next]);
                }}
              />
            ) : (
              <FigButton
                style={{ flex: 1, justifyContent: 'flex-start', color: '#9747FF' }}
                onClick={() => main && select([main.id])}
              >
                {main ? main.name : 'main component missing'}
              </FigButton>
            )}
          </div>
          {main && <ComponentDocs node={main} />}
          <div className="fig-row">
            <FigButton style={{ flex: 1, justifyContent: 'center' }} onClick={() => store.resetInstance(node.id)}>
              Reset overrides
            </FigButton>
            <FigButton style={{ flex: 1, justifyContent: 'center' }} onClick={() => store.detachInstance(node.id)}>
              Detach
            </FigButton>
          </div>
        </>
      )}
    </div>
  );
}

// ── Nothing selected ─────────────────────────────────────────────────────

/**
 * The panel with nothing selected — which is to say, the page's own panel.
 *
 * Figma shows three things here: the page background, the styles the document
 * carries, and the page's export settings. The background is a full paint row
 * rather than a swatch because it has the same three controls every other paint
 * has — a colour, an opacity and an eye.
 */
function PageSection() {
  const doc = useDoc();
  const store = useStore();
  const pageId = useUI((s) => s.page);
  const setExportOpen = useUI((s) => s.setExportOpen);
  const page = doc[pageId] ?? doc[ROOT_ID];
  if (!page) return null;

  const set = (patch: Partial<SceneNode>) => store.update(page.id, patch);

  return (
    <>
      <FigSection title="Page">
        <FigPaintRow
          color={page.fill ?? '#EEEEEE'}
          alpha={page.fillOpacity ?? 1}
          visible={page.fillVisible !== false}
          onColor={(fill) => set({ fill })}
          onAlpha={(fillOpacity) => set({ fillOpacity })}
          onVisible={() => set({ fillVisible: page.fillVisible === false })}
        />
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, cursor: 'default' }}
        >
          <input
            type="checkbox"
            checked={page.exportBackground !== false}
            onChange={(e) => set({ exportBackground: e.target.checked })}
            style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
          />
          <span>Show in exports</span>
        </label>
      </FigSection>

      <PageStylesSection />

      <ExportSection
        node={page}
        nodes={[page]}
        set={set}
        onExport={() => setExportOpen(true)}
      />
    </>
  );
}

/**
 * The document's styles, grouped the way they were named.
 *
 * Figma reads a slash in a style's name as a folder — "Card/Title" and
 * "Card/Body" collapse into one *Card* group — which is the only thing keeping
 * this list readable once a document has thirty of them.
 */
function PageStylesSection() {
  const styles = useStyles();
  const store = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const KINDS: { kind: StyleKind; label: string }[] = [
    { kind: 'text', label: 'Text styles' },
    { kind: 'paint', label: 'Color styles' },
    { kind: 'effect', label: 'Effect styles' },
    { kind: 'grid', label: 'Layout grid styles' },
  ];

  /** "28/34" — the size and line height a text style sets, as Figma lists it. */
  const metrics = (style: Style): string | null => {
    if (style.kind !== 'text') return null;
    const font = style.value as Partial<FontSpec> | null;
    if (!font?.size) return null;
    const height = font.lineHeight;
    const leading = typeof height === 'number' && height <= 4 ? font.size * height : height;
    return leading ? `${Math.round(font.size)}/${Math.round(Number(leading))}` : `${Math.round(font.size)}`;
  };

  const row = (style: Style) => (
    <div key={style.id} className="fig-layer" style={{ paddingLeft: 10 }}>
      <span style={{ display: 'flex', color: 'var(--color-ink-muted)' }}>
        {style.kind === 'text' ? <Icon.FontSize /> : <Icon.Tokens />}
      </span>
      <span className="fig-ellipsis" style={{ flex: 1 }}>
        {style.name.includes('/') ? style.name.slice(style.name.indexOf('/') + 1) : style.name}
      </span>
      {metrics(style) && (
        <span style={{ flex: 'none', color: 'var(--fig-dim)' }}>· {metrics(style)}</span>
      )}
      <button
        type="button"
        className="fig-btn fig-layer-icons"
        style={{ flex: 'none' }}
        title={`Delete ${style.name}`}
        onClick={() => store.removeStyle(style.id)}
      >
        <Icon.Minus />
      </button>
    </div>
  );

  /** A slash makes a folder — "Card/Title" and "Card/Body" collapse into Card. */
  const listing = (entries: Style[]) => {
    const loose: Style[] = [];
    const groups = new Map<string, Style[]>();
    for (const style of entries) {
      const cut = style.name.indexOf('/');
      if (cut <= 0) {
        loose.push(style);
        continue;
      }
      const folder = style.name.slice(0, cut);
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(style);
    }

    return (
      <>
        {loose.map(row)}
        {[...groups].map(([folder, inside]) => (
          <div key={folder}>
            <button
              type="button"
              className="fig-disclosure"
              style={{ height: 24, paddingLeft: 10, fontWeight: 400 }}
              aria-expanded={!!open[folder]}
              onClick={() => setOpen((was) => ({ ...was, [folder]: !was[folder] }))}
            >
              <span className="fig-disclosure-caret" aria-hidden>
                <Icon.Chevron open={!!open[folder]} />
              </span>
              <span>{folder}</span>
            </button>
            {open[folder] && inside.map(row)}
          </div>
        ))}
      </>
    );
  };

  return (
    <FigSection title="Styles" empty={!styles.length}>
      {KINDS.map(({ kind, label }) => {
        const entries = styles.filter((style) => style.kind === kind);
        if (!entries.length) return null;
        return (
          <div key={kind}>
            <div className="fig-label" style={{ paddingLeft: 16 }}>{label}</div>
            {listing(entries)}
          </div>
        );
      })}
    </FigSection>
  );
}

/**
 * What a component is for.
 *
 * Shown on the main, where it is written, and on an instance, where it is
 * needed — the person reaching for a component is usually not the person who
 * made it, and a name alone rarely says which of two similar things to take.
 */
function ComponentDocs({ node, editable = false }: { node: SceneNode; editable?: boolean }) {
  const store = useStore();
  const description = node.description ?? '';
  const docs = node.docs ?? '';
  if (!editable && !description && !docs) return null;

  return (
    <>
      {editable ? (
        <>
          <div className="fig-row" style={{ alignItems: 'flex-start' }}>
            <textarea
              className="fig-annotation"
              defaultValue={description}
              placeholder="What is this component for?"
              onKeyDown={(event) => event.stopPropagation()}
              onBlur={(event) => store.update(node.id, { description: event.target.value.trim() })}
            />
          </div>
          <div className="fig-row">
            <FigText
              value={docs}
              placeholder="Documentation link"
              onChange={(value) => store.update(node.id, { docs: value.trim() })}
            />
          </div>
        </>
      ) : (
        <>
          {description && <div className="fig-note">{description}</div>}
          {docs && (
            <div className="fig-row">
              <a
                href={docs}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--fig-blue)' }}
              >
                Documentation
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * The Prototype tab.
 *
 * Figma splits it in two: what the selected layer does, and where the flows
 * start. With nothing selected you get the page's flows, which is also the list
 * Present plays from.
 */
function PrototypeTab({ node }: { node?: SceneNode }) {
  const doc = useDoc();
  const store = useStore();
  const pageId = useUI((s) => s.page);
  const select = useUI((s) => s.select);
  const present = useUI((s) => s.present);

  const flows = flowsOn(doc, pageId);
  const frames = destinationsOn(doc, pageId);
  const isFrame = node?.type === 'frame' && doc[node.parent ?? '']?.type === 'page';
  const interactions = interactionsOf(node);

  return (
    <div className="scroll" style={{ flex: 1 }}>
      {node ? (
        <>
          {isFrame && (
            <FigSection
              title="Flow starting point"
              empty={!node.flowStart}
              onAdd={() => store.setFlowStart(node.id, nextFlowName(doc, pageId))}
              onRemove={() => store.setFlowStart(node.id, null)}
            >
              <div className="fig-row">
                <FigText
                  value={node.flowStart ?? ''}
                  onChange={(name) => store.setFlowStart(node.id, name.trim() || 'Flow 1')}
                />
                <FigButton title="Play this flow" onClick={() => present(node.id)}>
                  <Icon.Play />
                </FigButton>
              </div>
            </FigSection>
          )}

          <FigSection
            title="Interactions"
            empty={interactions.length === 0}
            onAdd={() => store.addInteraction(node.id)}
          >
            {interactions.map((interaction) => (
              <InteractionRow
                key={interaction.id}
                node={node}
                interaction={interaction}
                frames={frames}
              />
            ))}
          </FigSection>

          <ScrollSection node={node} />
        </>
      ) : null}

      <FigSection title="Flows" empty={flows.length === 0}>
        {flows.map((flow) => (
          <div className="fig-row" key={flow.id}>
            <FigButton
              style={{ flex: 1, justifyContent: 'flex-start' }}
              title="Select the starting frame"
              onClick={() => select([flow.id])}
            >
              {flow.name}
            </FigButton>
            <FigButton title={`Play ${flow.name}`} onClick={() => present(flow.id)}>
              <Icon.Play />
            </FigButton>
          </div>
        ))}
      </FigSection>

      <PrototypeSettings pageId={pageId} />

      {!node && flows.length === 0 && (
        <div style={{ padding: '4px 16px 12px', color: 'var(--fig-dim)', lineHeight: 1.5 }}>
          Select a layer to give it an interaction, or drag the blue handle on a
          selected layer onto the frame it should open.
        </div>
      )}
    </div>
  );
}

/**
 * Figma's Prototype settings: the device the prototype is meant to be seen on,
 * and the colour behind it. They belong to the page rather than to the person
 * playing it, so everyone opening the file plays back the same thing.
 */
function PrototypeSettings({ pageId }: { pageId: string }) {
  const doc = useDoc();
  const store = useStore();
  const page = doc[pageId];
  if (!page) return null;

  const device = page.prototypeDevice ?? 'none';
  const background = page.prototypeBackground ?? '#0E0E0E';

  return (
    <FigSection title="Prototype settings">
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={device}
          options={DEVICES.map((entry) => ({ value: entry.id, label: entry.label }))}
          title="The device the prototype plays inside"
          onChange={(prototypeDevice) =>
            store.update(pageId, { prototypeDevice: prototypeDevice as PrototypeDevice })
          }
        />
      </div>
      <FigPaintRow
        color={background}
        alpha={1}
        onColor={(prototypeBackground) => store.update(pageId, { prototypeBackground })}
      />
    </FigSection>
  );
}

/**
 * How a layer behaves while the prototype is playing.
 *
 * A frame says whether it scrolls; a layer inside one says whether it goes with
 * the content or stays put. Neither has any effect on the canvas — a board on
 * the canvas is flat however tall its content is, exactly as in Figma.
 */
function ScrollSection({ node }: { node: SceneNode }) {
  const store = useStore();
  const doc = useDoc();
  const parent = node.parent ? doc[node.parent] : null;
  const container = node.type === 'frame' || node.type === 'section';
  const inFrame = !!parent && parent.type === 'frame';
  if (!container && !inFrame) return null;

  return (
    <FigSection title="Scroll behavior">
      {container && (
        <>
          <FigLabel>Overflow</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={node.scroll ?? 'none'}
              options={[
                { value: 'none', label: 'No scrolling' },
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical', label: 'Vertical' },
                { value: 'both', label: 'Both directions' },
              ]}
              title="Overflow"
              onChange={(scroll) => store.update(node.id, { scroll })}
            />
          </div>
        </>
      )}
      {inFrame && (
        <>
          <FigLabel>Position</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={node.scrollBehavior ?? 'scrolls'}
              options={[
                { value: 'scrolls', label: 'Scroll with parent' },
                { value: 'fixed', label: 'Fixed (stay in place)' },
                { value: 'sticky', label: 'Sticky (stop at top edge)' },
              ]}
              title="Position"
              onChange={(scrollBehavior) => store.update(node.id, { scrollBehavior })}
            />
          </div>
        </>
      )}
    </FigSection>
  );
}

/**
 * Figma's trigger menu, in Figma's order and grouping.
 *
 * Three of the labels depend on the prototype device: a touch screen taps
 * rather than clicks, and has no mouse to press.
 */
function triggerOptions(touch: boolean): FigOption<Trigger>[] {
  const label = (trigger: Trigger) => triggerLabel(trigger, touch);
  return [
    { value: 'none', label: label('none') },
    { value: 'click', label: label('click'), divider: true },
    { value: 'drag', label: label('drag') },
    { value: 'hover', label: label('hover') },
    { value: 'press', label: label('press') },
    { value: 'key', label: label('key') },
    { value: 'mouse-enter', label: label('mouse-enter'), divider: true },
    { value: 'mouse-leave', label: label('mouse-leave') },
    { value: 'mouse-down', label: label('mouse-down') },
    { value: 'mouse-up', label: label('mouse-up') },
    { value: 'delay', label: label('delay'), divider: true },
  ];
}

/** Figma's action menu, in Figma's order and grouping. */
/**
 * Figma's "Set variable mode": put a collection into one of its modes while the
 * prototype plays. It is how a theme switch is prototyped without duplicating a
 * single frame — the same collections the Theme tab defines.
 */
function ModeAction({
  interaction,
  set,
}: {
  interaction: Interaction;
  set: (patch: Partial<Interaction>) => void;
}) {
  const collections = useCollections();
  const chosen = collections.find((entry) => entry.id === interaction.collection);

  return (
    <>
      <FigLabel>Collection</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={interaction.collection ?? ''}
          options={[
            { value: '', label: 'Pick a collection' },
            ...collections.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
          title="Collection"
          onChange={(collection) => set({ collection: collection || undefined, mode: undefined })}
        />
      </div>
      {chosen && (
        <>
          <FigLabel>Mode</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.mode ?? chosen.defaultMode}
              options={chosen.modes.map((mode) => ({ value: mode.id, label: mode.name }))}
              title="Mode"
              onChange={(mode) => set({ mode })}
            />
          </div>
        </>
      )}
      <div className="fig-note">
        Held for the run, like a variable: the document keeps the mode you
        designed in.
      </div>
    </>
  );
}

const ACTIONS: FigOption<InteractionAction>[] = [
  { value: 'none', label: 'None' },
  { value: 'navigate', label: 'Navigate to' },
  { value: 'change-to', label: 'Change to' },
  { value: 'back', label: 'Back' },
  { value: 'scroll-to', label: 'Scroll to' },
  { value: 'url', label: 'Open link' },
  { value: 'set-variable', label: 'Set variable', divider: true },
  { value: 'set-mode', label: 'Set variable mode' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'open-overlay', label: 'Open overlay', divider: true },
  { value: 'swap-overlay', label: 'Swap overlay' },
  { value: 'close-overlay', label: 'Close overlay' },
  { value: 'play-pause', label: 'Play/Pause animation', divider: true },
  { value: 'set-playhead', label: 'Set playhead' },
];

const TRANSITIONS: FigOption<TransitionType>[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'smart-animate', label: 'Smart animate' },
  { value: 'move', label: 'Move in', divider: true },
  { value: 'move-out', label: 'Move out' },
  { value: 'push', label: 'Push' },
  { value: 'slide', label: 'Slide in' },
  { value: 'slide-out', label: 'Slide out' },
];

const OVERLAY_POSITIONS: FigOption<NonNullable<Interaction['overlay']>['position']>[] = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top center' },
  { value: 'bottom', label: 'Bottom center' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const DIRECTIONS: FigOption<TransitionDirection>[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

/**
 * The four control points of a custom bezier.
 *
 * Figma draws a curve you can drag the handles of; the numbers underneath are
 * the same four, and they are what the easing actually is.
 */
function CustomBezier({
  transition,
  set,
}: {
  transition: TransitionSpec;
  set: (patch: Partial<Interaction>) => void;
}) {
  const points = transition.bezier ?? DEFAULT_BEZIER;
  const at = (index: number, value: number) => {
    const next = [...points] as [number, number, number, number];
    next[index] = value;
    set({ transition: { ...transition, bezier: next } });
  };
  const labels = ['X1', 'Y1', 'X2', 'Y2'];

  return (
    <>
      <div className="fig-cols">
        <FigLabel>{labels[0]}</FigLabel>
        <FigLabel>{labels[1]}</FigLabel>
      </div>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigField value={points[0]} step={0.01} title={labels[0]} onChange={(v) => at(0, v)} />
        <FigField value={points[1]} step={0.01} title={labels[1]} onChange={(v) => at(1, v)} />
      </div>
      <div className="fig-cols">
        <FigLabel>{labels[2]}</FigLabel>
        <FigLabel>{labels[3]}</FigLabel>
      </div>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigField value={points[2]} step={0.01} title={labels[2]} onChange={(v) => at(2, v)} />
        <FigField value={points[3]} step={0.01} title={labels[3]} onChange={(v) => at(3, v)} />
      </div>
      <BezierPreview easing={easingCss(transition)} />
    </>
  );
}

/** Stiffness, damping and mass — the three numbers a spring is made of. */
function CustomSpring({
  transition,
  set,
}: {
  transition: TransitionSpec;
  set: (patch: Partial<Interaction>) => void;
}) {
  const spring = transition.spring ?? DEFAULT_SPRING;
  const at = (key: keyof typeof spring, value: number) =>
    set({ transition: { ...transition, spring: { ...spring, [key]: value } } });

  return (
    <>
      <div className="fig-cols">
        <FigLabel>Stiffness</FigLabel>
        <FigLabel>Damping</FigLabel>
      </div>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigField
          value={spring.stiffness}
          min={1}
          max={1000}
          step={10}
          title="Stiffness"
          onChange={(v) => at('stiffness', v)}
        />
        <FigField
          value={spring.damping}
          min={1}
          max={100}
          step={1}
          title="Damping"
          onChange={(v) => at('damping', v)}
        />
      </div>
      <FigLabel>Mass</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigField
          value={spring.mass}
          min={0.1}
          max={20}
          step={0.1}
          title="Mass"
          onChange={(v) => at('mass', v)}
        />
      </div>
      <BezierPreview easing={easingCss(transition)} />
    </>
  );
}

/**
 * A dot that runs the easing on a loop, the way Figma previews one.
 *
 * The curve is whatever CSS the easing resolves to, so a spring's overshoot
 * shows up here exactly as it will when the prototype plays.
 */
function BezierPreview({ easing }: { easing: string }) {
  return (
    <div className="fig-easing-preview" title="Preview">
      <span style={{ animationTimingFunction: easing }} />
    </div>
  );
}

/** Figma's easing menu: a straight line, then the curves, then the springs. */
const EASINGS: FigOption<Easing>[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in', divider: true },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in and out' },
  { value: 'ease-in-back', label: 'Ease in back' },
  { value: 'ease-out-back', label: 'Ease out back' },
  { value: 'ease-in-out-back', label: 'Ease in and out back' },
  { value: 'custom-bezier', label: 'Custom bezier' },
  { value: 'gentle', label: 'Gentle', divider: true },
  { value: 'quick', label: 'Quick' },
  { value: 'bouncy', label: 'Bouncy' },
  { value: 'slow', label: 'Slow' },
  { value: 'custom-spring', label: 'Custom spring' },
];

/**
 * Everything an action needs said about it, below the trigger.
 *
 * The same editor serves a top-level interaction and each action inside a
 * conditional branch, so a branch can do anything an interaction can.
 */
function ActionBody({
  interaction,
  set,
  frames,
  variants,
  scrollTargets,
  videoTargets,
  variables,
  nested,
}: {
  interaction: Interaction;
  set: (patch: Partial<Interaction>) => void;
  frames: SceneNode[];
  variants: SceneNode[];
  scrollTargets: SceneNode[];
  videoTargets: SceneNode[];
  variables: Token[];
  /** true inside a conditional branch, where nesting another one is not offered */
  nested?: boolean;
}) {
  const overlay = interaction.overlay ?? DEFAULT_OVERLAY;

  return (
    <>
      <FigLabel>Action</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={interaction.action}
          options={ACTIONS.filter((option) => nested !== true || option.value !== 'conditional').map(
            (option) =>
              option.value === 'change-to' && !variants.length
                ? { ...option, disabled: true }
                : option,
          )}
          title="Action"
          onChange={(action) => set({ action })}
        />
      </div>

      {needsDestination(interaction.action) && (
        <>
          <FigLabel>{interaction.action === 'scroll-to' ? 'Layer' : 'Destination'}</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.destination ?? ''}
              options={[
                {
                  value: '',
                  label:
                    interaction.action === 'scroll-to'
                      ? 'Pick a layer'
                      : interaction.action === 'change-to'
                        ? 'Pick a variant'
                        : 'Pick a frame',
                },
                ...(interaction.action === 'scroll-to'
                  ? scrollTargets
                  : interaction.action === 'change-to'
                    ? variants
                    : frames
                ).map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                })),
              ]}
              title={interaction.action === 'scroll-to' ? 'Layer' : 'Destination'}
              onChange={(destination) => set({ destination: destination || null })}
            />
          </div>
        </>
      )}

      {interaction.action === 'open-overlay' && (
        <>
          <FigLabel>Position</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={overlay.position}
              options={OVERLAY_POSITIONS}
              onChange={(position) => set({ overlay: { ...overlay, position } })}
            />
          </div>
          <div className="fig-row">
            <FigGroup
              value={overlay.background ? 'dim' : 'none'}
              onChange={(value) => set({ overlay: { ...overlay, background: value === 'dim' } })}
              options={[
                { value: 'none', label: 'Clear', title: 'No background behind the overlay' },
                { value: 'dim', label: 'Dim', title: 'Dim what is behind the overlay' },
              ]}
            />
            <FigGroup
              value={overlay.closeOnOutside ? 'outside' : 'stay'}
              onChange={(value) =>
                set({ overlay: { ...overlay, closeOnOutside: value === 'outside' } })
              }
              options={[
                { value: 'outside', label: 'Click out', title: 'A click outside closes it' },
                { value: 'stay', label: 'Stay', title: 'Only an action closes it' },
              ]}
            />
          </div>
        </>
      )}

      {interaction.action === 'url' && (
        <div className="fig-row">
          <FigText
            value={interaction.url ?? ''}
            placeholder="https://"
            onChange={(url) => set({ url })}
          />
        </div>
      )}

      {interaction.action === 'set-variable' && (
        <>
          <FigLabel>Variable</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.variable ?? ''}
              options={[
                { value: '', label: 'Pick a variable' },
                ...variables.map((token) => ({ value: token.id, label: token.name })),
              ]}
              onChange={(variable) => set({ variable: variable || undefined })}
            />
          </div>
          <div className="fig-row">
            <FigText
              value={interaction.value ?? ''}
              placeholder="the value to set"
              onChange={(value) => set({ value })}
            />
          </div>
          <div className="fig-note">
            Set while the prototype is playing; the document keeps the value you
            designed with.
          </div>
        </>
      )}

      {interaction.action === 'set-mode' && <ModeAction interaction={interaction} set={set} />}

      {(interaction.action === 'play-pause' || interaction.action === 'set-playhead') && (
        <>
          <FigLabel>Animation</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.animation ?? ''}
              options={[
                { value: '', label: 'Pick a video' },
                ...videoTargets.map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
              title="Animation"
              onChange={(animation) => set({ animation: animation || undefined })}
            />
          </div>
          {interaction.action === 'play-pause' ? (
            <>
              <FigLabel>Behavior</FigLabel>
              <div className="fig-row" style={{ marginTop: 0 }}>
                <FigSelect
                  value={interaction.behavior ?? 'toggle'}
                  options={BEHAVIORS}
                  title="Behavior"
                  onChange={(behavior) => set({ behavior })}
                />
              </div>
            </>
          ) : (
            <>
              <FigLabel>Timestamp</FigLabel>
              <div className="fig-row" style={{ marginTop: 0 }}>
                <FigField
                  value={interaction.timestamp ?? 0}
                  min={0}
                  step={0.1}
                  suffix="s"
                  title="Timestamp"
                  onChange={(timestamp) => set({ timestamp })}
                />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

const BEHAVIORS: FigOption<NonNullable<Interaction['behavior']>>[] = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'play', label: 'Play only' },
  { value: 'pause', label: 'Pause only' },
];

/**
 * The branches of a conditional: Figma's `if` / `else if` / `else` list.
 *
 * The last branch carries no condition — that is what makes it the `else` — and
 * every branch holds a list of actions, so one condition can do several things.
 */
function Branches({
  interaction,
  set,
  node,
  frames,
}: {
  interaction: Interaction;
  set: (patch: Partial<Interaction>) => void;
  node: SceneNode;
  frames: SceneNode[];
}) {
  const doc = useDoc();
  const variables = useTokens();
  const branches = interaction.branches ?? [];

  const write = (next: ConditionBranch[]) => set({ branches: next });
  const patch = (index: number, change: Partial<ConditionBranch>) =>
    write(branches.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));

  const scrollTargets = (() => {
    const frame = frameOf(node.id, doc);
    if (!frame) return [];
    return descendants(frame, doc)
      .map((entry) => doc[entry])
      .filter((entry): entry is SceneNode => !!entry && entry.id !== node.id);
  })();
  const videoTargets = scrollTargets.filter((entry) => entry.video?.src);

  return (
    <div className="fig-branches">
      {branches.map((branch, index) => {
        const isElse = branch.condition === undefined;
        const error = branch.condition ? conditionError(branch.condition) : null;

        return (
          <div key={branch.id} className="fig-branch">
            <div className="fig-row" style={{ alignItems: 'center' }}>
              <span className="fig-branch-word">
                {isElse ? 'else' : index === 0 ? 'if' : 'else if'}
              </span>
              {!isElse && (
                <FigText
                  value={branch.condition ?? ''}
                  placeholder="Write condition"
                  title={index === 0 ? 'Condition' : `Condition ${index + 1}`}
                  onChange={(condition) => patch(index, { condition })}
                />
              )}
              <FigButton
                title="Remove branch"
                onClick={() => write(branches.filter((_, i) => i !== index))}
              >
                <Icon.Minus />
              </FigButton>
            </div>

            {!isElse && error && <div className="fig-note fig-bad">{error}</div>}

            {branch.actions.map((step, stepIndex) => (
              <div key={step.id} className="fig-branch-action">
                <ActionBody
                  interaction={step}
                  nested
                  frames={frames}
                  variants={[]}
                  scrollTargets={scrollTargets}
                  videoTargets={videoTargets}
                  variables={variables}
                  set={(change) =>
                    patch(index, {
                      actions: branch.actions.map((entry, i) =>
                        i === stepIndex ? { ...entry, ...change } : entry,
                      ),
                    })
                  }
                />
                <FigButton
                  title="Remove action"
                  onClick={() =>
                    patch(index, {
                      actions: branch.actions.filter((_, i) => i !== stepIndex),
                    })
                  }
                >
                  <Icon.Minus />
                </FigButton>
              </div>
            ))}

            <button
              type="button"
              className="fig-btn"
              data-text="true"
              onClick={() =>
                patch(index, { actions: [...branch.actions, newInteraction({ trigger: 'none' })] })
              }
            >
              Add action
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="fig-btn"
        data-text="true"
        onClick={() => {
          // a new condition goes above the else, so the else stays last
          const next = [...branches];
          const at = next.length && next[next.length - 1].condition === undefined
            ? next.length - 1
            : next.length;
          next.splice(at, 0, { id: newId(), condition: '', actions: [] });
          write(next);
        }}
      >
        Add condition
      </button>
      {!branches.some((entry) => entry.condition === undefined) && (
        <button
          type="button"
          className="fig-btn"
          data-text="true"
          onClick={() => write([...branches, { id: newId(), actions: [] }])}
        >
          Add else
        </button>
      )}
    </div>
  );
}

/**
 * Figma's Interactions list: one summary line per interaction.
 *
 * The line says what fires it and where it goes; clicking it opens the editor
 * in a dialog beside the panel. Keeping the panel to one line each is the point
 * — a layer with four interactions would otherwise push everything below it off
 * the bottom of the screen.
 */
function InteractionRow({
  node,
  interaction,
  frames,
}: {
  node: SceneNode;
  interaction: Interaction;
  frames: SceneNode[];
}) {
  const store = useStore();
  const doc = useDoc();
  const pageId = useUI((state) => state.page);
  const touch = isTouch(doc[pageId]?.prototypeDevice);
  const [row, setRow] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const destination = interaction.destination ? doc[interaction.destination]?.name : null;
  // the third column is where it goes, falling back to what it does when the
  // action has nowhere to go — Figma shows "None" on a fresh interaction
  const target = needsDestination(interaction.action)
    ? (destination ?? 'None')
    : interaction.action === 'url'
      ? interaction.url || 'None'
      : ACTION_LABEL[interaction.action];

  return (
    <>
      <div className="fig-row fig-interaction-row">
        <button
          ref={setRow}
          type="button"
          className="fig-interaction-summary"
          title={describe(interaction, doc)}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="fig-interaction-trigger">{shortTrigger(interaction.trigger, touch)}</span>
          <span className="fig-interaction-icon" aria-hidden>
            {ACTION_ICON[interaction.action]}
          </span>
          <span className="fig-interaction-target">{target}</span>
        </button>
        <FigButton
          title="Remove interaction"
          onClick={() => store.removeInteraction(node.id, interaction.id)}
        >
          <Icon.Minus />
        </FigButton>
      </div>
      {open && (
        <FigPopover
          anchor={row}
          width={232}
          variant="card"
          placement="beside"
          maxHeight={620}
          onClose={() => setOpen(false)}
        >
          <div className="fig-card">
            <header className="fig-card-head">
              <span className="fig-card-title">Interaction</span>
              <FigButton
                title="Add another interaction"
                onClick={() => store.addInteraction(node.id)}
              >
                <Icon.Plus />
              </FigButton>
              <FigButton title="Close" onClick={() => setOpen(false)}>
                <Icon.Close />
              </FigButton>
            </header>
            <InteractionEditor node={node} interaction={interaction} frames={frames} />
          </div>
        </FigPopover>
      )}
    </>
  );
}

/** The closest glyph we have for each action, for the summary line. */
const ACTION_ICON: Record<InteractionAction, React.ReactNode> = {
  none: <Icon.Close />,
  navigate: <Icon.ArrowRight />,
  'change-to': <Icon.Component />,
  back: <Icon.Reset />,
  'scroll-to': <Icon.Anchor />,
  url: <Icon.Link />,
  'set-variable': <Icon.Variable />,
  'set-mode': <Icon.Tokens />,
  conditional: <Icon.GridFlow />,
  'open-overlay': <Icon.Frame />,
  'swap-overlay': <Icon.Frame />,
  'close-overlay': <Icon.Frame />,
  'play-pause': <Icon.Play />,
  'set-playhead': <Icon.Ruler />,
};

function InteractionEditor({
  node,
  interaction,
  frames,
}: {
  node: SceneNode;
  interaction: Interaction;
  frames: SceneNode[];
}) {
  const store = useStore();
  const doc = useDoc();
  const variables = useTokens();
  const pageId = useUI((state) => state.page);
  const touch = isTouch(doc[pageId]?.prototypeDevice);
  // Scroll-to points at a layer rather than a frame, so it offers the layers of
  // the artboard this interaction lives on.
  /**
   * "Change to" swaps an instance for a sibling variant, so the choices are the
   * other variants of the set this layer belongs to — anything else would be a
   * swap the component system cannot honour.
   */
  const variants = (() => {
    const main = node.instanceOf ? doc[node.instanceOf] : node.isComponent ? node : null;
    const set = main?.parent ? doc[main.parent] : null;
    if (!set?.isComponentSet) return [];
    return set.children
      .map((id) => doc[id])
      .filter((entry): entry is SceneNode => !!entry && entry.id !== main?.id);
  })();

  const scrollTargets = (() => {
    const frame = frameOf(node.id, doc);
    if (!frame) return [];
    return descendants(frame, doc)
      .map((id) => doc[id])
      .filter((entry): entry is SceneNode => !!entry && entry.id !== node.id);
  })();
  // "Play/Pause animation" and "Set playhead" act on a video, so those are the
  // only layers worth offering
  const videoTargets = scrollTargets.filter((entry) => entry.video?.src);
  const set = (patch: Partial<Interaction>) =>
    store.updateInteraction(node.id, interaction.id, patch);
  const moves =
    interaction.transition.type !== 'instant' &&
    interaction.transition.type !== 'dissolve' &&
    interaction.transition.type !== 'smart-animate';
  return (
    <div className="fig-interaction">
      <FigLabel>Trigger</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={interaction.trigger}
          options={triggerOptions(touch)}
          title="Trigger"
          onChange={(trigger) => set({ trigger })}
        />
        <FigButton
          title="Remove interaction"
          onClick={() => store.removeInteraction(node.id, interaction.id)}
        >
          <Icon.Minus />
        </FigButton>
      </div>

      {interaction.trigger === 'key' && (
        <>
          <FigLabel>Key</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigText
              value={interaction.key ?? ''}
              placeholder="Press a key…"
              onChange={(key) => set({ key })}
            />
          </div>
        </>
      )}

      {interaction.trigger === 'delay' && (
        <>
          <FigLabel>Delay</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigField
              value={interaction.delay}
              min={0}
              max={60_000}
              step={100}
              suffix="ms"
              title="Delay"
              onChange={(delay) => set({ delay })}
            />
          </div>
        </>
      )}

      <ActionBody
        interaction={interaction}
        set={set}
        frames={frames}
        variants={variants}
        scrollTargets={scrollTargets}
        videoTargets={videoTargets}
        variables={variables}
      />

      {interaction.action === 'conditional' && (
        <Branches interaction={interaction} set={set} node={node} frames={frames} />
      )}


      {interaction.action !== 'none' && (
        <>
          <FigLabel>Animation</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.transition.type}
              options={TRANSITIONS}
              onChange={(type) => set({ transition: { ...interaction.transition, type } })}
            />
          </div>
          {moves && (
            <div className="fig-row">
              <FigSelect
                value={interaction.transition.direction}
                options={DIRECTIONS}
                onChange={(direction) =>
                  set({ transition: { ...interaction.transition, direction } })
                }
              />
            </div>
          )}
          {interaction.transition.type !== 'instant' && (
            <>
            <div className="fig-cols">
              <FigLabel>Easing</FigLabel>
              <FigLabel>Duration</FigLabel>
            </div>
            <div className="fig-row" style={{ marginTop: 0 }}>
              <FigSelect
                value={interaction.transition.easing}
                options={EASINGS}
                title="Easing"
                onChange={(easing) => set({ transition: { ...interaction.transition, easing } })}
              />
              <FigField
                value={interaction.transition.duration}
                min={0}
                max={10_000}
                step={50}
                suffix="ms"
                title="Duration"
                onChange={(duration) => set({ transition: { ...interaction.transition, duration } })}
              />
            </div>
            </>
          )}
          {interaction.transition.easing === 'custom-bezier' && (
            <CustomBezier transition={interaction.transition} set={set} />
          )}
          {interaction.transition.easing === 'custom-spring' && (
            <CustomSpring transition={interaction.transition} set={set} />
          )}
        </>
      )}

      {arrives(interaction.action) && <StateSection interaction={interaction} set={set} />}
    </div>
  );
}

/** Actions that land you somewhere, and so can arrive with a clean slate. */
function arrives(action: Interaction['action']): boolean {
  return action === 'navigate' || action === 'back';
}

/**
 * Figma's "State" disclosure: what a navigation forgets on the way in.
 *
 * All three are remembered by default — that is what makes a prototype feel
 * like an app rather than a slideshow — so the checkboxes say to forget, not to
 * keep.
 */
function StateSection({
  interaction,
  set,
}: {
  interaction: Interaction;
  set: (patch: Partial<Interaction>) => void;
}) {
  const [open, setOpen] = useState(
    !!interaction.resetScroll || !!interaction.resetComponentState || !!interaction.resetVideo,
  );

  return (
    <div className="fig-state">
      <button
        type="button"
        className="fig-btn"
        data-text="true"
        aria-expanded={open}
        style={{ width: '100%', justifyContent: 'flex-start', gap: 4 }}
        onClick={() => setOpen((was) => !was)}
      >
        <span style={{ display: 'inline-flex', width: 10 }}>{open ? '⌄' : '›'}</span>
        State
      </button>
      {open && (
        <div style={{ padding: '2px 0 2px 14px' }}>
          <StateBox
            label="Reset scroll position"
            checked={!!interaction.resetScroll}
            onChange={(resetScroll) => set({ resetScroll })}
          />
          <StateBox
            label="Reset component state"
            checked={!!interaction.resetComponentState}
            onChange={(resetComponentState) => set({ resetComponentState })}
          />
          <StateBox
            label="Reset video state"
            checked={!!interaction.resetVideo}
            onChange={(resetVideo) => set({ resetVideo })}
          />
        </div>
      )}
    </div>
  );
}

function StateBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 24, cursor: 'default' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
      />
      <span>{label}</span>
    </label>
  );
}

// ── Position ─────────────────────────────────────────────────────────────

/**
 * The Vector panel.
 *
 * Figma swaps the whole right-hand panel while you are inside a path: the
 * things you can adjust are the selected *points*, not the layer, so the fields
 * are their coordinates, how their handles are tied together, and how round the
 * corner at each one is. Fill and Stroke stay, because those still belong to
 * the shape you are drawing.
 */
function VectorSection({ node }: { node: SceneNode }) {
  const store = useStore();
  const selected = useUI((s) => s.anchorSelection);
  const paths = editablePaths(node);

  const picked = paths.flatMap((path, sub) =>
    path.anchors
      .map((anchor, index) => ({ anchor, sub, index, running: runningIndex(paths, sub, index) }))
      .filter((entry) => selected.includes(entry.running)),
  );

  /** Every write converts a parametric shape first, then re-fits the box. */
  const write = (next: ReturnType<typeof clonePaths>) => {
    if (node.type !== 'vector') store.outlineShape([node.id]);
    store.setPaths(node.id, next);
    store.commit();
  };

  /** Rewrites just the selected anchors. */
  const edit = (fn: (anchor: Anchor) => Anchor) =>
    write(
      paths.map((path, sub) => ({
        closed: path.closed,
        anchors: path.anchors.map((anchor, index) =>
          selected.includes(runningIndex(paths, sub, index)) ? fn(anchor) : cloneAnchor(anchor),
        ),
      })),
    );

  const box = selectionBounds(paths, selected);
  const same = <T,>(read: (anchor: Anchor) => T): T | 'mixed' => {
    if (!picked.length) return 'mixed';
    const first = read(picked[0].anchor);
    return picked.every((entry) => read(entry.anchor) === first) ? first : 'mixed';
  };

  // the panel shows canvas coordinates, the way Figma does — the anchors
  // themselves are stored relative to the layer's own box
  const x = box ? Math.round((node.x + box.minX) * 100) / 100 : ('mixed' as const);
  const y = box ? Math.round((node.y + box.minY) * 100) / 100 : ('mixed' as const);
  const radius = same((anchor) => anchor.r ?? 0);
  const mirror = same((anchor) => mirrorOf(anchor));
  const stroke = same((anchor) => anchor.width ?? node.border?.width ?? 1);
  const none = !picked.length;

  const EDGES = [
    { edge: 'left', figma: 'Align left', title: 'Align left' },
    { edge: 'hcenter', figma: 'Align horizontal centers', title: 'Align horizontal centers' },
    { edge: 'right', figma: 'Align right', title: 'Align right' },
    { edge: 'top', figma: 'Align top', title: 'Align top' },
    { edge: 'vcenter', figma: 'Align vertical centers', title: 'Align vertical centers' },
    { edge: 'bottom', figma: 'Align bottom', title: 'Align bottom' },
  ] as const;

  const MIRRORS: { mode: HandleMirror; title: string; path: string }[] = [
    { mode: 'none', title: 'No mirroring', path: 'M2 8h5M9 8h5M7 5.5v5' },
    { mode: 'angle', title: 'Mirror angle', path: 'M1.5 11.5C5 11.5 6 4.5 9.5 4.5M2 8h12' },
    { mode: 'full', title: 'Mirror angle and length', path: 'M2 8h12M2 5.5v5M14 5.5v5' },
  ];

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span>Vector</span>
      </div>

      <FigGroupSet legend="Align points">
        <div className="fig-row">
          <div className="fig-seg">
            {EDGES.slice(0, 3).map((entry) => (
              <button
                key={entry.edge}
                type="button"
                title={entry.title}
                aria-label={entry.title}
                disabled={picked.length < 2}
                onClick={() => write(alignAnchors(paths, selected, entry.edge))}
              >
                <FigIcon name={entry.figma} />
              </button>
            ))}
          </div>
          <div className="fig-seg">
            {EDGES.slice(3).map((entry) => (
              <button
                key={entry.edge}
                type="button"
                title={entry.title}
                aria-label={entry.title}
                disabled={picked.length < 2}
                onClick={() => write(alignAnchors(paths, selected, entry.edge))}
              >
                <FigIcon name={entry.figma} />
              </button>
            ))}
          </div>
        </div>
      </FigGroupSet>

      <div className="fig-row">
        <FigField
          value={x}
          glyph="X"
          title="X"
          disabled={none}
          onChange={(next) => {
            if (!box) return;
            const dx = next - (node.x + box.minX);
            edit((anchor) => ({ ...cloneAnchor(anchor), x: anchor.x + dx }));
          }}
        />
        <FigField
          value={y}
          glyph="Y"
          title="Y"
          disabled={none}
          onChange={(next) => {
            if (!box) return;
            const dy = next - (node.y + box.minY);
            edit((anchor) => ({ ...cloneAnchor(anchor), y: anchor.y + dy }));
          }}
        />
      </div>

      <div className="fig-row">
        <div className="fig-seg" style={{ flex: 1 }}>
          {MIRRORS.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              title={entry.title}
              aria-label={entry.title}
              disabled={none}
              data-on={mirror === entry.mode ? 'true' : undefined}
              onClick={() => edit((anchor) => applyMirror(anchor, entry.mode))}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d={entry.path} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="fig-row">
        <FigField
          value={radius}
          min={0}
          glyph={<Icon.Corners />}
          title="Corner radius at this point"
          disabled={none}
          onChange={(next) => edit((anchor) => ({ ...cloneAnchor(anchor), r: next || undefined }))}
        />
        {/* Variable width, as a number rather than a drag — the same value the
            ⇧W tool sets, for when you know what you want it to be. */}
        <FigField
          value={stroke}
          min={0}
          step={0.5}
          glyph={<Icon.StrokeWeight />}
          suffix=""
          title="Stroke width at this point  ⇧W"
          disabled={none}
          onChange={(next) => edit((anchor) => ({ ...cloneAnchor(anchor), width: next }))}
        />
      </div>

      <div className="fig-row">
        <span className="fig-hint" style={{ flex: 1 }}>
          {picked.length
            ? `${picked.length} point${picked.length > 1 ? 's' : ''} selected`
            : 'No points selected'}
        </span>
      </div>
    </div>
  );
}

function PositionSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLSpanElement>(null);

  const EDGES = [
    { edge: 'left', title: 'Align left', figma: 'Align left' },
    { edge: 'hcenter', title: 'Align horizontal centers', figma: 'Align horizontal centers' },
    { edge: 'right', title: 'Align right', figma: 'Align right' },
    { edge: 'top', title: 'Align top', figma: 'Align top' },
    { edge: 'vcenter', title: 'Align vertical centers', figma: 'Align vertical centers' },
    { edge: 'bottom', title: 'Align bottom', figma: 'Align bottom' },
  ] as const;

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span>Position</span>
      </div>

      <FigGroupSet legend="Alignment">
      <div className="fig-row" style={{ position: 'relative' }}>
        <div className="fig-seg">
          {EDGES.slice(0, 3).map((entry) => (
            <button
              key={entry.edge}
              type="button"
              title={entry.title}
              aria-label={entry.title}
              onClick={() => store.align(selection, entry.edge)}
            >
              <FigIcon name={entry.figma} />
            </button>
          ))}
        </div>
        <div className="fig-seg">
          {EDGES.slice(3).map((entry) => (
            <button
              key={entry.edge}
              type="button"
              title={entry.title}
              aria-label={entry.title}
              onClick={() => store.align(selection, entry.edge)}
            >
              <FigIcon name={entry.figma} />
            </button>
          ))}
        </div>
        <span ref={menuAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="More actions" on={menu} onClick={() => setMenu((v) => !v)}>
            <Icon.Dots />
          </FigButton>
        </span>

        {/* through FigPopover, like every other panel menu: the inspector
            scrolls, so an absolutely placed list is clipped at its edge */}
        {menu && (
          <FigPopover anchor={menuAnchor.current} width={210} onClose={() => setMenu(false)}>
            <FigButton
              disabled={selection.length < 2}
              onClick={() => {
                store.tidyUp(selection);
                setMenu(false);
              }}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>Tidy up</span>
              <span style={{ color: 'var(--fig-dim)' }}>⌃⌥T</span>
            </FigButton>
            <div style={{ height: 1, background: 'var(--fig-line)', margin: '4px 6px' }} />
            {(
              [
                ['vertical', 'Distribute vertical spacing', '⌃⌥V'],
                ['horizontal', 'Distribute horizontal spacing', '⌃⌥H'],
              ] as const
            ).map(([axis, label, shortcut]) => (
              <FigButton
                key={axis}
                disabled={selection.length < 3}
                onClick={() => {
                  store.distribute(selection, axis);
                  setMenu(false);
                }}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                <span style={{ color: 'var(--fig-dim)' }}>{shortcut}</span>
              </FigButton>
            ))}
          </FigPopover>
        )}
      </div>
      </FigGroupSet>

      <FigGroupSet legend="Position">
      <div className="fig-row">
        <VarField
          node={node}
          field="x"
          value={shared(nodes, (n) => n.x)}
          glyph="X"
          title="X-position"
          onChange={(x) => set({ x })}
        />
        <VarField
          node={node}
          field="y"
          value={shared(nodes, (n) => n.y)}
          glyph="Y"
          title="Y-position"
          onChange={(y) => set({ y })}
        />
        <span style={{ width: 24, flex: 'none' }} />
      </div>
      </FigGroupSet>

      <FigGroupSet legend="Rotation">
      <div className="fig-row">
        <FigField
          value={shared(nodes, (n) => n.rotation)}
          glyph={<FigIcon name="Rotation" />}
          suffix="°"
          title="Rotation"
          onChange={(rotation) => set({ rotation })}
        />
        <div className="fig-seg">
          <button
            type="button"
            title="Rotate 90° right"
            aria-label="Rotate 90° right"
            onClick={() => set({ rotation: (node.rotation + 90) % 360 })}
          >
            <FigIcon name="Rotate 90˚ right" />
          </button>
          <button
            type="button"
            title="Flip horizontal"
            aria-label="Flip horizontal"
            data-on={node.flipH ? 'true' : undefined}
            onClick={() => set({ flipH: !node.flipH })}
          >
            <FigIcon name="Flip horizontal" />
          </button>
          <button
            type="button"
            title="Flip vertical"
            aria-label="Flip vertical"
            data-on={node.flipV ? 'true' : undefined}
            onClick={() => set({ flipV: !node.flipV })}
          >
            <FigIcon name="Flip vertical" />
          </button>
        </div>
        <span style={{ width: 24, flex: 'none' }} />
      </div>
      </FigGroupSet>
    </div>
  );
}

/**
 * A numeric field that can carry a number variable.
 *
 * Wraps FigField so the variable button in its gutter opens a real menu, and so
 * a bound field shows the variable's name rather than the number it resolved
 * to — which is what tells you the value is the variable's to change.
 */
function VarField({
  node,
  field,
  value,
  ...rest
}: {
  node: SceneNode;
  field: NumericField;
  value: number | 'mixed';
  glyph?: React.ReactNode;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  /** a control at the field's trailing edge — the size field's preset caret */
  trailing?: React.ReactNode;
  onChange: (value: number) => void;
}) {
  const names = useVarNames();
  const [open, setOpen] = useState(false);
  const label = variableLabel(node, field, names);

  return (
    <>
      <FigField
        {...rest}
        value={value}
        placeholder={label ?? undefined}
        disabled={!!label}
        onApplyVariable={() => setOpen((v) => !v)}
      />
      {open && <VariableMenu node={node} field={field} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

const DISTRIBUTION: FigOption<Justify>[] = [
  { value: 'start', label: 'Packed' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'between', label: 'Space between' },
];

const ALIGN_CONTENT: FigOption<AlignContent>[] = [
  { value: 'start', label: 'Packed' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'between', label: 'Space between' },
  { value: 'stretch', label: 'Stretch' },
];

/** Which flow button in the segmented control is lit. */
type Flow = 'none' | 'column' | 'row' | 'wrap' | 'grid';

function flowOf(node: SceneNode): Flow {
  if (!node.flex) return 'none';
  if (node.flex.mode === 'grid') return 'grid';
  if (node.flex.wrap) return 'wrap';
  return node.flex.direction;
}

function LayoutSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const store = useStore();
  const doc = useDoc();
  const zoom = useUI((s) => s.viewport.zoom);

  // only a container can be given a layout of its own
  const sizable = node.type === 'frame' || node.type === 'text';
  // hugging is only meaningful when there is content to hug
  const canHug = node.type === 'text' || node.children.length > 0;
  const parent = node.parent ? doc[node.parent] : null;
  const inAuto = !!parent && !isCanvasRoot(parent) && !!parent.flex;
  // Figma offers "Fill container" only to a child an auto layout actually owns
  const sizeModes = SIZE_MODES.filter(
    (mode) =>
      (mode.value !== 'fit' || canHug) && (mode.value !== 'fill' || (inAuto && !node.absolute)),
  );
  // A rectangle inside an auto layout still gets to say "fill the row" — the
  // resizing row belongs to anything the layout sizes, not just frames.
  const resizable = sizable || inAuto;
  const flow = flowOf(node);

  /**
   * Dropping the layout has to leave the children where they look, and only the
   * browser knows where that is — so the positions are measured on the way out.
   */
  const setFlow = (next: Flow) => {
    if (next === 'none') {
      store.setAutoLayout(node.id, false, { measured: measureChildren(node.id, zoom) });
      return;
    }
    const seed: Partial<FlexSpec> =
      next === 'grid'
        ? { mode: 'grid' }
        : next === 'wrap'
          ? { mode: 'flex', direction: 'row', wrap: true }
          : { mode: 'flex', direction: next, wrap: false };

    if (node.flex) set({ flex: { ...node.flex, ...seed } });
    else store.setAutoLayout(node.id, true, { seed });
  };

  /** The header toggle names no direction, so the flow is inferred instead. */
  const toggleAutoLayout = () => {
    if (node.flex) setFlow('none');
    else store.setAutoLayout(node.id, true);
  };

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span style={{ flex: 1 }}>Layout</span>
        <FigButton
          title="Resize to fit"
          disabled={!canHug}
          onClick={() => store.resizeToFit([node.id])}
        >
          <Icon.ResizeToFit />
        </FigButton>
        {sizable && (
          <FigButton
            title={node.flex ? 'Remove auto layout' : 'Add auto layout'}
            on={!!node.flex}
            onClick={toggleAutoLayout}
          >
            <Icon.AutoLayout />
          </FigButton>
        )}
      </div>

      {sizable && (
        <>
          <FigGroupSet legend="Flow">
            <div className="fig-row">
              <div className="fig-seg">
                <button
                  type="button"
                  title="Freeform"
                  aria-label="Freeform"
                  data-on={flow === 'none' ? 'true' : undefined}
                  onClick={() => setFlow('none')}
                >
                  <Icon.Freeform />
                </button>
                <button
                  type="button"
                  title="Vertical"
                  aria-label="Vertical"
                  data-on={flow === 'column' ? 'true' : undefined}
                  onClick={() => setFlow('column')}
                >
                  <Icon.ArrowDown />
                </button>
                <button
                  type="button"
                  title="Horizontal"
                  aria-label="Horizontal"
                  data-on={flow === 'row' ? 'true' : undefined}
                  onClick={() => setFlow('row')}
                >
                  <Icon.ArrowRight />
                </button>
                <button
                  type="button"
                  title="Wrap"
                  aria-label="Wrap"
                  data-on={flow === 'wrap' ? 'true' : undefined}
                  onClick={() => setFlow('wrap')}
                >
                  <Icon.Wrap />
                </button>
                <button
                  type="button"
                  title="Grid"
                  aria-label="Grid"
                  data-on={flow === 'grid' ? 'true' : undefined}
                  onClick={() => setFlow('grid')}
                >
                  <Icon.GridFlow />
                </button>
              </div>
              {node.flex ? (
                <AdvancedLayout
                  flex={node.flex}
                  patch={(delta) => set({ flex: { ...node.flex!, ...delta } })}
                />
              ) : (
                <span style={{ width: 24, flex: 'none' }} />
              )}
            </div>
          </FigGroupSet>
          {node.flex && <AutoLayoutControls node={node} set={set} />}
        </>
      )}

      <FigGroupSet legend="Dimensions">
      <div className="fig-row">
        <VarField
          node={node}
          field="w"
          value={shared(nodes, (n) => n.w)}
          glyph="W"
          min={1}
          title="Width"
          onChange={(w) => set({ w, wMode: 'fixed' })}
        />
        <VarField
          node={node}
          field="h"
          value={shared(nodes, (n) => n.h)}
          glyph="H"
          min={1}
          title="Height"
          onChange={(h) => set({ h, hMode: 'fixed' })}
        />
        <FigButton
          title={node.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          on={node.aspectLocked}
          onClick={() => set({ aspectLocked: !node.aspectLocked })}
        >
          <Icon.AspectLock />
        </FigButton>
      </div>
      <BoundsRow node={node} nodes={nodes} set={set} />
      </FigGroupSet>

      {resizable && (
        <div className="fig-row">
          <FigSelect
            value={node.wMode}
            mixed={shared(nodes, (n) => n.wMode) === 'mixed'}
            options={sizeModes}
            glyph="W"
            title="Horizontal resizing"
            onChange={(wMode) => set({ wMode })}
          />
          <FigSelect
            value={node.hMode}
            mixed={shared(nodes, (n) => n.hMode) === 'mixed'}
            options={sizeModes}
            glyph="H"
            title="Vertical resizing"
            onChange={(hMode) => set({ hMode })}
          />
          <span style={{ width: 24, flex: 'none' }} />
        </div>
      )}

      <ChildLayoutRow node={node} set={set} />
      <ConstraintsRow node={node} set={set} />
      <PropBindingRow node={node} />

      {node.type === 'frame' && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, cursor: 'default' }}
        >
          <input
            type="checkbox"
            checked={node.clip}
            onChange={(e) => set({ clip: e.target.checked })}
            style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
          />
          <span>Clip content</span>
        </label>
      )}
    </div>
  );
}

/**
 * Minimum and maximum size.
 *
 * They stay behind a toggle because most layers never need them, and a panel
 * that shows four more fields to everyone is a panel nobody reads. Once a bound
 * is set the row stays open, so a layer never carries a constraint you cannot
 * see. An empty field means "no bound", which is why these are nullable rather
 * than 0 and Infinity.
 */
function BoundsRow({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const has =
    node.minW != null || node.maxW != null || node.minH != null || node.maxH != null;
  const [open, setOpen] = useState(has);

  if (!open) {
    return (
      <div className="fig-row">
        <button
          type="button"
          className="fig-btn"
          style={{ padding: 0, gap: 6, color: 'var(--fig-icon-3)' }}
          onClick={() => setOpen(true)}
        >
          <Icon.Plus />
          Add min and max size
        </button>
      </div>
    );
  }

  const field = (
    key: 'minW' | 'maxW' | 'minH' | 'maxH',
    glyph: string,
    title: string,
    fallback: number,
  ) => (
    <FigField
      value={shared(nodes, (n) => n[key] ?? fallback)}
      glyph={glyph}
      min={1}
      title={title}
      placeholder="–"
      onChange={(value) => set({ [key]: value })}
    />
  );

  return (
    <>
      <div className="fig-row">
        {field('minW', 'W', 'Minimum width', 1)}
        {field('maxW', 'W', 'Maximum width', Math.round(node.w))}
        <FigButton
          title="Remove min and max size"
          onClick={() => {
            set({ minW: null, maxW: null, minH: null, maxH: null });
            setOpen(false);
          }}
        >
          <FigIcon name="Remove" />
        </FigButton>
      </div>
      <div className="fig-row">
        {field('minH', 'H', 'Minimum height', 1)}
        {field('maxH', 'H', 'Maximum height', Math.round(node.h))}
        <span style={{ width: 24, flex: 'none' }} />
      </div>
      <div className="fig-note" style={{ paddingLeft: 10 }}>
        Min and max apply while the layer is being laid out — they bound hugging
        and filling, not just a drag.
      </div>
    </>
  );
}

/**
 * What an auto layout's *child* gets to say for itself: whether it steps out of
 * the flow entirely, and how it sits on the cross axis when it stays in.
 */
function ChildLayoutRow({ node, set }: { node: SceneNode; set: Setter }) {
  const doc = useDoc();
  const zoom = useUI((s) => s.viewport.zoom);
  const parent = node.parent ? doc[node.parent] : null;
  if (!parent || parent.type === 'page' || !parent.flex) return null;

  const isRow = parent.flex.direction === 'row' && parent.flex.mode !== 'grid';
  const alignSelf: FigOption<Align | 'auto'>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'start', label: isRow ? 'Top' : 'Left' },
    { value: 'center', label: isRow ? 'Middle' : 'Center' },
    { value: 'end', label: isRow ? 'Bottom' : 'Right' },
    { value: 'stretch', label: 'Stretch' },
  ];

  /**
   * Leaving the flow means inheriting the position the flow had given it —
   * measured, because that number lives in the browser and nowhere else.
   */
  const toggleAbsolute = () => {
    if (node.absolute) {
      set({ absolute: false });
      return;
    }
    const box = measureChildren(parent.id, zoom)[node.id];
    set({
      absolute: true,
      ...(box
        ? {
            x: Math.round(box.x),
            y: Math.round(box.y),
            // "Fill container" loses its meaning the moment the flow does
            ...(node.wMode === 'fill' ? { wMode: 'fixed' as const, w: Math.max(1, Math.round(box.w)) } : null),
            ...(node.hMode === 'fill' ? { hMode: 'fixed' as const, h: Math.max(1, Math.round(box.h)) } : null),
          }
        : null),
    });
  };

  return (
    <>
      <FigLabel>In auto layout</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={node.alignSelf ?? 'auto'}
          options={alignSelf}
          glyph={isRow ? <Icon.AlignV at="middle" /> : <Icon.AlignH at="center" />}
          title="Align this layer on the cross axis"
          onChange={(value) => set({ alignSelf: value })}
        />
        <FigButton
          title={node.absolute ? 'Return to auto layout' : 'Absolute position'}
          on={!!node.absolute}
          onClick={toggleAbsolute}
          style={{ flex: 1 }}
        >
          <Icon.Absolute />
          <span>Absolute</span>
        </FigButton>
        <span style={{ width: 24, flex: 'none' }} />
      </div>
    </>
  );
}

/**
 * Constraints only mean something for an absolutely placed child, so the row
 * hides itself for anything a layout already owns.
 */
function ConstraintsRow({ node, set }: { node: SceneNode; set: Setter }) {
  const doc = useDoc();
  const parent = node.parent ? doc[node.parent] : null;
  if (!parent || parent.type === 'page') return null;
  // an auto-layout child is placed by the flow — unless it stepped out of it
  if (parent.flex && !node.absolute) return null;

  const spec = node.constraints ?? { h: 'start' as const, v: 'start' as const };
  const options = (axis: 'h' | 'v'): FigOption<Constraint>[] => [
    { value: 'start', label: axis === 'h' ? 'Left' : 'Top' },
    { value: 'center', label: 'Center' },
    { value: 'end', label: axis === 'h' ? 'Right' : 'Bottom' },
    { value: 'stretch', label: axis === 'h' ? 'Left and right' : 'Top and bottom' },
    { value: 'scale', label: 'Scale' },
  ];

  return (
    <>
      <FigLabel>Constraints</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={spec.h}
          options={options('h')}
          glyph="H"
          title="Horizontal constraint"
          onChange={(h) => set({ constraints: { ...spec, h } })}
        />
        <FigSelect
          value={spec.v}
          options={options('v')}
          glyph="V"
          title="Vertical constraint"
          onChange={(v) => set({ constraints: { ...spec, v } })}
        />
        <span style={{ width: 24, flex: 'none' }} />
      </div>
    </>
  );
}

// ── Auto layout ──────────────────────────────────────────────────────────

/** Gap, padding and alignment — Figma shows these inside Layout, under Flow. */
function AutoLayoutControls({ node, set }: { node: SceneNode; set: Setter }) {
  const flex = node.flex!;
  const patch = (delta: Partial<FlexSpec>) => set({ flex: { ...flex, ...delta } });
  const [top, right, bottom, left] = flex.padding;
  const [perSide, setPerSide] = useState(top !== bottom || left !== right);
  const isGrid = flex.mode === 'grid';
  // a second gap only exists once the layout has more than one line to space
  const hasCrossGap = isGrid || flex.wrap;
  const isRow = !isGrid && flex.direction === 'row';

  return (
    <>
      {isGrid && (
        <div className="fig-row">
          <FigField
            value={flex.columns ?? 2}
            glyph="C"
            min={1}
            max={24}
            title="Columns"
            onChange={(columns) => patch({ columns })}
          />
          <FigField
            value={flex.rows ?? 0}
            glyph="R"
            min={0}
            max={24}
            title="Rows — 0 fits as many as the children need"
            onChange={(rows) => patch({ rows })}
          />
          <span style={{ width: 24, flex: 'none' }} />
        </div>
      )}

      {/* Figma pairs the alignment picker with the gap fields; two 24px fields
          and the 8px between them come to exactly the picker's height. */}
      <div className="fig-row" style={{ alignItems: 'stretch' }}>
        <AlignGrid node={node} onChange={(align, justify) => patch({ align, justify })} />
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FigField
            value={flex.justify === 'between' && !isGrid ? 'mixed' : flex.gap}
            glyph={<Icon.Gap />}
            min={0}
            title={
              flex.justify === 'between' && !isGrid
                ? 'Gap is decided by the distribution'
                : isRow
                  ? 'Gap between columns'
                  : 'Gap between items'
            }
            disabled={flex.justify === 'between' && !isGrid}
            placeholder="Auto"
            onChange={(gap) => patch({ gap })}
          />
          <FigField
            value={hasCrossGap ? (flex.crossGap ?? flex.gap) : left === right ? left : 'mixed'}
            glyph={hasCrossGap ? <Icon.GapCross /> : <Icon.PadH />}
            min={0}
            title={hasCrossGap ? 'Gap between lines' : 'Horizontal padding'}
            onChange={(value) =>
              hasCrossGap
                ? patch({ crossGap: value })
                : patch({ padding: [top, value, bottom, value] })
            }
          />
        </div>
        <span style={{ width: 24, flex: 'none' }} />
      </div>

      <div className="fig-row">
        {hasCrossGap && (
          <FigField
            value={left === right ? left : 'mixed'}
            glyph={<Icon.PadH />}
            min={0}
            title="Horizontal padding"
            onChange={(value) => patch({ padding: [top, value, bottom, value] })}
          />
        )}
        <FigField
          value={top === bottom ? top : 'mixed'}
          glyph={<Icon.PadV />}
          min={0}
          title="Vertical padding"
          onChange={(value) => patch({ padding: [value, right, value, left] })}
        />
        {!hasCrossGap && (
          <FigSelect
            value={flex.justify}
            options={DISTRIBUTION}
            title="Distribution"
            onChange={(justify) => patch({ justify })}
          />
        )}
        <FigButton
          title="Set padding for each side"
          on={perSide}
          onClick={() => setPerSide((v) => !v)}
        >
          <FigIcon name="Individual corners" />
        </FigButton>
      </div>

      {hasCrossGap && (
        <div className="fig-row">
          <FigSelect
            value={flex.justify}
            options={DISTRIBUTION}
            glyph={isRow ? <Icon.ArrowRight /> : <Icon.ArrowDown />}
            title="Distribution along the flow"
            onChange={(justify) => patch({ justify })}
          />
          <FigSelect
            value={flex.alignContent ?? 'start'}
            options={ALIGN_CONTENT}
            glyph={<Icon.Wrap />}
            title="Align content — how the wrapped lines share the leftover space"
            onChange={(alignContent) => patch({ alignContent })}
          />
          <span style={{ width: 24, flex: 'none' }} />
        </div>
      )}

      {perSide && (
        <>
          <div className="fig-row">
            <FigField value={top} glyph="T" min={0} title="Top" onChange={(v) => patch({ padding: [v, right, bottom, left] })} />
            <FigField value={right} glyph="R" min={0} title="Right" onChange={(v) => patch({ padding: [top, v, bottom, left] })} />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
          <div className="fig-row">
            <FigField value={bottom} glyph="B" min={0} title="Bottom" onChange={(v) => patch({ padding: [top, right, v, left] })} />
            <FigField value={left} glyph="L" min={0} title="Left" onChange={(v) => patch({ padding: [top, right, bottom, v] })} />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
        </>
      )}
    </>
  );
}

/**
 * Figma's "Advanced layout settings" — the three rules that change how a layout
 * treats things other than position, tucked behind the ⋯ so the common case
 * stays two rows tall.
 */
function AdvancedLayout({
  flex,
  patch,
}: {
  flex: FlexSpec;
  patch: (delta: Partial<FlexSpec>) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  return (
    <span ref={anchor} style={{ display: 'inline-flex', flex: 'none' }}>
      <FigButton title="Advanced layout settings" on={open} onClick={() => setOpen((v) => !v)}>
        <Icon.Dots />
      </FigButton>
      {open && (
        <FigPopover anchor={anchor.current} width={236} onClose={() => setOpen(false)}>
          <div style={{ padding: '2px 6px 8px' }}>
            <FigLabel>Strokes</FigLabel>
            <FigGroup
              value={flex.strokesIncluded ? 'in' : 'out'}
              options={[
                { value: 'out', label: 'Excluded', title: 'Strokes sit outside the layout' },
                {
                  value: 'in',
                  label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon.StrokeInLayout />
                      Included
                    </span>
                  ),
                  title: 'Strokes are measured inside the frame',
                },
              ]}
              onChange={(value) => patch({ strokesIncluded: value === 'in' })}
            />

            <FigLabel>Canvas stacking</FigLabel>
            <FigGroup
              value={flex.stacking ?? 'last'}
              options={[
                { value: 'first', label: <Icon.Stack first />, title: 'First layer on top' },
                { value: 'last', label: <Icon.Stack />, title: 'Last layer on top' },
              ]}
              onChange={(stacking) => patch({ stacking })}
            />

            <FigLabel>Text baseline alignment</FigLabel>
            <FigGroup
              value={flex.baseline ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'Off', title: 'Align text by its box' },
                {
                  value: 'on',
                  label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon.Baseline />
                      On
                    </span>
                  ),
                  title: 'Align text by its baseline',
                },
              ]}
              onChange={(value) => patch({ baseline: value === 'on' })}
            />
          </div>
        </FigPopover>
      )}
    </span>
  );
}

/**
 * Figma's 3×3 alignment picker.
 *
 * The cell you pick sets both axes at once — which of the two it is writing to
 * depends on the flow direction — and the active cell previews the arrangement
 * as three bars laid out the way the children will be.
 */
function AlignGrid({
  node,
  onChange,
}: {
  node: SceneNode;
  onChange: (align: Align, justify: Justify) => void;
}) {
  const flex = node.flex!;
  const isRow = flex.direction === 'row' && flex.mode !== 'grid';
  const axis = ['start', 'center', 'end'] as const;
  // neither 'stretch' nor 'space-between' names a cell, so both read as centred
  const alignAt = flex.align === 'stretch' ? 1 : Math.max(0, axis.indexOf(flex.align as never));
  const justifyAt = flex.justify === 'between' ? 1 : Math.max(0, axis.indexOf(flex.justify as never));
  const activeRow = isRow ? alignAt : justifyAt;
  const activeCol = isRow ? justifyAt : alignAt;

  return (
    <div
      role="group"
      aria-label="Alignment"
      title="Alignment"
      style={{
        width: 56,
        height: 56,
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        borderRadius: 5,
        background: 'var(--fig-field)',
      }}
    >
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const on = row === activeRow && col === activeCol;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              aria-label={`Align ${axis[row]} ${axis[col]}`}
              aria-pressed={on}
              onClick={() =>
                isRow
                  ? onChange(axis[row] as Align, axis[col] as Justify)
                  : onChange(axis[col] as Align, axis[row] as Justify)
              }
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                cursor: 'default',
                color: on ? 'var(--fig-blue)' : 'rgba(0,0,0,0.28)',
              }}
            >
              {on ? (
                <span
                  style={{
                    display: 'flex',
                    flexDirection: isRow ? 'row' : 'column',
                    alignItems: 'center',
                    gap: 1.5,
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: isRow ? 2 : 8,
                        height: isRow ? 8 : 2,
                        borderRadius: 1,
                        background: 'currentColor',
                      }}
                    />
                  ))}
                </span>
              ) : (
                <span style={{ width: 2.5, height: 2.5, borderRadius: 2, background: 'currentColor' }} />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────

function AppearanceSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const perCorner = !!node.radii;
  const corners = node.radii ?? [node.radius, node.radius, node.radius, node.radius];

  return (
    <FigSection
      title="Appearance"
      actions={
        <>
          <FigButton
            title={node.visible ? 'Hide' : 'Show'}
            onClick={() => set({ visible: !node.visible })}
          >
            <Icon.Eye off={!node.visible} />
          </FigButton>
          <FigButton
            title={node.locked ? 'Unlock layer' : 'Lock layer'}
            on={node.locked}
            onClick={() => set({ locked: !node.locked })}
          >
            <Icon.Lock open={!node.locked} />
          </FigButton>
          {node.type !== 'text' && <CornerSettings node={node} set={set} />}
          <FigBlendMenu value={node.blend} onChange={(blend) => set({ blend })} />
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ flex: '1 1 0' }}>
          <FigLabel>Opacity</FigLabel>
        </span>
        <span style={{ flex: '1 1 0' }}>
          {node.type !== 'text' && <FigLabel>Corner radius</FigLabel>}
        </span>
        <span style={{ width: 24, flex: 'none' }} />
      </div>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <VarField
          node={node}
          field="opacity"
          value={shared(nodes, (n) => Math.round(n.opacity * 100))}
          glyph={<Icon.Opacity />}
          suffix="%"
          min={0}
          max={100}
          title="Opacity"
          onChange={(value) => set({ opacity: value / 100 })}
        />
        {node.type === 'text' ? (
          <div style={{ flex: '1 1 0' }} />
        ) : (
          <VarField
            node={node}
            field="radius"
            value={perCorner ? 'mixed' : shared(nodes, (n) => n.radius)}
            glyph={<FigIcon name="Individual corners" />}
            min={0}
            title="Corner radius"
            onChange={(radius) => set({ radius, radii: null })}
          />
        )}
        {node.type !== 'text' && (
          <FigButton
            title={perCorner ? 'Single corner radius' : 'Independent corners'}
            on={perCorner}
            onClick={() =>
              set(
                perCorner
                  ? { radii: null, radius: Math.max(...corners) }
                  : { radii: [node.radius, node.radius, node.radius, node.radius] },
              )
            }
          >
            <FigIcon name="Individual corners" />
          </FigButton>
        )}
      </div>

      {perCorner && node.type !== 'text' && (
        <>
          <div className="fig-row">
            <FigField value={corners[0]} glyph={<FigIcon name="Top left corner radius" />} min={0} title="Top left" onChange={(v) => set({ radii: [v, corners[1], corners[2], corners[3]] })} />
            <FigField value={corners[1]} glyph={<FigIcon name="Top right corner radius" />} min={0} title="Top right" onChange={(v) => set({ radii: [corners[0], v, corners[2], corners[3]] })} />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
          <div className="fig-row">
            <FigField value={corners[3]} glyph={<FigIcon name="Bottom left corner radius" />} min={0} title="Bottom left" onChange={(v) => set({ radii: [corners[0], corners[1], corners[2], v] })} />
            <FigField value={corners[2]} glyph={<FigIcon name="Bottom right corner radius" />} min={0} title="Bottom right" onChange={(v) => set({ radii: [corners[0], corners[1], v, corners[3]] })} />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
        </>
      )}
    </FigSection>
  );
}

/**
 * Figma's corner settings — the smoothing that turns a rounded corner into a
 * squircle. CSS calls the same curve a superellipse, so this is a real property
 * rather than a redrawn path: it exports, and it survives a resize.
 */
function CornerSettings({ node, set }: { node: SceneNode; set: Setter }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const smoothing = Math.round((node.cornerSmoothing ?? 0) * 100);
  const rounded = !!node.radius || !!node.radii;

  return (
    <span ref={anchorRef} style={{ display: 'inline-flex' }}>
      <FigButton
        title="Corner settings"
        on={open || smoothing > 0}
        disabled={!rounded}
        onClick={() => setOpen((v) => !v)}
      >
        <FigIcon name="Corner smoothing" />
      </FigButton>
      {open && (
        <FigPopover anchor={anchorRef.current} width={220} onClose={() => setOpen(false)}>
          <div style={{ padding: '2px 6px 8px' }}>
            <FigLabel>Corner smoothing</FigLabel>
            <div className="fig-row" style={{ marginTop: 0 }}>
              <input
                type="range"
                aria-label="Corner smoothing"
                min={0}
                max={100}
                value={smoothing}
                onChange={(e) => set({ cornerSmoothing: Number(e.target.value) / 100 })}
                style={{ flex: 1, accentColor: 'var(--fig-blue)' }}
              />
              <FigField
                value={smoothing}
                suffix="%"
                min={0}
                max={100}
                title="Corner smoothing"
                onChange={(value) => set({ cornerSmoothing: value / 100 })}
              />
            </div>
            <div className="fig-row">
              <FigGroup
                value={smoothing === 0 ? 'none' : smoothing === 60 ? 'ios' : 'custom'}
                onChange={(preset) => {
                  if (preset === 'none') set({ cornerSmoothing: 0 });
                  if (preset === 'ios') set({ cornerSmoothing: 0.6 });
                }}
                options={[
                  { value: 'none', label: 'None', title: 'A circular corner' },
                  { value: 'ios', label: 'iOS', title: "Apple's squircle — 60%" },
                  { value: 'custom', label: 'Custom', title: 'Whatever the slider says' },
                ]}
              />
            </div>
          </div>
        </FigPopover>
      )}
    </span>
  );
}

/**
 * Figma's advanced stroke settings.
 *
 * Individual strokes are the reason this exists: four widths cannot be drawn
 * with the ring shadow an even stroke uses, so picking them switches the whole
 * border over to real CSS borders. Dashes, caps and joins are only offered on a
 * vector, because that is the one node whose stroke is a real SVG path — a box
 * has no ends to cap.
 */
function AdvancedStroke({
  node,
  stroke,
  set,
}: {
  node: SceneNode;
  stroke: NonNullable<SceneNode['border']>;
  set: Setter;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const patch = (delta: Partial<NonNullable<SceneNode['border']>>) =>
    set({ border: { ...stroke, ...delta } });
  const sides = stroke.sides ?? null;
  const [top, right, bottom, left] = sides ?? [stroke.width, stroke.width, stroke.width, stroke.width];
  const isVector = node.type === 'vector';

  return (
    <span ref={anchorRef} style={{ display: 'inline-flex' }}>
      <FigButton
        title="Advanced stroke"
        on={open || !!sides || !!stroke.dash}
        onClick={() => setOpen((v) => !v)}
      >
        <FigIcon name="Advanced stroke settings" />
      </FigButton>
      {open && (
        <FigPopover anchor={anchorRef.current} width={228} onClose={() => setOpen(false)}>
          <div style={{ padding: '2px 6px 8px' }}>
            <div className="fig-row" style={{ marginTop: 0 }}>
              <FigButton
                title="Set a weight for each side"
                on={!!sides}
                style={{ flex: 1 }}
                onClick={() =>
                  patch({
                    sides: sides
                      ? null
                      : ([stroke.width, stroke.width, stroke.width, stroke.width] as [
                          number,
                          number,
                          number,
                          number,
                        ]),
                  })
                }
              >
                <FigIcon name="Individual strokes" />
                <span>Individual strokes</span>
              </FigButton>
            </div>

            {sides && (
              <>
                <div className="fig-row">
                  <FigField value={top} glyph="T" min={0} title="Top" onChange={(v) => patch({ sides: [v, right, bottom, left] })} />
                  <FigField value={right} glyph="R" min={0} title="Right" onChange={(v) => patch({ sides: [top, v, bottom, left] })} />
                </div>
                <div className="fig-row">
                  <FigField value={bottom} glyph="B" min={0} title="Bottom" onChange={(v) => patch({ sides: [top, right, v, left] })} />
                  <FigField value={left} glyph="L" min={0} title="Left" onChange={(v) => patch({ sides: [top, right, bottom, v] })} />
                </div>
              </>
            )}

            {isVector ? (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ flex: '1 1 0' }}>
                    <FigLabel>Dash</FigLabel>
                  </span>
                  <span style={{ flex: '1 1 0' }}>
                    <FigLabel>Gap</FigLabel>
                  </span>
                </div>
                <div className="fig-row" style={{ marginTop: 0 }}>
                  <FigField
                    value={stroke.dash ?? 0}
                    glyph={<Icon.StrokeStyle />}
                    min={0}
                    title="Dash length"
                    onChange={(dash) => patch({ dash })}
                  />
                  <FigField
                    value={stroke.gap ?? stroke.dash ?? 0}
                    glyph={<Icon.Gap />}
                    min={0}
                    title="Gap between dashes"
                    onChange={(gap) => patch({ gap })}
                  />
                </div>

                {/* two unlabelled selects side by side read as the same control */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ flex: '1 1 0' }}>
                    <FigLabel>Cap</FigLabel>
                  </span>
                  <span style={{ flex: '1 1 0' }}>
                    <FigLabel>Join</FigLabel>
                  </span>
                </div>
                <div className="fig-row" style={{ marginTop: 0 }}>
                  <FigSelect
                    value={stroke.cap ?? 'round'}
                    options={[
                      { value: 'butt', label: 'None' },
                      { value: 'round', label: 'Round' },
                      { value: 'square', label: 'Square' },
                    ]}
                    title="Cap"
                    onChange={(cap) => patch({ cap })}
                  />
                  <FigSelect
                    value={stroke.join ?? 'round'}
                    options={[
                      { value: 'miter', label: 'Miter' },
                      { value: 'bevel', label: 'Bevel' },
                      { value: 'round', label: 'Round' },
                    ]}
                    title="Join"
                    onChange={(join) => patch({ join })}
                  />
                </div>
                {(stroke.join ?? 'round') === 'miter' && (
                  <div className="fig-row">
                    <FigField
                      value={Math.round(stroke.miterAngle ?? 28.96)}
                      glyph={<Icon.Angle />}
                      min={1}
                      max={180}
                      suffix="°"
                      title="Miter angle — below this a mitre bevels instead"
                      onChange={(miterAngle) => patch({ miterAngle })}
                    />
                    <span style={{ flex: '1 1 0' }} />
                    <span style={{ width: 24, flex: 'none' }} />
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: '6px 2px 0', color: 'var(--fig-dim)' }}>
                Dashes, caps and joins are drawn on vector paths — draw one with
                the pen to set them.
              </div>
            )}
          </div>
        </FigPopover>
      )}
    </span>
  );
}

/**
 * Figma's per-row export options: the suffix that lands in the filename, and
 * whether the frame's own background comes with it.
 */
function ExportOptions({
  row,
  onChange,
}: {
  row: { suffix?: string; contentsOnly?: boolean };
  onChange: (patch: { suffix?: string; contentsOnly?: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <span ref={anchorRef} style={{ display: 'inline-flex' }}>
      <FigButton
        title="More options"
        on={open || !!row.suffix || !!row.contentsOnly}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.Dots />
      </FigButton>
      {open && (
        <FigPopover anchor={anchorRef.current} width={214} onClose={() => setOpen(false)}>
          <div style={{ padding: '2px 6px 8px' }}>
            <FigLabel>Suffix</FigLabel>
            <div className="fig-row" style={{ marginTop: 0 }}>
              <FigText
                value={row.suffix ?? ''}
                placeholder="@2x, -dark…"
                onChange={(suffix) => onChange({ suffix })}
              />
            </div>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, cursor: 'default' }}
            >
              <input
                type="checkbox"
                checked={!!row.contentsOnly}
                onChange={(e) => onChange({ contentsOnly: e.target.checked })}
                style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
              />
              <span>Contents only</span>
            </label>
          </div>
        </FigPopover>
      )}
    </span>
  );
}

// ── Typography ───────────────────────────────────────────────────────────


/**
 * Variable modes.
 *
 * Figma puts this on the frame because that is where a mode is useful: a card
 * set to Dark shows the dark values of every variable in that collection, and
 * everything inside it follows. Here it is the CSS cascade doing the work —
 * the frame re-declares those custom properties on itself — so the same switch
 * survives export with no runtime behind it.
 */
function ModesSection({ node }: { node: SceneNode }) {
  const store = useStore();
  const collections = useCollections();
  const withModes = collections.filter((collection) => collection.modes.length > 1);
  if (!canHoldModes(node) || !withModes.length) return null;

  return (
    <FigSection title="Variable modes">
      {withModes.map((collection) => (
        <div className="fig-row" key={collection.id}>
          <FigLabel>{collection.name}</FigLabel>
          <FigSelect
            value={node.modes?.[collection.id] ?? 'auto'}
            options={[
              { value: 'auto', label: 'Inherit' },
              ...collection.modes.map((mode) => ({ value: mode.id, label: mode.name })),
            ]}
            title={`${collection.name} mode`}
            onChange={(modeId) =>
              store.setNodeMode(node.id, collection.id, modeId === 'auto' ? null : modeId)
            }
          />
        </div>
      ))}
    </FigSection>
  );
}

/**
 * The parametric part of a shape.
 *
 * A polygon is a count, a star is a count and a ratio, an arc is two angles and
 * a hole — the numbers Figma keeps beside the shape rather than in the geometry,
 * so changing one re-draws the shape instead of asking you to move every point.
 * A boolean group's operation lives here too, because that is the same kind of
 * property: one control that re-evaluates the whole outline.
 */
function ShapeSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const store = useStore();
  const setVectorEdit = useUI((s) => s.setVectorEdit);
  const isArc =
    node.type === 'ellipse' &&
    ((node.arcStart ?? 0) !== 0 || (node.arcEnd ?? 1) !== 1 || (node.innerRadius ?? 0) !== 0);

  const relevant =
    node.type === 'polygon' ||
    node.type === 'star' ||
    node.type === 'ellipse' ||
    node.type === 'boolean' ||
    node.type === 'vector' ||
    node.isMask;
  if (!relevant) return null;

  const start = node.arcStart ?? 0;
  const end = node.arcEnd ?? 1;

  return (
    <FigSection title={node.type === 'boolean' ? 'Boolean' : 'Shape'}>
      {node.type === 'boolean' && (
        <div className="fig-row">
          <FigGroup
            value={node.op ?? 'union'}
            onChange={(op) => nodes.forEach((n) => store.setBooleanOp(n.id, op))}
            options={[
              { value: 'union', label: <Icon.Boolean op="union" />, title: 'Union' },
              { value: 'subtract', label: <Icon.Boolean op="subtract" />, title: 'Subtract' },
              { value: 'intersect', label: <Icon.Boolean op="intersect" />, title: 'Intersect' },
              { value: 'exclude', label: <Icon.Boolean op="exclude" />, title: 'Exclude' },
            ]}
          />
        </div>
      )}

      {(node.type === 'polygon' || node.type === 'star') && (
        <div className="fig-row">
          <FigField
            value={shared(nodes, (n) => n.sides ?? (n.type === 'star' ? 5 : 3))}
            glyph={node.type === 'star' ? <Icon.Star /> : <Icon.Polygon />}
            min={3}
            max={60}
            title={node.type === 'star' ? 'Point count' : 'Side count'}
            onChange={(sides) => set({ sides })}
          />
          {node.type === 'star' ? (
            <FigField
              value={Math.round((shared(nodes, (n) => n.innerRatio ?? 0.4) as number) * 100)}
              glyph="R"
              min={1}
              max={100}
              suffix="%"
              title="Star ratio"
              onChange={(ratio) => set({ innerRatio: ratio / 100 })}
            />
          ) : (
            <span style={{ flex: '1 1 0' }} />
          )}
          <span style={{ width: 24, flex: 'none' }} />
        </div>
      )}

      {node.type === 'ellipse' && (
        <>
          <div className="fig-row">
            <FigField
              value={Math.round(start * 360)}
              glyph={<Icon.Angle />}
              min={0}
              max={360}
              suffix="°"
              title="Arc start"
              onChange={(deg) => set({ arcStart: deg / 360, arcEnd: end })}
            />
            <FigField
              value={Math.round((end - start) * 360)}
              glyph="S"
              min={0}
              max={360}
              suffix="°"
              title="Arc sweep"
              onChange={(deg) => set({ arcStart: start, arcEnd: start + deg / 360 })}
            />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
          <div className="fig-row">
            <FigField
              value={Math.round((shared(nodes, (n) => n.innerRadius ?? 0) as number) * 100)}
              glyph="◎"
              min={0}
              max={99}
              suffix="%"
              title="Ratio — the hole in the middle"
              onChange={(ratio) => set({ innerRadius: ratio / 100 })}
            />
            <span style={{ flex: '1 1 0' }} />
            <span style={{ width: 24, flex: 'none' }} />
          </div>
          {isArc && (
            <div className="fig-note">
              An arc paints through its own path, so it takes a stroke rather
              than a border.
            </div>
          )}
        </>
      )}

      {node.type === 'vector' && (
        <div className="fig-row">
          <FigButton title="Edit points" onClick={() => setVectorEdit(node.id)}>
            <Icon.Anchor />
          </FigButton>
          <span style={{ flex: 1, paddingLeft: 4, opacity: 0.7 }}>
            {(node.anchors?.length ?? node.points?.length ?? 0)} points
          </span>
          <FigGroup
            value={node.closed ? 'closed' : 'open'}
            onChange={(value) => set({ closed: value === 'closed' })}
            options={[
              { value: 'open', label: 'Open', title: 'Open path' },
              { value: 'closed', label: 'Closed', title: 'Closed path' },
            ]}
          />
        </div>
      )}

      {node.isMask && (
        <div className="fig-row">
          <FigSelect
            value={node.maskType ?? 'alpha'}
            options={[
              { value: 'alpha', label: 'Shape mask' },
              { value: 'luminance', label: 'Luminance mask' },
            ]}
            title="Mask type"
            onChange={(maskType) => set({ maskType })}
          />
          <FigButton title="Remove mask" onClick={() => store.toggleMask([node.id])}>
            <Icon.Mask />
          </FigButton>
        </div>
      )}
    </FigSection>
  );
}

/**
 * The style menu: every cut the family ships, roman then italic.
 *
 * Figma keeps weight and slope in one control because that is what a family
 * actually offers — "Bold Italic" is a font file, not two independent switches —
 * and the menu ends with a way into the variable axes for the families that
 * interpolate between the cuts instead of shipping them.
 */
function FontStyleMenu({
  node,
  font,
  face,
  onChange,
  onAxes,
}: {
  node: SceneNode;
  font: FontSpec;
  face: FontFace | undefined;
  onChange: (weight: number, italic: boolean) => void;
  onAxes: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [variables, setVariables] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const names = useVarNames();
  const styles = stylesOf(face);
  const romanCount = face?.weights.length ?? styles.length;
  // a bound weight is the variable's to change, so the trigger says whose it is
  const boundTo = variableLabel(node, 'fontWeight', names);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="fig-input"
        title="Style"
        data-on={open ? 'true' : undefined}
        style={{ flex: '1 1 0', cursor: 'default' }}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <span className="fig-value" data-variable={boundTo ? 'true' : undefined}>
          {boundTo ?? styleLabel(font.weight, font.italic)}
        </span>
        <span className="fig-caret">
          <Icon.Caret />
        </span>
      </button>
      {open && (
        <FigPopover
          anchor={anchor.current}
          width={210}
          variant="dark"
          placement="beside"
          onClose={() => setOpen(false)}
        >
          <ul role="listbox" aria-label="Font style" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {styles.map((style, index) => (
              <li key={`${style.weight}${style.italic ? 'i' : ''}`}>
                <FigMenuItem
                  label={styleLabel(style.weight, style.italic)}
                  selected={style.weight === font.weight && !!font.italic === style.italic}
                  // the italics start their own group, as they do in Figma
                  divider={index === romanCount && romanCount > 0}
                  onSelect={() => {
                    onChange(style.weight, style.italic);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
            {!!face?.axes.length && (
              <li>
                <FigMenuItem
                  label="Variable font axes…"
                  divider
                  onSelect={() => {
                    setOpen(false);
                    onAxes();
                  }}
                />
              </li>
            )}
            <li>
              {/* Figma's own last entry: the weight can come from a number
                  variable, so a type scale is stated once and worn everywhere */}
              <FigMenuItem
                label={boundTo ? `Weight: ${boundTo}` : 'Apply variable…'}
                divider={!face?.axes.length}
                selected={!!boundTo}
                onSelect={() => {
                  setOpen(false);
                  setVariables(true);
                }}
              />
            </li>
          </ul>
        </FigPopover>
      )}
      {variables && (
        <VariableMenu node={node} field="fontWeight" onClose={() => setVariables(false)} />
      )}
    </>
  );
}

/**
 * The size field, with Figma's preset menu behind its caret.
 *
 * Typing and scrubbing both still work — the menu is the shortcut, not the only
 * way in — and whatever the size currently is sits at the top of the list even
 * when it is nothing like a preset, so the menu always says what is set.
 */
function FontSizeField({
  node,
  value,
  onChange,
}: {
  node: SceneNode;
  value: number;
  onChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  return (
    <>
      <VarField
        node={node}
        field="fontSize"
        value={value}
        glyph={<Icon.FontSize />}
        min={1}
        max={2000}
        title="Size"
        onChange={onChange}
        trailing={
          <span ref={setAnchor} style={{ display: 'inline-flex' }}>
            <button
              type="button"
              className="fig-caret-btn"
              title="Font sizes"
              aria-label="Font sizes"
              onPointerDown={(event) => {
                event.stopPropagation();
                setOpen((v) => !v);
              }}
            >
              <Icon.Caret />
            </button>
          </span>
        }
      />
      {open && (
        <FigPopover
          anchor={anchor}
          width={110}
          variant="dark"
          placement="beside"
          onClose={() => setOpen(false)}
        >
          <ul role="listbox" aria-label="Font size" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            <li>
              <button type="button" className="fig-menu-item" data-current="true" onClick={() => setOpen(false)}>
                <span className="fig-menu-mark">✓</span>
                {value}
              </button>
            </li>
            {FONT_SIZES.map((size, index) => (
              <li key={size}>
                <FigMenuItem
                  label={String(size)}
                  divider={index === 0}
                  onSelect={() => {
                    onChange(size);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        </FigPopover>
      )}
    </>
  );
}

function TypographySection({ node, set }: { node: SceneNode; set: Setter }) {
  const store = useStore();
  const custom = useCustomFonts();
  const uploaded = useMemo(() => customFamilies(custom), [custom]);
  const font = node.font ?? DEFAULT_FONT;
  const patch = (delta: Partial<typeof font>) => set({ font: { ...font, ...delta } });
  const [settings, setSettings] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLSpanElement | null>(null);
  const face = fontFor(font.family, uploaded);

  return (
    <FigSection
      title="Typography"
      actions={<StylePicker slot="text" node={node} />}
    >
      <StyleBadge node={node} slot="text" />
      <div className="fig-row">
        <FontPicker
          value={font.family}
          onUpload={() => fileRef.current?.click()}
          onChange={(family) => {
            ensureFont(family, uploaded);
            // a family that has no 500, or no italic, must not be left claiming one
            const style = nearestStyle(family, font.weight, !!font.italic, uploaded);
            patch({ family, weight: style.weight, italic: style.italic, variations: undefined });
          }}
        />
        <FigButton title="Upload a font file" onClick={() => fileRef.current?.click()}>
          <Icon.Plus />
        </FigButton>
        <input
          ref={fileRef}
          type="file"
          accept=".woff2,.woff,.otf,.ttf"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              const { name, src } = await readFontFile(file);
              store.addFont({ name, src, weight: font.weight || 400 });
              store.commit();
              patch({ family: `"${name}", system-ui, sans-serif` });
            } catch (error) {
              setFontError(error instanceof Error ? error.message : 'Could not read that font.');
              window.setTimeout(() => setFontError(null), 5000);
            }
          }}
        />
      </div>
      {fontError && <div className="fig-note">{fontError}</div>}
      <div className="fig-row">
        <FontStyleMenu
          node={node}
          font={font}
          face={face}
          onAxes={() => setSettings(true)}
          onChange={(weight, italic) =>
            patch({
              weight,
              italic,
              // a named cut and a wght axis are the same property said twice, so
              // picking Bold has to move the axis with it
              variations: font.variations ? { ...font.variations, wght: weight } : undefined,
            })
          }
        />
        <FontSizeField node={node} value={font.size} onChange={(size) => patch({ size })} />
      </div>
      <div className="fig-row">
        <VarField
          node={node}
          field="lineHeight"
          value={Math.round(font.lineHeight * font.size)}
          glyph={<Icon.LineHeight />}
          min={0}
          title="Line height"
          onChange={(px) => patch({ lineHeight: px / Math.max(font.size, 1) })}
        />
        <VarField
          node={node}
          field="letterSpacing"
          value={Math.round(font.letterSpacing * 100)}
          glyph={<Icon.Letter />}
          suffix="%"
          title="Letter spacing"
          onChange={(value) => patch({ letterSpacing: value / 100 })}
        />
      </div>
      <div className="fig-row">
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
        <FigGroup
          value={node.vAlign ?? 'top'}
          onChange={(vAlign) => set({ vAlign })}
          options={[
            { value: 'top', label: <Icon.AlignV at="top" />, title: 'Align top' },
            { value: 'middle', label: <Icon.AlignV at="middle" />, title: 'Align middle' },
            { value: 'bottom', label: <Icon.AlignV at="bottom" />, title: 'Align bottom' },
          ]}
        />
        {/* the rest of type — case, trim, numbers, the family's own axes —
            lives in a dialog beside the panel rather than in eight more rows */}
        <span ref={setSettingsAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="Type settings" on={settings} onClick={() => setSettings((v) => !v)}>
            <Icon.Sliders />
          </FigButton>
        </span>
      </div>
      {settings && (
        <FigPopover
          anchor={settingsAnchor}
          width={252}
          variant="card"
          placement="beside"
          // tall enough for the Basics tab whole; Details still scrolls, which
          // is what a tab of fine print is for
          maxHeight={560}
          onClose={() => setSettings(false)}
        >
          <TypeSettings
            node={node}
            font={font}
            patch={patch}
            set={set}
            onClose={() => setSettings(false)}
          />
        </FigPopover>
      )}

      <FigPaintRow color={font.color} alpha={1} onColor={(color) => patch({ color })} />
    </FigSection>
  );
}

// ── Fill ─────────────────────────────────────────────────────────────────

const GRADIENTS = {
  linear: 'linear-gradient(180deg, #DDDDDD 0%, #A4A4A4 100%)',
  radial: 'radial-gradient(circle at 50% 40%, #DDDDDD 0%, #A4A4A4 100%)',
  conic: 'conic-gradient(from 180deg, #DDDDDD 0%, #A4A4A4 100%)',
};

/**
 * What the picker's paint-type tabs produce. Video and Shader are missing on
 * purpose: they are properties of the layer, not CSS paints, so those tabs
 * switch the layer rather than writing a fill.
 */
const PAINT_DEFAULTS: Record<Exclude<PaintType, 'video' | 'shader'>, string> = {
  solid: '#D9D9D9',
  gradient: GRADIENTS.linear,
  pattern: 'repeating-linear-gradient(45deg, #DDDDDD 0 8px, #A4A4A4 8px 16px)',
  image: 'url(https://placehold.co/600x400)',
};

/**
 * Every colour already used on the page — Figma's "On this page".
 *
 * Figma means every colour you can see, so this has to look everywhere a colour
 * can hide: fills, strokes, text, effects, text strokes and grids. It also has
 * to accept the forms a colour actually takes in this document — `rgba()`,
 * three-digit hex, eight-digit hex and `var(--token)` — because a panel that
 * only recognises `#RRGGBB` reports an empty swatch row on a document made
 * entirely of variables, which is what it did.
 */
function pageColors(doc: Doc, page: string, tokens: Token[] = []): string[] {
  const byName = new Map(tokens.map((token) => [token.name, token.value]));
  const seen = new Set<string>();

  const add = (value: string | null | undefined): void => {
    if (!value) return;
    const raw = value.trim();
    if (!raw || raw === 'none' || raw === 'transparent') return;
    // a variable is worth a swatch as the colour it resolves to
    const reference = /^var\(--([a-zA-Z0-9_-]+)\)$/.exec(raw);
    if (reference) return add(byName.get(reference[1]));
    // gradients and images name colours inside themselves
    if (/gradient\(/i.test(raw)) {
      for (const stop of raw.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []) add(stop);
      return;
    }
    if (/^url\(/i.test(raw)) return;
    const hex = /^#([0-9a-fA-F]{3,8})$/.exec(raw);
    if (hex) {
      const digits = hex[1];
      const full =
        digits.length === 3
          ? digits.split('').map((c) => c + c).join('')
          : digits.slice(0, 6);
      seen.add(`#${full.toUpperCase()}`);
      return;
    }
    if (/^rgba?\(/i.test(raw)) {
      const parts = raw.match(/-?\d*\.?\d+/g);
      if (!parts || parts.length < 3) return;
      const channels = parts.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
      seen.add(`#${channels.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
    }
  };

  for (const id of descendants(page, doc)) {
    const node = doc[id];
    if (!node) continue;
    if (node.fills?.length) for (const paint of node.fills) add(paint.value);
    else add(node.fill);
    add(node.border?.color);
    add(node.outline?.color);
    add(node.font?.color);
    add(node.textStroke?.color);
    add(node.shadow?.color);
    add(node.innerShadow?.color);
    for (const effect of node.effects ?? []) {
      add(effect.color);
      add(effect.color2);
    }
    add(node.guides?.color);
  }
  return [...seen].slice(0, 40);
}

function fillKind(fill: string | null): 'solid' | 'gradient' | 'image' {
  if (!fill) return 'solid';
  if (/gradient\(/.test(fill)) return 'gradient';
  if (/^url\(/.test(fill)) return 'image';
  return 'solid';
}

/**
 * The colour behind a layer — the nearest ancestor that actually paints one.
 *
 * The contrast check needs something to measure against, and "the parent" is
 * not it: a transparent group would report the contrast of a colour against
 * nothing. Falls back to white, which is what an empty canvas is.
 */
function backdropOf(node: SceneNode, doc: Doc, tokens: { name: string; value: string }[]): string {
  let current = node.parent ? doc[node.parent] : null;
  while (current) {
    const paint = current.fills?.find((p) => p.visible !== false)?.value ?? current.fill;
    const resolved = paint && current.fillVisible !== false ? resolveColor(paint, tokens) : null;
    if (resolved) return resolved;
    current = current.parent ? doc[current.parent] : null;
  }
  return '#FFFFFF';
}

/** The paint a fill row stands for, so two selections can be compared. */
function primaryFill(node: SceneNode): string | null {
  return node.fills?.find((paint) => paint.visible !== false)?.value ?? node.fill;
}

function FillSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const doc = useDoc();
  const store = useStore();
  const page = useUI((state) => state.page);
  const allTokens = useTokens();
  // only variables scoped to fills are *offered*; resolving a value still needs
  // the whole list, or a variable applied before it was scoped stops rendering
  const tokens = allTokens.filter((token) => inScope(token, 'fill'));
  const swatches = pageColors(doc, page);
  const backdrop = backdropOf(node, doc, allTokens);
  const mixed =
    nodes.length > 1 && !nodes.every((entry) => primaryFill(entry) === primaryFill(nodes[0]));
  // an older document has a single `fill`; present it as a one-entry stack
  const paints: Paint[] =
    node.fills?.length
      ? node.fills
      : node.fill
        ? [{ id: 'base', value: node.fill, opacity: node.fillOpacity ?? 1, visible: node.fillVisible !== false }]
        : [];

  const write = (next: Paint[]) =>
    set({ fills: next, fill: next[0]?.value ?? null, fillVisible: next[0]?.visible ?? true });

  const patch = (id: string, delta: Partial<Paint>) =>
    write(paints.map((p) => (p.id === id ? { ...p, ...delta } : p)));

  return (
    <FigSection
      title="Fill"
      empty={!paints.length}
      onAdd={() =>
        write([
          { id: Math.random().toString(36).slice(2, 8), value: '#D9D9D9', opacity: 1, visible: true },
          ...paints,
        ])
      }
      actions={
        // Figma keeps this button in the header whether or not the layer has a
        // fill: applying a style is how you *give* it one.
        <StylePicker
          slot="fill"
          node={node}
          onPickVariable={(reference) =>
            paints.length
              ? patch(paints[0].id, { value: reference })
              : set({ fills: undefined, fill: reference, fillVisible: true })
          }
        />
      }
    >
      <StyleBadge node={node} slot="fill" />
      {mixed && (
        <div style={{ color: 'var(--fig-dim)', padding: '0 2px 4px' }}>
          Click + to replace mixed content
        </div>
      )}
      {mixed ? (
        <FigPaintRow
          color={paints[0]?.value ?? '#D9D9D9'}
          alpha={1}
          mixed
          pageColors={swatches}
          backdrop={backdrop}
          tokens={tokens}
          // one colour picked here settles every selected layer on it, which is
          // the only sensible reading of editing a value they disagree about
          onColor={(value) => set({ fills: undefined, fill: value, fillVisible: true })}
          onRemove={() => set({ fills: undefined, fill: null })}
        />
      ) : (
      paints.map((paint) => {
        const kind = fillKind(paint.value);
        return (
          <div key={paint.id}>
            <FigPaintRow
              color={paint.value}
              alpha={paint.opacity}
              visible={paint.visible}
              onColor={(value) => patch(paint.id, { value })}
              onAlpha={(opacity) => patch(paint.id, { opacity })}
              onVisible={() => patch(paint.id, { visible: !paint.visible })}
              onRemove={() => write(paints.filter((p) => p.id !== paint.id))}
              kind={node.shader ? 'shader' : node.video ? 'video' : undefined}
              typeBody={
                node.video ? (
                  <VideoControls video={node.video} set={set} />
                ) : node.shader ? (
                  <ShaderChooser spec={node.shader} set={set} />
                ) : undefined
              }
              blend={node.blend}
              onBlend={(blend) => set({ blend })}
              pageColors={swatches}
              backdrop={backdrop}
              tokens={tokens}
              onCreateToken={(hex) => {
                const name = `color-${allTokens.length + 1}`;
                store.addToken({ name, type: 'color', value: hex });
                patch(paint.id, { value: `var(--${name})` });
              }}
              onKind={(next) => {
                // The six types are exclusive, as they are in Figma. Video and
                // Shader are properties of the layer rather than CSS paints, so
                // those tabs switch the layer and clear whichever was set.
                if (next === 'video') {
                  set({
                    shader: null,
                    video: node.video ?? { src: '', loop: true, muted: true, autoplay: true, fit: 'cover' },
                  });
                  return;
                }
                if (next === 'shader') {
                  set({
                    video: null,
                    shader: node.shader ?? { id: SHADERS[0].id, params: defaultParams(SHADERS[0]) },
                  });
                  return;
                }
                set({ shader: null, video: null });
                patch(paint.id, { value: PAINT_DEFAULTS[next] });
              }}
            />

            {kind === 'gradient' && (
              <>
                <div
                  style={{
                    height: 20,
                    marginTop: 6,
                    borderRadius: 4,
                    background: paint.value,
                    border: '1px solid var(--fig-line)',
                  }}
                />
                <div className="fig-row">
                  <FigSelect
                    value={
                      paint.value.startsWith('radial') ? 'radial' : paint.value.startsWith('conic') ? 'conic' : 'linear'
                    }
                    options={[
                      { value: 'linear', label: 'Linear' },
                      { value: 'radial', label: 'Radial' },
                      { value: 'conic', label: 'Angular' },
                      { value: 'solid', label: 'Solid', divider: true },
                    ]}
                    title="Paint type"
                    onChange={(next) =>
                      patch(paint.id, {
                        value: next === 'solid' ? '#D9D9D9' : GRADIENTS[next as 'linear'],
                      })
                    }
                  />
                </div>
                <div className="fig-row">
                  <FigText value={paint.value} onChange={(value) => patch(paint.id, { value })} />
                </div>
              </>
            )}

            {kind === 'image' && (
              <>
                <div className="fig-row">
                  <FigText
                    value={paint.value.replace(/^url\(|\)$/g, '')}
                    placeholder="https://…"
                    onChange={(src) => patch(paint.id, { value: `url(${src})` })}
                  />
                </div>
                <ImageFitRow
                  node={node}
                  paint={paint}
                  onPatch={(delta) => patch(paint.id, delta)}
                />
              </>
            )}
          </div>
        );
      })
      )}

      {/* Figma offers this on any frame, not only on the page — but only once
          the frame has an export setting, which is the only time the answer
          matters. A frame exported with it off gives you its contents on
          nothing. */}
      {(node.type === 'frame' || node.type === 'section') &&
        paints.length > 0 &&
        (node.exports?.length ?? 0) > 0 && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, cursor: 'default' }}
        >
          <input
            type="checkbox"
            checked={node.exportBackground !== false}
            onChange={(event) => set({ exportBackground: event.target.checked })}
            style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
          />
          <span>Show in exports</span>
        </label>
      )}
    </FigSection>
  );
}

/**
 * How an image sits in its layer, and how it has been adjusted.
 *
 * Fill and Fit need nothing else — `cover` and `contain` say it all. Crop and
 * Tile are the two that need numbers, so the scale and offset fields only
 * appear once one of those is chosen, exactly as Figma reveals them. The seven
 * adjustment sliders live behind a button for the same reason: most images are
 * used as they came.
 */
function ImageFitRow({
  node,
  paint,
  onPatch,
}: {
  node: SceneNode;
  paint: Paint;
  onPatch: (delta: Partial<Paint>) => void;
}) {
  const fit = paint.fit ?? node.imageFit ?? 'fill';
  const scale = paint.scale ?? node.imageScale ?? 1;
  const [ox, oy] = paint.offset ?? node.imageOffset ?? [50, 50];
  const setCrop = useUI((s) => s.setCropping);
  const [adjusting, setAdjusting] = useState(false);
  const adjustAnchor = useRef<HTMLSpanElement>(null);
  const adjust = paint.adjust ?? NO_ADJUST;

  return (
    <>
      <div className="fig-row">
        <FigGroup
          value={fit}
          onChange={(next) => {
            onPatch({ fit: next });
            if (next === 'crop') setCrop(node.id);
            else setCrop(null);
          }}
          options={[
            { value: 'fill', label: 'Fill', title: 'Cover the layer' },
            { value: 'fit', label: 'Fit', title: 'Fit inside the layer' },
            { value: 'crop', label: 'Crop', title: 'Scale and pan behind the layer' },
            { value: 'tile', label: 'Tile', title: 'Repeat at this size' },
          ]}
        />
        <FigButton
          title="Rotate the image a quarter turn"
          onClick={() => onPatch({ rotation: (((paint.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 })}
        >
          <Icon.Reset />
        </FigButton>
        <span ref={adjustAnchor} style={{ display: 'inline-flex' }}>
          <FigButton
            title="Adjust the image"
            on={adjusting || !isNeutral(paint.adjust)}
            onClick={() => setAdjusting((open) => !open)}
          >
            <Icon.Sliders />
          </FigButton>
          {adjusting && (
            <FigPopover anchor={adjustAnchor.current} width={244} onClose={() => setAdjusting(false)}>
              <div style={{ padding: '4px 8px 10px' }}>
                {(Object.keys(NO_ADJUST) as (keyof ImageAdjust)[]).map((key) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26 }}>
                    <span style={{ width: 84, color: 'var(--fig-icon-3)' }}>{ADJUST_LABEL[key]}</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={Math.round(adjust[key] * 100)}
                      onChange={(event) =>
                        onPatch({ adjust: { ...adjust, [key]: Number(event.target.value) / 100 } })
                      }
                      style={{ flex: 1, accentColor: 'var(--fig-blue)' }}
                    />
                    <span style={{ width: 26, textAlign: 'right' }}>
                      {Math.round(adjust[key] * 100)}
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 6 }}
                  onClick={() => onPatch({ adjust: undefined })}
                >
                  Reset adjustments
                </button>
              </div>
            </FigPopover>
          )}
        </span>
      </div>
      {(fit === 'crop' || fit === 'tile') && (
        <div className="fig-row">
          <FigField
            value={Math.round(scale * 100)}
            glyph={<Icon.Scale />}
            min={1}
            max={2000}
            suffix="%"
            title="Image scale"
            onChange={(next) => onPatch({ scale: next / 100 })}
          />
          <FigField
            value={Math.round(ox)}
            glyph="X"
            min={-200}
            max={300}
            suffix="%"
            title="Horizontal position"
            onChange={(next) => onPatch({ offset: [next, oy] })}
          />
          <FigField
            value={Math.round(oy)}
            glyph="Y"
            min={-200}
            max={300}
            suffix="%"
            title="Vertical position"
            onChange={(next) => onPatch({ offset: [ox, next] })}
          />
        </div>
      )}
      {fit === 'crop' && (
        <div className="fig-note">Drag the image on the canvas to move it inside the layer.</div>
      )}
    </>
  );
}

// ── Stroke ───────────────────────────────────────────────────────────────

function StrokeSection({
  node,
  nodes,
  set,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
}) {
  const stroke = node.border;
  // the paint and the weight disagree independently — a selection can share one
  // and not the other, and saying "Mixed" for both would be its own small lie
  const mixedPaint =
    nodes.length > 1 && !nodes.every((entry) => entry.border?.color === nodes[0].border?.color);
  const mixedWeight = shared(nodes, (entry) => entry.border?.width ?? 0);
  return (
    <FigSection
      title="Stroke"
      empty={!stroke}
      onAdd={() => set({ border: { width: 1, color: '#000000', style: 'solid', position: 'inside' } })}
      onRemove={() => set({ border: null })}
      actions={
        <StylePicker
          slot="stroke"
          node={node}
          onPickVariable={(reference) =>
            set({
              border: { width: stroke?.width ?? 1, color: reference, style: stroke?.style ?? 'solid', position: stroke?.position ?? 'inside' },
            })
          }
        />
      }
    >
      <StyleBadge node={node} slot="stroke" />
      {stroke && (
        <>
          <FigPaintRow
            color={stroke.color}
            alpha={1}
            mixed={mixedPaint}
            onColor={(color) => set({ border: { ...stroke, color } })}
            onAlpha={() => undefined}
            onVisible={() => set({ border: { ...stroke, width: stroke.width ? 0 : 1 } })}
            visible={stroke.width > 0}
            onRemove={() => set({ border: null })}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ flex: '1 1 0' }}>
              <FigLabel>Position</FigLabel>
            </span>
            <span style={{ flex: '1 1 0' }}>
              <FigLabel>Weight</FigLabel>
            </span>
            <span style={{ width: 52, flex: 'none' }} />
          </div>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={stroke.position ?? 'inside'}
              options={STROKE_POSITIONS}
              title="Stroke position"
              onChange={(position) => set({ border: { ...stroke, position } })}
            />
            <FigField
              value={mixedWeight}
              glyph={<FigIcon name="Stroke weight" />}
              min={0}
              title="Stroke weight"
              onChange={(width) => set({ border: { ...stroke, width } })}
            />
            <AdvancedStroke node={node} stroke={stroke} set={set} />
            <StrokeStyleMenu
              value={stroke.style ?? 'solid'}
              onChange={(style) => set({ border: { ...stroke, style } })}
            />
          </div>
        </>
      )}
    </FigSection>
  );
}

/** Figma tucks dash/dot behind the stroke-style button. */
function StrokeStyleMenu({
  value,
  onChange,
}: {
  value: LineStyle;
  onChange: (value: LineStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {/* its own glyph: the advanced-stroke button sits right beside this one,
          and two identical icons in a row read as one control drawn twice */}
      <FigButton title="Stroke style" on={open || value !== 'solid'} onClick={() => setOpen((v) => !v)}>
        <Icon.StrokeStyle />
      </FigButton>
      {open && (
        <>
          {/* through FigPopover: the inspector scrolls, so an absolutely placed
              menu is clipped at the panel edge */}
          <FigPopover anchor={anchor.current} width={140} onClose={() => setOpen(false)}>
            {LINE_STYLES.map((option) => (
              <FigButton
                key={option.value}
                on={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                {option.label}
              </FigButton>
            ))}
          </FigPopover>
        </>
      )}
    </span>
  );
}

// ── Shader ───────────────────────────────────────────────────────────────

function ShaderSection({ node, set }: { node: SceneNode; set: Setter }) {
  const spec = node.shader;
  const def = spec ? SHADER_BY_ID.get(spec.id) : undefined;
  const setShadersOpen = useUI((s) => s.setShadersOpen);
  if (!spec || !def) return null;

  const params = { ...defaultParams(def), ...spec.params };
  const patch = (key: string, value: number | string) =>
    set({ shader: { id: spec.id, params: { ...params, [key]: value } } });

  return (
    <FigSection
      title="Shader"
      actions={
        <FigButton title="Browse shaders" onClick={() => setShadersOpen(true)}>
          <Icon.Shader />
        </FigButton>
      }
    >
      <div className="fig-row">
        <FigSelect
          value={spec.id}
          options={SHADERS.map((s) => ({ value: s.id, label: s.name }))}
          title="Shader"
          onChange={(id) => {
            const next = SHADER_BY_ID.get(id);
            if (next) set({ shader: { id, params: defaultParams(next) } });
          }}
        />
      </div>
      {def.params.map((param) =>
        param.type === 'color' ? (
          <FigPaintRow
            key={param.key}
            color={String(params[param.key])}
            alpha={1}
            onColor={(hex) => patch(param.key, hex)}
          />
        ) : (
          <div className="fig-row" key={param.key}>
            <span style={{ flex: '0 0 68px', color: 'var(--fig-label)' }}>{param.label}</span>
            <FigField
              value={Number(params[param.key])}
              min={param.min}
              max={param.max}
              step={param.step}
              sensitivity={param.step && param.step < 1 ? 200 : 3}
              title={param.label}
              onChange={(value) => patch(param.key, value)}
            />
          </div>
        ),
      )}
    </FigSection>
  );
}

// ── Guides / Video ───────────────────────────────────────────────────────

function GuidesSection({ node, set }: { node: SceneNode; set: Setter }) {
  const guides = node.guides;
  return (
    <FigSection
      title="Layout grid"
      empty={!guides}
      onAdd={() => set({ guides: { ...DEFAULT_GUIDES } })}
      onRemove={() => set({ guides: null })}
      actions={
        <>
          {/* Figma keeps this one in the header whether or not the frame has a
              guide: applying a style is how you give it one. */}
          <StylePicker slot="grid" node={node} />
          {guides && (
            <FigButton
              title={guides.visible ? 'Hide grid' : 'Show grid'}
              onClick={() => set({ guides: { ...guides, visible: !guides.visible } })}
            >
              <Icon.Eye off={!guides.visible} />
            </FigButton>
          )}
        </>
      }
    >
      <StyleBadge node={node} slot="grid" />
      {guides && (
        <>
          <div className="fig-row">
            <FigGroup
              value={guides.type}
              onChange={(type) => set({ guides: { ...guides, type } })}
              options={[
                { value: 'columns', label: 'Columns', title: 'Columns' },
                { value: 'rows', label: 'Rows', title: 'Rows' },
                { value: 'grid', label: 'Grid', title: 'Grid' },
              ]}
            />
          </div>
          {guides.type === 'grid' ? (
            <div className="fig-row">
              <FigField value={guides.size} glyph={<Icon.Gap />} min={1} title="Size" onChange={(size) => set({ guides: { ...guides, size } })} />
              <span style={{ flex: '1 1 0' }} />
              <span style={{ width: 24, flex: 'none' }} />
            </div>
          ) : (
            <>
              <div className="fig-row">
                <FigSelect
                  value={guides.align ?? 'stretch'}
                  options={[
                    { value: 'stretch', label: 'Stretch' },
                    { value: 'start', label: guides.type === 'columns' ? 'Left' : 'Top' },
                    { value: 'center', label: 'Center' },
                    { value: 'end', label: guides.type === 'columns' ? 'Right' : 'Bottom' },
                  ]}
                  title="Type"
                  onChange={(align) => set({ guides: { ...guides, align } })}
                />
                <FigField
                  value={guides.count}
                  glyph="N"
                  min={1}
                  max={48}
                  title="Count"
                  onChange={(count) => set({ guides: { ...guides, count } })}
                />
                <span style={{ width: 24, flex: 'none' }} />
              </div>
              <div className="fig-row">
                {/* Stretch is described by its margin; the others by a width.
                    Figma shows whichever one the type actually uses. */}
                {(guides.align ?? 'stretch') === 'stretch' ? (
                  <FigField
                    value={guides.margin}
                    glyph={<Icon.PadH />}
                    min={0}
                    title="Margin"
                    onChange={(margin) => set({ guides: { ...guides, margin } })}
                  />
                ) : (
                  <FigField
                    value={guides.width ?? 64}
                    glyph="W"
                    min={1}
                    title={guides.type === 'columns' ? 'Column width' : 'Row height'}
                    onChange={(width) => set({ guides: { ...guides, width } })}
                  />
                )}
                <FigField
                  value={guides.gutter}
                  glyph={<Icon.Gap />}
                  min={0}
                  title="Gutter"
                  onChange={(gutter) => set({ guides: { ...guides, gutter } })}
                />
                <span style={{ width: 24, flex: 'none' }} />
              </div>
            </>
          )}
          <FigPaintRow color={guides.color} alpha={1} onColor={(color) => set({ guides: { ...guides, color } })} />
        </>
      )}
    </FigSection>
  );
}

function VideoSection({ node, set }: { node: SceneNode; set: Setter }) {
  const video = node.video;
  return (
    <FigSection
      title="Video"
      empty={!video}
      onAdd={() => set({ video: { src: '', loop: true, muted: true, autoplay: true, fit: 'cover' } })}
      onRemove={() => set({ video: null })}
    >
      {video && <VideoControls video={video} set={set} />}
    </FigSection>
  );
}

/**
 * Source, fit and playback. Lives apart from the section because the paint
 * picker's Video tab shows the same controls — switching a layer to video from
 * the Fill picker would otherwise leave you with nothing to set.
 */
function VideoControls({ video, set }: { video: NonNullable<SceneNode['video']>; set: Setter }) {
  return (
    <>
      <div className="fig-row">
        <FigText value={video.src} placeholder="https://…/clip.mp4" onChange={(src) => set({ video: { ...video, src } })} />
      </div>
      <div className="fig-row">
        <FigGroup
          value={video.fit}
          onChange={(fit) => set({ video: { ...video, fit } })}
          options={[
            { value: 'cover', label: 'Fill', title: 'Fill' },
            { value: 'contain', label: 'Fit', title: 'Fit' },
          ]}
        />
      </div>
      <div className="fig-row" style={{ gap: 10 }}>
        {(['autoplay', 'loop', 'muted'] as const).map((key) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
            <input
              type="checkbox"
              checked={video[key]}
              onChange={(e) => set({ video: { ...video, [key]: e.target.checked } })}
              style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
            />
            <span style={{ color: 'var(--fig-label)', textTransform: 'capitalize' }}>{key}</span>
          </label>
        ))}
      </div>
    </>
  );
}

/**
 * The shader chooser alone. Its parameters stay in the Shader section: a paint
 * row inside the picker would open a second picker on top of the first.
 */
function ShaderChooser({ spec, set }: { spec: NonNullable<SceneNode['shader']>; set: Setter }) {
  return (
    <div className="fig-row" style={{ marginTop: 0 }}>
      <FigSelect
        value={spec.id}
        options={SHADERS.map((entry) => ({ value: entry.id, label: entry.name }))}
        title="Shader"
        onChange={(id) => {
          const next = SHADER_BY_ID.get(id);
          if (next) set({ shader: { id, params: defaultParams(next) } });
        }}
      />
    </div>
  );
}

// ── Selection colors ─────────────────────────────────────────────────────

/**
 * Figma lists every colour used inside the selection and lets you jump to the
 * layers using it — handy for spotting a stray hex before it ships.
 *
 * The rows read like Fill's, with one difference: the opacity sits in a field
 * box of its own. Long lists are cut to ten with a "See all N colors" footer,
 * so a busy selection cannot push Export off the bottom of the panel.
 */
function SelectionColors() {
  const doc = useDoc();
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const [expanded, setExpanded] = useState(false);

  /** every colour in the selection, keyed by hex so `#fff` and `#FFF` are one row */
  const usage = new Map<string, { color: string; alpha: number; ids: Set<string> }>();
  const note = (value: string | null | undefined, alpha: number, id: string) => {
    if (!value || /gradient\(|^url\(/.test(value)) return;
    const key = value.toUpperCase();
    // a colour used at two opacities reports the first; Figma does the same
    const entry = usage.get(key) ?? { color: value, alpha, ids: new Set<string>() };
    entry.ids.add(id);
    usage.set(key, entry);
  };

  const walk = (id: string) => {
    const node = doc[id];
    if (!node) return;
    // the fill stack is the source of truth when a layer has one
    if (node.fills?.length) {
      for (const paint of node.fills) {
        if (paint.visible !== false) note(paint.value, paint.opacity ?? 1, id);
      }
    } else if (node.fillVisible !== false) {
      note(node.fill, node.fillOpacity ?? 1, id);
    }
    note(node.border?.color, 1, id);
    note(node.font?.color, 1, id);
    node.children.forEach(walk);
  };
  selection.forEach(walk);

  const entries = [...usage.values()];
  if (entries.length < 2) return null;

  const shown = expanded ? entries : entries.slice(0, SELECTION_COLOR_LIMIT);

  /** rewrites `color` wherever it is used, whichever property carries it */
  const recolor = (from: string, to: string) =>
    store.updateMany([...(usage.get(from.toUpperCase())?.ids ?? [])], (n) => {
      const patch: Partial<SceneNode> = {};
      const same = (value?: string | null) => !!value && value.toUpperCase() === from.toUpperCase();
      if (n.fills?.length && n.fills.some((p) => same(p.value))) {
        const fills = n.fills.map((p) => (same(p.value) ? { ...p, value: to } : p));
        Object.assign(patch, { fills, fill: fills[0]?.value ?? n.fill });
      } else if (same(n.fill)) patch.fill = to;
      if (same(n.border?.color)) patch.border = { ...n.border!, color: to };
      if (same(n.font?.color)) patch.font = { ...n.font!, color: to };
      return patch;
    });

  /** opacity lives on the fill stack, so only fills follow the % field */
  const reopacity = (color: string, alpha: number) =>
    store.updateMany([...(usage.get(color.toUpperCase())?.ids ?? [])], (n) => {
      const same = (value?: string | null) => !!value && value.toUpperCase() === color.toUpperCase();
      if (n.fills?.length && n.fills.some((p) => same(p.value))) {
        return { fills: n.fills.map((p) => (same(p.value) ? { ...p, opacity: alpha } : p)) };
      }
      return same(n.fill) ? { fillOpacity: alpha } : {};
    });

  return (
    <FigSection title="Selection colors">
      {shown.map(({ color, alpha, ids }) => (
        <FigPaintRow
          key={color}
          color={color}
          alpha={alpha}
          alphaField
          onColor={(next) => recolor(color, next)}
          onAlpha={(next) => reopacity(color, next)}
          trailing={
            <FigButton
              title={`Select the ${ids.size} layer${ids.size === 1 ? '' : 's'} using this color`}
              onClick={() => select([...ids])}
            >
              <Icon.Move />
            </FigButton>
          }
        />
      ))}
      {entries.length > SELECTION_COLOR_LIMIT && (
        <button type="button" className="fig-more" onClick={() => setExpanded((v) => !v)}>
          <span className="fig-more-dots">
            <Icon.Dots />
          </span>
          {expanded ? 'Show fewer colors' : `See all ${entries.length} colors`}
        </button>
      )}
    </FigSection>
  );
}

/** how many colours the section lists before it collapses behind "See all" */
const SELECTION_COLOR_LIMIT = 10;

// ── Export ───────────────────────────────────────────────────────────────

/**
 * Figma's Export section, at the foot of the Design tab.
 *
 * The button names the *kind* of thing you are exporting — "Export Frame",
 * "Export Section" — not its layer name, because what you are about to get is
 * decided by the type: a frame exports its whole subtree, a shape exports
 * itself. A multi-selection says how many instead.
 */
function ExportSection({
  node,
  nodes,
  set,
  onExport,
}: {
  node: SceneNode;
  nodes: SceneNode[];
  set: Setter;
  onExport: () => void;
}) {
  const doc = useDoc();
  const tokens = useTokens();
  const collections = useCollections();
  const tokenVars = useTokenVars();
  const zoom = useUI((s) => s.viewport.zoom);
  const selection = useUI((s) => s.selection);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // the settings live on the layer, so a design carries how it ships
  const rows = node.exports ?? [];
  const write = (next: ExportSetting[]) => set({ exports: next });
  const target = selection.length > 1 ? `${selection.length} layers` : TYPE_LABEL[node.type];

  return (
    <FigSection
      title="Export"
      actions={
        <FigButton
          title="Add export settings"
          onClick={() =>
            write([
              ...rows,
              { id: Math.random().toString(36).slice(2, 8), scale: rows.length ? 1 : 2, format: 'png' },
            ])
          }
        >
          <FigIcon name="Add fill" />
        </FigButton>
      }
    >
      {rows.map((row) => (
        <div className="fig-row" key={row.id}>
          <FigSelect
            value={String(row.scale)}
            options={[0.5, 1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}x` }))}
            title="Scale"
            onChange={(value) =>
              write(rows.map((r) => (r.id === row.id ? { ...r, scale: Number(value) } : r)))
            }
          />
          <FigSelect
            value={row.format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'pdf', label: 'PDF' },
              { value: 'svg', label: 'SVG' },
              { value: 'react', label: 'React', divider: true },
              { value: 'html', label: 'HTML' },
              { value: 'json', label: 'JSON' },
            ]}
            title="Format"
            onChange={(format) =>
              write(rows.map((r) => (r.id === row.id ? { ...r, format } : r)))
            }
          />
          <ExportOptions
            row={row}
            onChange={(patch) => write(rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)))}
          />
          <FigButton title="Remove" onClick={() => write(rows.filter((r) => r.id !== row.id))}>
            <FigIcon name="Remove" />
          </FigButton>
        </div>
      ))}

      <div className="fig-row">
        <button
          type="button"
          className="fig-export"
          onClick={async () => {
            // Figma's Export button opens nothing: it saves what the rows say.
            // A layer with no settings of its own falls back to the dialog.
            if (!rows.length) {
              onExport();
              return;
            }
            setStatus('Saving…');
            const result = await runExports(selection.length ? selection : [node.id], {
              doc,
              tokens,
              collections,
              tokenVars,
              zoom,
            });
            setStatus(
              result.error ??
                `Saved ${result.saved} file${result.saved === 1 ? '' : 's'} to your downloads.`,
            );
            window.setTimeout(() => setStatus(null), 4000);
          }}
        >
          Export {target}
        </button>
      </div>
      {status && <div className="fig-note">{status}</div>}

      <button
        type="button"
        className="fig-btn"
        aria-expanded={preview}
        style={{ marginTop: 6, padding: 0, gap: 6, color: 'var(--fig-dim)' }}
        onClick={() => setPreview((v) => !v)}
      >
        <span style={{ display: 'inline-flex', transform: preview ? 'rotate(90deg)' : undefined }}>
          <Icon.Chevron />
        </span>
        Preview
      </button>
      {preview && <ExportPreview id={node.id} />}
    </FigSection>
  );
}

/**
 * A live thumbnail of what the export will produce.
 *
 * It serialises the very element the canvas is rendering, which is the same
 * path the real export takes — so the preview cannot promise something the
 * saved file does not deliver. Re-runs whenever the layer or the document
 * changes, which is what keeps it in step with the selection.
 */
function ExportPreview({ id }: { id: string }) {
  const doc = useDoc();
  const zoom = useUI((s) => s.viewport.zoom);
  const tokenVars = useTokenVars();
  const [image, setImage] = useState<{ src: string; w: number; h: number } | null>(null);

  useEffect(() => {
    // wait a frame: a layer that just changed has not been laid out yet
    const frame = requestAnimationFrame(() => {
      const serialised = nodeToSvg(id, zoom, tokenVars as Record<string, string>);
      setImage(
        serialised
          ? {
              src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised.svg)}`,
              w: serialised.width,
              h: serialised.height,
            }
          : null,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [id, doc, zoom, tokenVars]);

  return (
    <div className="fig-export-preview">
      {image ? (
        <>
          <img src={image.src} alt="Export preview" />
          <span className="fig-export-size">
            {image.w} × {image.h}
          </span>
        </>
      ) : (
        <span style={{ color: 'var(--fig-dim)' }}>Scroll the layer into view to preview it.</span>
      )}
    </div>
  );
}
