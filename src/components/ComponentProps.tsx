'use client';

import { useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import {
  FigButton,
  FigLabel,
  FigMenuItem,
  FigPopover,
  FigSelect,
  FigText,
  type FigOption,
} from './ui/Figma';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';
import {
  instanceRoot,
  setOf,
  type ComponentProp,
  type Doc,
  type PropType,
  type SceneNode,
} from '../document/types';

const PURPLE = '#9747FF';

const TYPE_LABEL: Record<PropType, string> = {
  boolean: 'Boolean',
  text: 'Text',
  instance: 'Instance swap',
  variant: 'Variant',
};

/** What a property of each type can drive on a layer. */
const FIELD_FOR: Record<PropType, 'visible' | 'text' | 'instance' | null> = {
  boolean: 'visible',
  text: 'text',
  instance: 'instance',
  variant: null,
};

/**
 * The properties a main component publishes.
 *
 * Figma keeps this on the component itself rather than on its instances,
 * because it is the component's contract: adding one here is what gives every
 * instance, present and future, something to set.
 */
export function PropertiesSection({ node }: { node: SceneNode }) {
  const store = useStore();
  const doc = useDoc();
  const [adding, setAdding] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  // every hook first: a variant returns early, and a hook behind a return is a
  // hook React will look for on the next render and not find
  if (!node.isComponent && !node.isComponentSet) return null;
  // a variant belongs to a set, and the set is where its properties live
  if (setOf(node, doc)) return null;

  const props = node.props ?? [];

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span style={{ flex: 1, color: PURPLE }}>Properties</span>
        <span ref={setAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="Add property" on={adding} onClick={() => setAdding((v) => !v)}>
            <FigIcon name="Add fill" />
          </FigButton>
          {adding && (
            <FigPopover anchor={anchor} width={196} onClose={() => setAdding(false)}>
              <ul role="listbox" aria-label="Add property" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {(['boolean', 'text', 'instance'] as const).map((type) => (
                  <li key={type}>
                    <FigMenuItem
                      label={TYPE_LABEL[type]}
                      onSelect={() => {
                        store.addComponentProp(node.id, {
                          name: nextName(props, TYPE_LABEL[type]),
                          type,
                          value: type === 'boolean' ? 'true' : '',
                        });
                        setAdding(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </FigPopover>
          )}
        </span>
      </div>

      {props.length === 0 ? (
        <div style={{ color: 'var(--fig-dim)', paddingBottom: 4 }}>
          No properties yet — add one, then point a layer at it.
        </div>
      ) : (
        props.map((prop) => <PropRow key={prop.id} owner={node.id} prop={prop} />)
      )}
    </div>
  );
}

function PropRow({ owner, prop }: { owner: string; prop: ComponentProp }) {
  const store = useStore();

  return (
    <div className="fig-row">
      <FigText
        value={prop.name}
        glyph={<Icon.Component solid />}
        onChange={(name) => name && store.updateComponentProp(owner, prop.id, { name })}
      />
      {prop.type === 'boolean' ? (
        <FigSelect
          value={prop.value === 'false' ? 'false' : 'true'}
          options={[
            { value: 'true', label: 'On' },
            { value: 'false', label: 'Off' },
          ]}
          title={`${prop.name} default`}
          onChange={(value) => store.updateComponentProp(owner, prop.id, { value })}
        />
      ) : prop.type === 'variant' ? (
        <FigText
          value={(prop.options ?? []).join(', ')}
          onChange={(raw) =>
            store.updateComponentProp(owner, prop.id, {
              options: raw.split(',').map((entry) => entry.trim()).filter(Boolean),
            })
          }
        />
      ) : (
        <FigText
          value={prop.value}
          placeholder="Default"
          onChange={(value) => store.updateComponentProp(owner, prop.id, { value })}
        />
      )}
      <FigButton title={`Remove ${prop.name}`} onClick={() => store.removeComponentProp(owner, prop.id)}>
        <FigIcon name="Remove" />
      </FigButton>
    </div>
  );
}

/**
 * The control a layer inside a component uses to say which property drives it.
 *
 * Only properties that can drive *this* layer are offered: a text property has
 * nothing to say to a rectangle, and offering it would be a control that looks
 * live and does nothing.
 */
export function PropBindingRow({ node }: { node: SceneNode }) {
  const doc = useDoc();
  const store = useStore();

  // the component this layer is part of, if any — and never an instance's copy
  const main = mainAbove(node, doc);
  if (!main || main.id === node.id || instanceRoot(node.id, doc)) return null;

  const usable = (main.props ?? []).filter((prop) => {
    const field = FIELD_FOR[prop.type];
    if (field === 'text') return node.type === 'text';
    if (field === 'instance') return !!node.instanceOf;
    return field === 'visible';
  });
  if (!usable.length) return null;

  const current = node.bindings?.[0];
  const options: FigOption<string>[] = [
    { value: '', label: 'None' },
    ...usable.map((prop) => ({ value: prop.id, label: `${prop.name} · ${TYPE_LABEL[prop.type]}` })),
  ];

  return (
    <>
      <FigLabel>Applied property</FigLabel>
      <div className="fig-row" style={{ marginTop: 0 }}>
        <FigSelect
          value={current?.prop ?? ''}
          options={options}
          glyph={<Icon.Component />}
          title="Applied property"
          onChange={(propId) => {
            const prop = usable.find((entry) => entry.id === propId);
            const field = prop && FIELD_FOR[prop.type];
            store.bindProp(node.id, prop && field ? { prop: prop.id, field } : null);
          }}
        />
        <span style={{ width: 24, flex: 'none' }} />
      </div>
    </>
  );
}

/**
 * The properties an instance gets to set.
 *
 * Variant properties come from the set rather than the variant, because that is
 * where they are declared — the variant only records which values it answers to.
 */
export function InstancePropsSection({ node }: { node: SceneNode }) {
  const doc = useDoc();
  const store = useStore();
  const select = useUI((s) => s.select);
  const main = node.instanceOf ? doc[node.instanceOf] : null;
  if (!main) return null;

  const set = setOf(main, doc);
  const props = [...(set?.props ?? []), ...(main.props ?? [])];
  if (!props.length) return null;

  const values = node.propValues ?? {};
  const components = Object.values(doc).filter((entry) => entry.isComponent);

  return (
    <div className="fig-section">
      <div className="fig-head">
        <span style={{ flex: 1, color: PURPLE }}>Properties</span>
      </div>

      {props.map((prop) => {
        const value = values[prop.id] ?? prop.value;
        const apply = (next: string) => {
          const moved = store.setPropValue(node.id, prop.id, next);
          // a variant property answers by swapping, so selection has to follow
          if (moved && moved !== node.id) select([moved]);
        };

        return (
          <div className="fig-row" key={prop.id}>
            <span
              style={{
                flex: '0 0 84px',
                color: 'var(--fig-label)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={prop.name}
            >
              {prop.name}
            </span>
            {prop.type === 'boolean' ? (
              <label
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}
              >
                <input
                  type="checkbox"
                  aria-label={prop.name}
                  checked={value !== 'false'}
                  onChange={(e) => apply(e.target.checked ? 'true' : 'false')}
                  style={{ width: 12, height: 12, accentColor: 'var(--fig-blue)' }}
                />
                <span style={{ color: 'var(--fig-dim)' }}>{value !== 'false' ? 'On' : 'Off'}</span>
              </label>
            ) : prop.type === 'variant' ? (
              <FigSelect
                value={value}
                options={(prop.options ?? []).map((option) => ({ value: option, label: option }))}
                title={prop.name}
                onChange={apply}
              />
            ) : prop.type === 'instance' ? (
              <FigSelect
                value={value}
                options={components.map((entry) => ({ value: entry.id, label: entry.name }))}
                title={prop.name}
                onChange={apply}
              />
            ) : (
              <FigText value={value} placeholder={prop.name} onChange={apply} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The nearest main component at or above this layer. */
function mainAbove(node: SceneNode, doc: Doc): SceneNode | null {
  let current: SceneNode | undefined = node;
  while (current) {
    if (current.isComponent) return current;
    current = current.parent ? doc[current.parent] : undefined;
  }
  return null;
}

/** "Boolean", then "Boolean 2" — the same rule layer names follow. */
function nextName(props: ComponentProp[], base: string): string {
  const taken = new Set(props.map((prop) => prop.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
