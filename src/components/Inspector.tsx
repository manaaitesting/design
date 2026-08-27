'use client';

import { useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import {
  FigButton,
  FigField,
  FigGroup,
  FigGroupSet,
  FigLabel,
  FigPaintRow,
  FigSection,
  FigSelect,
  FigText,
  FigTokenPicker,
  type FigOption,
} from './ui/Figma';
import { Presence } from './Presence';
import { useDoc, useStore, useTokens, useTokenVars } from './Session';
import { useUI } from '../state/ui';
import { DEFAULT_FILTERS, DEFAULT_FLEX, DEFAULT_FONT, DEFAULT_GUIDES } from '../document/defaults';
import { defaultParams, SHADER_BY_ID, SHADERS } from '../webgl/shaders';
import {
  descendants,
  ROOT_ID,
  type Easing,
  type Interaction,
  type InteractionAction,
  type TransitionDirection,
  type TransitionType,
  type Trigger,
  type Align,
  type Doc,
  type Justify,
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

const BLEND_MODES: FigOption<string>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken', divider: true },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-burn', label: 'Color burn' },
  { value: 'lighten', label: 'Lighten', divider: true },
  { value: 'screen', label: 'Screen' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'plus-lighter', label: 'Plus lighter' },
  { value: 'overlay', label: 'Overlay', divider: true },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'difference', label: 'Difference', divider: true },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue', divider: true },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

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
              <PositionSection node={node} set={set} />
              <LayoutSection node={node} set={set} />
              <AppearanceSection node={node} set={set} />
              {node.type === 'text' && <TypographySection node={node} set={set} />}
              {node.type === 'shader' && <ShaderSection node={node} set={set} />}
              {node.type !== 'shader' && <FillSection node={node} set={set} />}
              <StrokeSection node={node} set={set} />
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
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="fig-section" style={{ paddingBottom: 8 }}>
      <div className="fig-row" style={{ marginTop: 8 }}>
        <input
          value={draft ?? node.name}
          spellCheck={false}
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
            <FigButton
              style={{ flex: 1, justifyContent: 'flex-start', color: '#9747FF' }}
              onClick={() => main && select([main.id])}
            >
              {main ? main.name : 'main component missing'}
            </FigButton>
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

function PositionSection({ node, set }: { node: SceneNode; set: Setter }) {
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const [menu, setMenu] = useState(false);

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
        <FigButton title="More actions" on={menu} onClick={() => setMenu((v) => !v)}>
          <Icon.Dots />
        </FigButton>

        {menu && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 28,
              width: 200,
              background: '#fff',
              borderRadius: 6,
              padding: 4,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
              zIndex: 70,
            }}
          >
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
          </div>
        )}
      </div>
      </FigGroupSet>

      <FigGroupSet legend="Position">
      <div className="fig-row">
        <FigField value={node.x} glyph="X" title="X-position" onChange={(x) => set({ x })} />
        <FigField value={node.y} glyph="Y" title="Y-position" onChange={(y) => set({ y })} />
        <span style={{ width: 24, flex: 'none' }} />
      </div>
      </FigGroupSet>

      <FigGroupSet legend="Rotation">
      <div className="fig-row">
        <FigField
          value={node.rotation}
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

// ── Layout (size) ────────────────────────────────────────────────────────

