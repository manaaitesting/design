'use client';

import { useState } from 'react';
import { FigIcon } from './ui/FigIcon';
import { FigButton, FigMenuItem, FigPopover } from './ui/Figma';
import { useStore, useTokens } from './Session';
import { useUI } from '../state/ui';
import type { NumericField, SceneNode } from '../document/types';
import { FIELD_SCOPE, inScope } from '../document/variables';

/**
 * Figma's applied number variables.
 *
 * The button used to sit inside every numeric field and do nothing. It offers
 * the document's number variables now: picking one writes its value into the
 * field and makes the rendered CSS a `var()`, so the layer moves when the
 * variable does. Only number tokens are listed — a colour cannot be a width,
 * and offering one would be the same empty gesture as before.
 */
export function VariableMenu({
  node,
  field,
  onClose,
}: {
  node: SceneNode;
  field: NumericField;
  onClose: () => void;
}) {
  const store = useStore();
  // only number variables, and only those scoped to this kind of field — a
  // corner-radius token has no business being offered as an X position
  const scope = FIELD_SCOPE[field];
  const tokens = useTokens().filter(
    (token) => token.type === 'number' && (!scope || inScope(token, scope)),
  );
  const selection = useUI((s) => s.selection);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const bound = node.vars?.[field];
  const targets = selection.length ? selection : [node.id];

  return (
    <span ref={setAnchor} style={{ display: 'inline-flex' }}>
      <FigPopover anchor={anchor} width={214} onClose={onClose}>
        <div style={{ padding: 4 }}>
          {bound && (
            <FigButton
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                store.bindVariable(targets, field, null);
                onClose();
              }}
            >
              <FigIcon name="Remove" />
              <span>Detach variable</span>
            </FigButton>
          )}
          {tokens.length === 0 ? (
            <div style={{ color: 'var(--fig-dim)', padding: 6 }}>
              No number variables scoped to this field. Create one in the Theme tab, or widen an
              existing variable&rsquo;s scope.
            </div>
          ) : (
            <ul role="listbox" aria-label="Number variables" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {tokens.map((token) => (
                <li key={token.id}>
                  <FigMenuItem
                    label={`${token.name} · ${token.value}`}
                    selected={bound === token.id}
                    onSelect={() => {
                      store.bindVariable(targets, field, token.id);
                      onClose();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </FigPopover>
    </span>
  );
}

/**
 * A numeric field's variable affordance.
 *
 * Returns what the field should show — the variable's name in place of a
 * number, the way Figma replaces the value with a chip you cannot type into.
 */
export function variableLabel(
  node: SceneNode,
  field: NumericField,
  names: Record<string, string>,
): string | null {
  const id = node.vars?.[field];
  return id ? (names[id] ?? null) : null;
}
