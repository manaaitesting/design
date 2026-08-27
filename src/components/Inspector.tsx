'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import {
  FigBlendMenu,
  FigButton,
  FigField,
  FigGroup,
  FigGroupSet,
  FigLabel,
  FigPaintRow,
  FigPopover,
  FigSection,
  FigSelect,
  FigText,
  type FigOption,
} from './ui/Figma';
import { EffectsSection } from './EffectsSection';
import { InstancePropsSection, PropBindingRow, PropertiesSection } from './ComponentProps';
import { StyleBadge, StylePicker } from './StylePicker';
import { VariableMenu, variableLabel } from './VariablePicker';
import { Presence } from './Presence';
import { useDoc, useStore, useTokens, useTokenVars, useVarNames } from './Session';
import { useUI } from '../state/ui';
import { resolveColor } from './ui/color';
import { measureChildren } from '../lib/measure';
import { DEFAULT_FONT, DEFAULT_GUIDES, TYPE_LABEL } from '../document/defaults';
import { nodeToSvg } from '../export/raster';
import { defaultParams, SHADER_BY_ID, SHADERS } from '../webgl/shaders';
import {
  descendants,
  isCanvasRoot,
  ROOT_ID,
  type Easing,
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
  type Paint,
  type SceneNode,
  type SizeMode,
} from '../document/types';
import type { PaintType } from './ui/PaintPicker';
import {
  destinationsOn,
  flowsOn,
  interactionsOf,
  nextFlowName,
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

const FONT_FAMILIES: FigOption<string>[] = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'ui-serif, Georgia, serif', label: 'Georgia' },
  { value: 'ui-monospace, SFMono-Regular, monospace', label: 'SF Mono' },
];