function LayoutSection({ node, set }: { node: SceneNode; set: Setter }) {
  const sizable = node.type === 'frame' || node.type === 'text';
  // hugging is only meaningful when there is content to hug
  const canHug = node.type === 'text' || node.children.length > 0;
  const sizeModes = canHug ? SIZE_MODES : SIZE_MODES.filter((m) => m.value !== 'fit');

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span>Layout</span>
        <FigButton
          title="Resize to fit"
          disabled={!canHug}
          onClick={() => set({ wMode: 'fit', hMode: 'fit' })}
        >
          <FigIcon name="Edit object" />
        </FigButton>
        {sizable && (
          <FigButton
            title="Use auto layout"
            on={!!node.flex}
            onClick={() => set({ flex: node.flex ? null : { ...DEFAULT_FLEX } })}
          >
            <Icon.Frame />
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
                data-on={!node.flex ? 'true' : undefined}
                onClick={() => set({ flex: null })}
              >
                <Icon.Freeform />
              </button>
              <button
                type="button"
                title="Vertical"
                aria-label="Vertical"
                data-on={node.flex?.mode !== 'grid' && node.flex?.direction === 'column' ? 'true' : undefined}
                onClick={() =>
                  set({ flex: { ...(node.flex ?? DEFAULT_FLEX), mode: 'flex', direction: 'column', wrap: false } })
                }
              >
                <Icon.ArrowDown />
              </button>
              <button
                type="button"
                title="Horizontal"
                aria-label="Horizontal"
                data-on={node.flex?.mode !== 'grid' && node.flex?.direction === 'row' ? 'true' : undefined}
                onClick={() =>
                  set({ flex: { ...(node.flex ?? DEFAULT_FLEX), mode: 'flex', direction: 'row', wrap: false } })
                }
              >
                <Icon.ArrowRight />
              </button>
              <button
                type="button"
                title="Grid"
                aria-label="Grid"
                data-on={node.flex?.mode === 'grid' ? 'true' : undefined}
                onClick={() => set({ flex: { ...(node.flex ?? DEFAULT_FLEX), mode: 'grid' } })}
              >
                <Icon.GridFlow />
              </button>
            </div>
            <span style={{ width: 24, flex: 'none' }} />
          </div>
          </FigGroupSet>
          {node.flex && <AutoLayoutControls node={node} set={set} />}
        </>
      )}

      <FigGroupSet legend="Dimensions">
      <div className="fig-row">
        <FigField
          value={node.w}
          glyph="W"
          min={1}
          title="Width"
          onChange={(w) => set({ w, wMode: 'fixed' })}
          onApplyVariable={() => undefined}
        />
        <FigField
          value={node.h}
          glyph="H"
          min={1}
          title="Height"
          onChange={(h) => set({ h, hMode: 'fixed' })}
          onApplyVariable={() => undefined}
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

      {sizable && (
        <div className="fig-row">
          <FigSelect
            value={node.wMode}
            options={sizeModes}
            glyph="W"
            title="Horizontal resizing"
            onChange={(wMode) => set({ wMode })}
          />
          <FigSelect
            value={node.hMode}
            options={sizeModes}
            glyph="H"
            title="Vertical resizing"
            onChange={(hMode) => set({ hMode })}
          />
          <span style={{ width: 24, flex: 'none' }} />
        </div>
      )}

      <ConstraintsRow node={node} set={set} />

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
 * Constraints only mean something for an absolutely placed child, so the row
 * hides itself for anything a layout already owns.
 */
function ConstraintsRow({ node, set }: { node: SceneNode; set: Setter }) {
  const doc = useDoc();
  const parent = node.parent ? doc[node.parent] : null;
  if (!parent || parent.type === 'page' || parent.flex) return null;

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
  const patch = (delta: Partial<typeof flex>) => set({ flex: { ...flex, ...delta } });
  const [top, right, bottom, left] = flex.padding;

  return (
    <>
      <div className="fig-row">
        <AlignGrid node={node} onChange={(align, justify) => patch({ align, justify })} />
        {flex.mode === 'grid' && (
          <FigField
            value={flex.columns ?? 2}
            glyph="C"
            min={1}
            max={12}
            title="Columns"
            onChange={(columns) => patch({ columns })}
          />
        )}
        <span style={{ width: 24, flex: 'none' }} />
      </div>

      <div className="fig-row">
        <FigField
          value={flex.gap}
          glyph={<Icon.Gap />}
          min={0}
          title="Gap between items"
          onChange={(gap) => patch({ gap })}
        />
        <FigField
          value={left === right ? left : 'mixed'}
          glyph={<Icon.PadH />}
          min={0}
          title="Horizontal padding"
          onChange={(value) => patch({ padding: [top, value, bottom, value] })}
        />
        <span style={{ width: 24, flex: 'none' }} />
      </div>

      <div className="fig-row">
        <FigField
          value={top === bottom ? top : 'mixed'}
          glyph={<Icon.PadV />}
          min={0}
          title="Vertical padding"
          onChange={(value) => patch({ padding: [value, right, value, left] })}
        />
        <FigSelect
          value={flex.justify}
          options={[
            { value: 'start', label: 'Packed' },
            { value: 'between', label: 'Space between' },
            { value: 'center', label: 'Center' },
            { value: 'end', label: 'End' },
          ]}
          title="Distribution"
          onChange={(justify) => patch({ justify: justify as Justify })}
        />
        <span style={{ width: 24, flex: 'none' }} />
      </div>

      <PaddingPerSide flex={flex} patch={patch} />
    </>
  );
}

function PaddingPerSide({
  flex,
  patch,
}: {
  flex: NonNullable<SceneNode['flex']>;
  patch: (delta: Partial<NonNullable<SceneNode['flex']>>) => void;
}) {
  const [top, right, bottom, left] = flex.padding;
  const [open, setOpen] = useState(top !== bottom || left !== right);

  return (
    <>
      <div className="fig-row">
        <FigButton title="Padding per side" on={open} onClick={() => setOpen((v) => !v)} style={{ flex: 1 }}>
          <FigIcon name="Individual corners" />
          <span style={{ marginLeft: 4 }}>Individual padding</span>
        </FigButton>
      </div>
      {open && (
        <>
          <div className="fig-row">
            <FigField value={top} glyph="T" min={0} title="Top" onChange={(v) => patch({ padding: [v, right, bottom, left] })} />
            <FigField value={right} glyph="R" min={0} title="Right" onChange={(v) => patch({ padding: [top, v, bottom, left] })} />
          </div>
          <div className="fig-row">
            <FigField value={bottom} glyph="B" min={0} title="Bottom" onChange={(v) => patch({ padding: [top, right, v, left] })} />
            <FigField value={left} glyph="L" min={0} title="Left" onChange={(v) => patch({ padding: [top, right, bottom, v] })} />
          </div>
        </>
      )}
    </>
  );
}

/** Figma's 3×3 alignment picker; which axis is which follows flex-direction. */
function AlignGrid({
  node,
  onChange,
}: {
  node: SceneNode;
  onChange: (align: Align, justify: Justify) => void;
}) {
  const flex = node.flex!;
  const isRow = flex.direction === 'row';
  const axis = ['start', 'center', 'end'] as const;
  const activeCol = isRow ? axis.indexOf(flex.justify as never) : axis.indexOf(flex.align as never);
  const activeRow = isRow ? axis.indexOf(flex.align as never) : axis.indexOf(flex.justify as never);

  return (
    <div
      title="Alignment"
      style={{
        flex: '1 1 0',
        height: 24,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        borderRadius: 5,
        background: 'var(--fig-hover)',
        padding: 3,
      }}
    >
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const on = row === activeRow && col === activeCol;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
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
              }}
            >
              <span
                style={{
                  width: on ? 7 : 2.5,
                  height: 2.5,
                  borderRadius: 2,
                  background: on ? 'var(--fig-blue)' : 'rgba(0,0,0,0.25)',
                }}
              />
            </button>
          );
        }),
      )}
    </div>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────