const FONT_WEIGHTS: FigOption<string>[] = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi Bold' },
  { value: '700', label: 'Bold' },
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

  const nodes = selection.map((id) => doc[id]).filter(Boolean) as SceneNode[];
  const node = nodes[0];
  const set: Setter = (patch) => store.updateMany(selection, patch);

  return (
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
      </div>

      {tab === 'prototype' ? (
        <PrototypeTab node={node} />
      ) : (
        <div className="scroll" style={{ flex: 1 }}>
          {!node ? (
            <PageSection />
          ) : (
            <>
              <LayerHeader node={node} />
              <ComponentSection node={node} />
              <PropertiesSection node={node} />
              <InstancePropsSection node={node} />
              <PositionSection node={node} nodes={nodes} set={set} />
              <LayoutSection node={node} nodes={nodes} set={set} />
              <AppearanceSection node={node} nodes={nodes} set={set} />
              {node.type === 'text' && <TypographySection node={node} set={set} />}
              {node.type === 'shader' && <ShaderSection node={node} set={set} />}
              {node.type !== 'shader' && <FillSection node={node} nodes={nodes} set={set} />}
              <StrokeSection node={node} nodes={nodes} set={set} />
              <EffectsSection node={node} set={set} />
              <SelectionColors />
              {node.type === 'frame' && <GuidesSection node={node} set={set} />}
              {node.type === 'frame' && <VideoSection node={node} set={set} />}
              <ExportSection node={node} onExport={() => setExportOpen(true)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Layer header ─────────────────────────────────────────────────────────

function LayerHeader({ node }: { node: SceneNode }) {
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const setContextMenu = useUI((s) => s.setContextMenu);
  const doc = useDoc();
  const [draft, setDraft] = useState<string | null>(null);
  // Figma names the count, not the first layer — a name field showing one of
  // several is an invitation to rename the wrong thing
  const many = selection.length > 1;
  const selectedNames = selection
    .map((id) => doc[id]?.name)
    .filter(Boolean)
    .join(', ');

  return (
    <div className="fig-section" style={{ paddingBottom: 8 }}>
      <div className="fig-row" style={{ marginTop: 8 }}>
        <input
          value={draft ?? (many ? `${selection.length} layers` : node.name)}
          spellCheck={false}
          disabled={many}
          title={many ? selectedNames : node.name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            setDraft(null);
            const value = e.target.value.trim();
            if (value) store.update(node.id, { name: value });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontSize: 13,
            fontWeight: 550,
            color: 'var(--fig-ink)',
          }}
        />
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
        <FigButton
          title="Group selection"
          onClick={() => {
            const id = store.group(selection);
            if (id) select([id]);
          }}
        >
          <Icon.Frame />
        </FigButton>
        <FigButton
          title="Ungroup"
          disabled={!node.children.length}
          onClick={() => {
            const freed = store.ungroup(selection);
            if (freed.length) select(freed);
          }}
        >
          <FigIcon name="Individual strokes" />
        </FigButton>
        <FigButton
          title="Duplicate"
          onClick={() => select(store.duplicate(selection))}
        >
          <Icon.Copy />
        </FigButton>
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

function PageSection() {
  const doc = useDoc();
  const store = useStore();
  const pageId = useUI((s) => s.page);
  const page = doc[pageId] ?? doc[ROOT_ID];
  if (!page) return null;

  return (
    <FigSection title="Page">
      <FigPaintRow
        color={page.fill ?? '#EEEEEE'}
        alpha={1}
        onColor={(fill) => store.update(page.id, { fill })}
      />
    </FigSection>
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

      {!node && flows.length === 0 && (
        <div style={{ padding: '4px 16px 12px', color: 'var(--fig-dim)', lineHeight: 1.5 }}>
          Select a layer to give it an interaction, or drag the blue handle on a
          selected layer onto the frame it should open.
        </div>
      )}
    </div>
  );
}

const TRIGGERS: FigOption<Trigger>[] = [
  { value: 'click', label: 'On click' },
  { value: 'hover', label: 'While hovering' },
  { value: 'press', label: 'While pressing' },
  { value: 'delay', label: 'After delay' },
];

const ACTIONS: FigOption<InteractionAction>[] = [
  { value: 'navigate', label: 'Navigate to' },
  { value: 'back', label: 'Back' },
  { value: 'url', label: 'Open link' },
  { value: 'none', label: 'None' },
];

const TRANSITIONS: FigOption<TransitionType>[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'move', label: 'Move in' },
  { value: 'push', label: 'Push' },
  { value: 'slide', label: 'Slide in' },
];

const DIRECTIONS: FigOption<TransitionDirection>[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

const EASINGS: FigOption<Easing>[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in and out' },
];

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
  const set = (patch: Partial<Interaction>) =>
    store.updateInteraction(node.id, interaction.id, patch);
  const moves = interaction.transition.type !== 'instant' && interaction.transition.type !== 'dissolve';

  return (
    <div className="fig-interaction">
      <div className="fig-row">
        <FigSelect
          value={interaction.trigger}
          options={TRIGGERS}
          onChange={(trigger) => set({ trigger })}
        />
        <FigButton
          title="Remove interaction"
          onClick={() => store.removeInteraction(node.id, interaction.id)}
        >
          <Icon.Minus />
        </FigButton>
      </div>

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

      <FigLabel>Action</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={interaction.action}
          options={ACTIONS}
          onChange={(action) => set({ action })}
        />
      </div>

      {interaction.action === 'navigate' && (
        <>
          <FigLabel>Destination</FigLabel>
          <div className="fig-row" style={{ marginTop: 0 }}>
            <FigSelect
              value={interaction.destination ?? ''}
              options={[
                { value: '', label: 'Pick a frame' },
                ...frames.map((frame) => ({ value: frame.id, label: frame.name })),
              ]}
              onChange={(destination) => set({ destination: destination || null })}
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
            <div className="fig-row">
              <FigSelect
                value={interaction.transition.easing}
                options={EASINGS}
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
          )}
        </>
      )}
    </div>
  );
}

// ── Position ─────────────────────────────────────────────────────────────

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
              Tidy up
            </FigButton>
            <div style={{ height: 1, background: 'var(--fig-line)', margin: '4px 6px' }} />
            {(
              [
                ['horizontal', 'Distribute horizontal spacing'],
                ['vertical', 'Distribute vertical spacing'],
              ] as const
            ).map(([axis, label]) => (
              <FigButton
                key={axis}
                disabled={selection.length < 3}
                onClick={() => {
                  store.distribute(selection, axis);
                  setMenu(false);
                }}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                {label}
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
  title?: string;
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

function TypographySection({ node, set }: { node: SceneNode; set: Setter }) {
  const font = node.font ?? DEFAULT_FONT;
  const patch = (delta: Partial<typeof font>) => set({ font: { ...font, ...delta } });
  const [more, setMore] = useState(false);

  return (
    <FigSection
      title="Typography"
      actions={
        <>
          <StylePicker slot="text" node={node} />
          <FigButton title="Type details" on={more} onClick={() => setMore((v) => !v)}>
            <Icon.Sliders />
          </FigButton>
        </>
      }
    >
      <StyleBadge node={node} slot="text" />
      <div className="fig-row">
        <FigSelect value={font.family} options={FONT_FAMILIES} title="Font" onChange={(family) => patch({ family })} />
      </div>
      <div className="fig-row">
        <FigSelect
          value={String(font.weight)}
          options={FONT_WEIGHTS}
          title="Weight"
          onChange={(weight) => patch({ weight: Number(weight) })}
        />
        <FigField
          value={font.size}
          glyph={<Icon.FontSize />}
          min={1}
          title="Size"
          onChange={(size) => patch({ size })}
        />
      </div>
      <div className="fig-row">
        <FigField
          value={Math.round(font.lineHeight * font.size)}
          glyph={<Icon.LineHeight />}
          min={0}
          title="Line height"
          onChange={(px) => patch({ lineHeight: px / Math.max(font.size, 1) })}
        />
        <FigField
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
      </div>

      <div className="fig-row">
        <FigGroup
          value={font.case ?? 'none'}
          onChange={(value) => patch({ case: value })}
          options={[
            { value: 'none', label: <Icon.TextCase at="none" />, title: 'As typed' },
            { value: 'upper', label: <Icon.TextCase at="upper" />, title: 'Uppercase' },
            { value: 'lower', label: <Icon.TextCase at="lower" />, title: 'Lowercase' },
            { value: 'title', label: <Icon.TextCase at="title" />, title: 'Title case' },
          ]}
        />
        <FigField
          value={font.maxLines ?? 0}
          glyph={<Icon.Truncate />}
          min={0}
          max={99}
          title="Truncate after this many lines — 0 keeps them all"
          onChange={(maxLines) => patch({ maxLines })}
        />
      </div>

      {more && (
        <>
          <div className="fig-row">
            <FigText value={node.text ?? ''} onChange={(text) => set({ text })} placeholder="Content" />
          </div>
          <div className="fig-row">
            <FigField
              value={font.paragraphSpacing ?? 0}
              glyph={<Icon.LineHeight />}
              min={0}
              title="Paragraph spacing"
              onChange={(paragraphSpacing) => patch({ paragraphSpacing })}
            />
            <FigSelect
              value={font.list ?? 'none'}
              options={[
                { value: 'none', label: 'No list' },
                { value: 'bullet', label: 'Bulleted' },
                { value: 'number', label: 'Numbered' },
              ]}
              title="List style"
              onChange={(list) => patch({ list })}
            />
          </div>
          <div className="fig-row">
            <FigSelect
              value={
                !node.underline
                  ? 'none'
                  : node.underline.line === 'strikethrough'
                    ? 'strike'
                    : node.underline.style
              }
              options={[
                { value: 'none', label: 'No decoration' },
                { value: 'solid', label: 'Underline' },
                { value: 'double', label: 'Double' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
                { value: 'wavy', label: 'Wavy' },
                { value: 'strike', label: 'Strikethrough', divider: true },
              ]}
              title="Decoration"
              onChange={(value) =>
                set({
                  underline:
                    value === 'none'
                      ? null
                      : {
                          line: value === 'strike' ? 'strikethrough' : 'underline',
                          style:
                            value === 'strike'
                              ? 'solid'
                              : (value as NonNullable<SceneNode['underline']>['style']),
                          color: node.underline?.color ?? font.color,
                          thickness: node.underline?.thickness ?? 1,
                          offset: node.underline?.offset ?? 2,
                        },
                })
              }
            />
          </div>
          <div className="fig-row">
            <FigField
              value={node.textStroke?.width ?? 0}
              glyph={<Icon.Square />}
              min={0}
              step={0.5}
              title="Text stroke width"
              onChange={(width) =>
                set({
                  textStroke: width
                    ? { width, color: node.textStroke?.color ?? '#000000' }
                    : null,
                })
              }
            />
            {node.textStroke && (
              <FigText
                value={node.textStroke.color}
                onChange={(color) => set({ textStroke: { ...node.textStroke!, color } })}
              />
            )}
          </div>
        </>
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

/** Every solid colour already used on the page, newest first — Figma's "On this page". */
function pageColors(doc: Doc, page: string): string[] {
  const seen = new Set<string>();
  for (const id of descendants(page, doc)) {
    const node = doc[id];
    for (const paint of node?.fills ?? (node?.fill ? [{ value: node.fill }] : [])) {
      const value = (paint as { value: string }).value;
      if (/^#[0-9a-fA-F]{6}$/.test(value)) seen.add(value.toUpperCase());
    }
    if (node?.border?.color && /^#[0-9a-fA-F]{6}$/.test(node.border.color)) {
      seen.add(node.border.color.toUpperCase());
    }
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
  const tokens = useTokens();
  const doc = useDoc();
  const store = useStore();
  const page = useUI((state) => state.page);
  const swatches = pageColors(doc, page);
  const backdrop = backdropOf(node, doc, tokens);
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
        paints.length ? (
          <StylePicker
            slot="fill"
            node={node}
            onPickVariable={(reference) => patch(paints[0].id, { value: reference })}
          />
        ) : undefined
      }
    >
      <StyleBadge node={node} slot="fill" />
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
                const name = `color-${tokens.length + 1}`;
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
              <div className="fig-row">
                <FigText
                  value={paint.value.replace(/^url\(|\)$/g, '')}
                  placeholder="https://…"
                  onChange={(src) => patch(paint.id, { value: `url(${src})` })}
                />
              </div>
            )}
          </div>
        );
      })
      )}
    </FigSection>
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
        guides ? (
          <FigButton
            title={guides.visible ? 'Hide grid' : 'Show grid'}
            onClick={() => set({ guides: { ...guides, visible: !guides.visible } })}
          >
            <Icon.Eye off={!guides.visible} />
          </FigButton>
        ) : undefined
      }
    >
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
function ExportSection({ node, onExport }: { node: SceneNode; onExport: () => void }) {
  const rows = useUI((s) => s.exportRows);
  const addRow = useUI((s) => s.addExportRow);
  const updateRow = useUI((s) => s.updateExportRow);
  const removeRow = useUI((s) => s.removeExportRow);
  const setFormat = useUI((s) => s.setExportFormat);
  const setScale = useUI((s) => s.setExportScale);
  const setSuffix = useUI((s) => s.setExportSuffix);
  const setContentsOnly = useUI((s) => s.setExportContentsOnly);
  const selection = useUI((s) => s.selection);
  const [preview, setPreview] = useState(false);

  const target = selection.length > 1 ? `${selection.length} layers` : TYPE_LABEL[node.type];

  return (
    <FigSection
      title="Export"
      actions={
        <FigButton title="Add export settings" onClick={addRow}>
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
            onChange={(value) => updateRow(row.id, { scale: Number(value) })}
          />
          <FigSelect
            value={row.format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'svg', label: 'SVG' },
              { value: 'react', label: 'React', divider: true },
              { value: 'html', label: 'HTML' },
              { value: 'json', label: 'JSON' },
            ]}
            title="Format"
            onChange={(format) => updateRow(row.id, { format })}
          />
          <ExportOptions row={row} onChange={(patch) => updateRow(row.id, patch)} />
          <FigButton title="Remove" onClick={() => removeRow(row.id)}>
            <FigIcon name="Remove" />
          </FigButton>
        </div>
      ))}

      <div className="fig-row">
        <button
          type="button"
          className="fig-export"
          onClick={() => {
            // the first row is what the button acts on, as in Figma
            const first = rows[0];
            if (first) {
              setScale(first.scale);
              setFormat(first.format);
              setSuffix(first.suffix ?? '');
              setContentsOnly(!!first.contentsOnly);
            }
            onExport();
          }}
        >
          Export {target}
        </button>
      </div>

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