function AppearanceSection({ node, set }: { node: SceneNode; set: Setter }) {
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
          <BlendMenu value={node.blend} onChange={(blend) => set({ blend })} />
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
        <FigField
          value={Math.round(node.opacity * 100)}
          glyph={<Icon.Opacity />}
          suffix="%"
          min={0}
          max={100}
          title="Opacity"
          onChange={(value) => set({ opacity: value / 100 })}
          onApplyVariable={() => undefined}
        />
        {node.type === 'text' ? (
          <div style={{ flex: '1 1 0' }} />
        ) : (
          <FigField
            value={perCorner ? 'mixed' : node.radius}
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
            <FigIcon name="Individual strokes" />
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
            <FigButton title="Corner settings" onClick={() => undefined}>
              <Icon.Sliders />
            </FigButton>
          </div>
        </>
      )}
    </FigSection>
  );
}

/** Figma puts blend mode behind a header icon, not an inline dropdown. */
function BlendMenu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: 'relative' }}>
      <FigButton title="Apply blend mode" on={open || value !== 'normal'} onClick={() => setOpen((v) => !v)}>
        <FigIcon name="Apply blend mode" />
      </FigButton>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 28,
              width: 170,
              maxHeight: 300,
              overflowY: 'auto',
              background: '#fff',
              borderRadius: 6,
              padding: 4,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
              zIndex: 71,
            }}
          >
            {BLEND_MODES.map((mode) => (
              <div key={mode.value}>
                {mode.divider && (
                  <div style={{ height: 1, background: 'var(--fig-line)', margin: '4px 6px' }} />
                )}
                <FigButton
                  on={mode.value === value}
                  onClick={() => {
                    onChange(mode.value);
                    setOpen(false);
                  }}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  {mode.label}
                </FigButton>
              </div>
            ))}
          </div>
        </>
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
        <FigButton title="Type details" on={more} onClick={() => setMore((v) => !v)}>
          <Icon.Sliders />
        </FigButton>
      }
    >
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

      {more && (
        <>
          <div className="fig-row">
            <FigText value={node.text ?? ''} onChange={(text) => set({ text })} placeholder="Content" />
          </div>
          <div className="fig-row">
            <FigSelect
              value={node.underline ? node.underline.style : 'none'}
              options={[
                { value: 'none', label: 'No decoration' },
                { value: 'solid', label: 'Underline' },
                { value: 'double', label: 'Double' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
                { value: 'wavy', label: 'Wavy' },
              ]}
              title="Decoration"
              onChange={(style) =>
                set({
                  underline:
                    style === 'none'
                      ? null
                      : {
                          style: style as NonNullable<SceneNode['underline']>['style'],
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

function FillSection({ node, set }: { node: SceneNode; set: Setter }) {
  const tokens = useTokens();
  const doc = useDoc();
  const store = useStore();
  const page = useUI((state) => state.page);
  const swatches = pageColors(doc, page);
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
          <FigTokenPicker
            tokens={tokens}
            title="Fill, apply styles and variables"
            onPick={(reference) => patch(paints[0].id, { value: reference })}
          />
        ) : undefined
      }
    >
      {paints.map((paint) => {
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
              blend={node.blend}
              onBlend={(blend) => set({ blend })}
              pageColors={swatches}
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
      })}
    </FigSection>
  );
}

// ── Stroke ───────────────────────────────────────────────────────────────

function StrokeSection({ node, set }: { node: SceneNode; set: Setter }) {
  const tokens = useTokens();
  const stroke = node.border;
  return (
    <FigSection
      title="Stroke"
      empty={!stroke}
      onAdd={() => set({ border: { width: 1, color: '#000000', style: 'solid', position: 'inside' } })}
      onRemove={() => set({ border: null })}
      actions={
        <FigTokenPicker
          tokens={tokens}
          title="Stroke, apply styles and variables"
          onPick={(reference) =>
            set({
              border: { width: stroke?.width ?? 1, color: reference, style: stroke?.style ?? 'solid', position: stroke?.position ?? 'inside' },
            })
          }
        />
      }
    >
      {stroke && (
        <>
          <FigPaintRow
            color={stroke.color}
            alpha={1}
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
              value={stroke.width}
              glyph={<FigIcon name="Stroke weight" />}
              min={0}
              title="Stroke weight"
              onChange={(width) => set({ border: { ...stroke, width } })}
            />
            <FigButton title="Advanced stroke" onClick={() => undefined}>
              <Icon.Sliders />
            </FigButton>
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
  return (
    <span style={{ position: 'relative' }}>
      <FigButton title="Stroke style" on={open || value !== 'solid'} onClick={() => setOpen((v) => !v)}>
        <FigIcon name="Advanced stroke settings" />
      </FigButton>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 28,
              width: 130,
              background: '#fff',
              borderRadius: 6,
              padding: 4,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px -6px rgba(0,0,0,0.24)',
              zIndex: 71,
            }}
          >
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
          </div>
        </>
      )}
    </span>
  );
}

// ── Effects ──────────────────────────────────────────────────────────────

type EffectKind =
  | 'drop'
  | 'inner'
  | 'blur'
  | 'backdrop'
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'grayscale'
  | 'hue';

const EFFECT_OPTIONS: FigOption<EffectKind>[] = [
  { value: 'drop', label: 'Drop shadow' },
  { value: 'inner', label: 'Inner shadow' },
  { value: 'blur', label: 'Layer blur' },
  { value: 'backdrop', label: 'Background blur' },
  { value: 'brightness', label: 'Brightness', divider: true },
  { value: 'contrast', label: 'Contrast' },
  { value: 'saturate', label: 'Saturation' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'hue', label: 'Hue rotate' },
];

const ADJUSTMENTS: Record<string, { min: number; max: number; step: number; unit?: string }> = {
  brightness: { min: 0, max: 3, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  saturate: { min: 0, max: 3, step: 0.01 },
  grayscale: { min: 0, max: 1, step: 0.01 },
  hue: { min: -180, max: 180, step: 1, unit: '°' },
};

/** Everything Figma files under Effects, plus the CSS adjustments this canvas can do. */
function EffectsSection({ node, set }: { node: SceneNode; set: Setter }) {
  const filters = node.filters;
  const active: EffectKind[] = [];
  if (node.shadow) active.push('drop');
  if (node.innerShadow) active.push('inner');
  if (filters?.blur) active.push('blur');
  if (filters?.backdropBlur) active.push('backdrop');
  for (const key of ['brightness', 'contrast', 'saturate'] as const) {
    if (filters && filters[key] !== 1) active.push(key);
  }
  if (filters?.grayscale) active.push('grayscale');
  if (filters?.hueRotate) active.push('hue');

  const withFilters = (delta: Partial<NonNullable<SceneNode['filters']>>) =>
    set({ filters: { ...DEFAULT_FILTERS, ...(filters ?? {}), ...delta } });

  const extra = node.shadows ?? [];
  const add = () => {
    if (!node.shadow) set({ shadow: { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.25)' } });
    else if (!node.innerShadow) set({ innerShadow: { x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.25)' } });
    else if (!filters?.blur && !filters?.backdropBlur) withFilters({ blur: 4 });
    // beyond the basics, keep stacking drop shadows the way Figma does
    else set({ shadows: [...extra, { x: 0, y: 8, blur: 20, spread: -2, color: 'rgba(0,0,0,0.2)' }] });
  };

  const remove = (kind: EffectKind) => {
    if (kind === 'drop') return set({ shadow: null });
    if (kind === 'inner') return set({ innerShadow: null });
    if (kind === 'blur') return withFilters({ blur: 0 });
    if (kind === 'backdrop') return withFilters({ backdropBlur: 0 });
    if (kind === 'grayscale') return withFilters({ grayscale: 0 });
    if (kind === 'hue') return withFilters({ hueRotate: 0 });
    return withFilters({ [kind]: 1 } as Partial<NonNullable<SceneNode['filters']>>);
  };

  return (
    <FigSection
      title="Effects"
      actions={
        <FigButton title="Add effect" onClick={add}>
          <FigIcon name="Add fill" />
        </FigButton>
      }
    >
      {extra.map((spec, index) => (
        <div key={`extra-${index}`} style={{ marginTop: 6 }}>
          <div className="fig-row tight" style={{ marginTop: 0 }}>
            <FigSelect
              value="drop"
              options={[{ value: 'drop', label: 'Drop shadow' }]}
              title="Effect type"
              onChange={() => undefined}
            />
            <FigButton
              title="Remove effect"
              onClick={() => set({ shadows: extra.filter((_, i) => i !== index) })}
            >
              <FigIcon name="Remove" />
            </FigButton>
          </div>
          <ShadowControls
            spec={spec}
            onChange={(next) => set({ shadows: extra.map((s2, i) => (i === index ? next : s2)) })}
          />
        </div>
      ))}

      {active.map((kind) => (
        <div key={kind} style={{ marginTop: 6 }}>
          <div className="fig-row tight" style={{ marginTop: 0 }}>
            <FigSelect
              value={kind}
              options={EFFECT_OPTIONS}
              title="Effect type"
              onChange={(next) => {
                remove(kind);
                if (next === 'drop') set({ shadow: { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.25)' } });
                else if (next === 'inner') set({ innerShadow: { x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.25)' } });
                else if (next === 'blur') withFilters({ blur: 4 });
                else if (next === 'backdrop') withFilters({ backdropBlur: 8 });
                else if (next === 'grayscale') withFilters({ grayscale: 1 });
                else if (next === 'hue') withFilters({ hueRotate: 45 });
                else withFilters({ [next]: 1.4 } as Partial<NonNullable<SceneNode['filters']>>);
              }}
            />
            <FigButton title="Remove effect" onClick={() => remove(kind)}>
              <FigIcon name="Remove" />
            </FigButton>
          </div>

          {(kind === 'drop' || kind === 'inner') && (
            <ShadowControls
              spec={(kind === 'drop' ? node.shadow : node.innerShadow)!}
              onChange={(next) => set(kind === 'drop' ? { shadow: next } : { innerShadow: next })}
            />
          )}

          {kind === 'blur' && (
            <div className="fig-row">
              <FigField
                value={filters?.blur ?? 0}
                glyph={<Icon.Opacity />}
                min={0}
                max={100}
                step={0.5}
                title="Blur"
                onChange={(blur) => withFilters({ blur })}
              />
            </div>
          )}

          {kind === 'backdrop' && (
            <div className="fig-row">
              <FigField
                value={filters?.backdropBlur ?? 0}
                glyph={<Icon.Opacity />}
                min={0}
                max={100}
                step={0.5}
                title="Background blur"
                onChange={(backdropBlur) => withFilters({ backdropBlur })}
              />
            </div>
          )}

          {ADJUSTMENTS[kind] && (
            <div className="fig-row">
              <FigField
                value={kind === 'hue' ? (filters?.hueRotate ?? 0) : ((filters?.[kind as 'brightness'] ?? 1) as number)}
                glyph={<Icon.Sliders />}
                min={ADJUSTMENTS[kind].min}
                max={ADJUSTMENTS[kind].max}
                step={ADJUSTMENTS[kind].step}
                suffix={ADJUSTMENTS[kind].unit}
                sensitivity={ADJUSTMENTS[kind].step < 1 ? 200 : 3}
                title={kind}
                onChange={(value) =>
                  withFilters(
                    kind === 'hue'
                      ? { hueRotate: value }
                      : ({ [kind]: value } as Partial<NonNullable<SceneNode['filters']>>),
                  )
                }
              />
            </div>
          )}
        </div>
      ))}
    </FigSection>
  );
}

function ShadowControls({
  spec,
  onChange,
}: {
  spec: NonNullable<SceneNode['shadow']>;
  onChange: (next: NonNullable<SceneNode['shadow']>) => void;
}) {
  return (
    <>
      <div className="fig-row">
        <FigField value={spec.x} glyph="X" title="Offset X" onChange={(x) => onChange({ ...spec, x })} />
        <FigField value={spec.y} glyph="Y" title="Offset Y" onChange={(y) => onChange({ ...spec, y })} />
      </div>
      <div className="fig-row">
        <FigField
          value={spec.blur}
          glyph={<Icon.Opacity />}
          min={0}
          title="Blur"
          onChange={(blur) => onChange({ ...spec, blur })}
        />
        <FigField
          value={spec.spread}
          glyph={<Icon.Scale />}
          title="Spread"
          onChange={(spread) => onChange({ ...spec, spread })}
        />
      </div>
      <FigPaintRow color={spec.color} alpha={1} onColor={(color) => onChange({ ...spec, color })} />
    </>
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
            </div>
          ) : (
            <div className="fig-row">
              <FigField value={guides.count} glyph="N" min={1} max={48} title="Count" onChange={(count) => set({ guides: { ...guides, count } })} />
              <FigField value={guides.gutter} glyph={<Icon.Gap />} min={0} title="Gutter" onChange={(gutter) => set({ guides: { ...guides, gutter } })} />
            </div>
          )}
          <div className="fig-row">
            <FigField value={guides.margin} glyph={<Icon.PadH />} min={0} title="Margin" onChange={(margin) => set({ guides: { ...guides, margin } })} />
          </div>
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
      {video && (
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
      )}
    </FigSection>
  );
}

// ── Selection colors ─────────────────────────────────────────────────────

/**
 * Figma lists every colour used inside the selection and lets you jump to the
 * layers using it — handy for spotting a stray hex before it ships.
 */
function SelectionColors() {
  const doc = useDoc();
  const store = useStore();
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);

  const usage = new Map<string, string[]>();
  const walk = (id: string) => {
    const node = doc[id];
    if (!node) return;
    const paints = [node.fill, node.border?.color, node.font?.color].filter(
      (value): value is string => !!value && !/gradient\(|^url\(/.test(value),
    );
    for (const paint of paints) {
      usage.set(paint, [...(usage.get(paint) ?? []), id]);
    }
    node.children.forEach(walk);
  };
  selection.forEach(walk);

  const entries = [...usage.entries()];
  if (entries.length < 2) return null;

  return (
    <FigSection title="Selection colors">
      {entries.map(([color, ids]) => (
        <div className="fig-row" key={color}>
          <FigPaintRow
            color={color}
            alpha={1}
            onColor={(next) =>
              store.updateMany(ids, (n) => {
                if (n.fill === color) return { fill: next };
                if (n.border?.color === color) return { border: { ...n.border, color: next } };
                if (n.font?.color === color) return { font: { ...n.font!, color: next } };
                return {};
              })
            }
          />
          <FigButton title="Select item using this color" onClick={() => select(ids)}>
            <Icon.Move />
          </FigButton>
        </div>
      ))}
    </FigSection>
  );
}

// ── Export ───────────────────────────────────────────────────────────────

function ExportSection({ node, onExport }: { node: SceneNode; onExport: () => void }) {
  const rows = useUI((s) => s.exportRows);
  const addRow = useUI((s) => s.addExportRow);
  const updateRow = useUI((s) => s.updateExportRow);
  const removeRow = useUI((s) => s.removeExportRow);
  const setFormat = useUI((s) => s.setExportFormat);
  const setScale = useUI((s) => s.setExportScale);
  const [preview, setPreview] = useState(false);

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
          <FigButton title="More options" onClick={() => undefined}>
            <Icon.Dots />
          </FigButton>
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
            }
            onExport();
          }}
        >
          Export {node.name}
        </button>
      </div>

      <button
        type="button"
        className="fig-btn"
        style={{ marginTop: 6, padding: 0, gap: 6, color: 'var(--fig-dim)' }}
        onClick={() => setPreview((v) => !v)}
      >
        <span style={{ display: 'inline-flex', transform: preview ? 'rotate(90deg)' : undefined }}>
          <Icon.Chevron />
        </span>
        Preview
      </button>
      {preview && (
        <div
          style={{
            marginTop: 6,
            height: 96,
            borderRadius: 5,
            border: '1px solid var(--fig-line)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fig-dim)',
          }}
        >
          Open Export to render {node.name}
        </div>
      )}
    </FigSection>
  );
}
