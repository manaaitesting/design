'use client';

import { useState } from 'react';
import { FigIcon } from './ui/FigIcon';
import { FigButton, FigMenuItem, FigPopover, FigText } from './ui/Figma';
import { useDoc, useStore, useStyles, useTokens } from './Session';
import { useUI } from '../state/ui';
import type { Paint, SceneNode, StyleSlot } from '../document/types';

/** What the dialog is called, per slot. */
const TITLE: Record<StyleSlot, string> = {
  fill: 'Fill, apply styles and variables',
  stroke: 'Stroke, apply styles and variables',
  text: 'Text, apply styles',
  effect: 'Effects, apply styles',
  grid: 'Layout grid, apply styles',
};

/**
 * Figma's styles-and-variables dialog.
 *
 * The button used to list variables only, which meant the panel could offer a
 * colour but never a *set* of properties — no type styles, no effect styles.
 * Both live here now, in the two groups Figma splits them into, along with the
 * way you make one: capture what the layer is wearing and give it a name.
 */
export function StylePicker({
  slot,
  node,
  onPickVariable,
}: {
  slot: StyleSlot;
  node: SceneNode;
  /** variables are a value, not a subscription, so the caller writes them */
  onPickVariable?: (reference: string) => void;
}) {
  const store = useStore();
  const styles = useStyles(slot === 'fill' || slot === 'stroke' ? 'paint' : slot);
  const tokens = useTokens();
  const selection = useUI((s) => s.selection);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  // Figma puts a search at the top of this dialog, because a real file has more
  // styles than fit in a popover
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  const worn = node.styles?.[slot];
  const needle = query.trim().toLowerCase();
  const shownStyles = needle
    ? styles.filter((style) => style.name.toLowerCase().includes(needle))
    : styles;
  const shownTokens = needle
    ? tokens.filter((token) => token.name.toLowerCase().includes(needle))
    : tokens;

  return (
    <span ref={setAnchor} style={{ display: 'inline-flex' }}>
      <FigButton title={TITLE[slot]} on={open || !!worn} onClick={() => setOpen((v) => !v)}>
        <FigIcon name="Fill, Apply styles and variables" />
      </FigButton>
      {open && (
        <FigPopover anchor={anchor} placement="beside" width={244} onClose={() => setOpen(false)}>
          <div style={{ padding: 4 }}>
            {(styles.length > 0 || tokens.length > 0) && (
              <div style={{ padding: 2 }}>
                <FigText value={query} placeholder="Search" onChange={setQuery} live />
              </div>
            )}
            {naming ? (
              <div style={{ display: 'flex', gap: 6, padding: 2 }}>
                <FigText
                  value={draft}
                  placeholder="Style name"
                  onChange={(name) => {
                    setDraft('');
                    setNaming(false);
                    if (!name.trim()) return;
                    store.createStyleFrom(node.id, slot, name.trim());
                    setOpen(false);
                  }}
                />
              </div>
            ) : (
              <FigButton
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => setNaming(true)}
              >
                <FigIcon name="Add fill" />
                <span>Create style from this layer</span>
              </FigButton>
            )}

            {worn && (
              <FigButton
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={() => {
                  store.detachStyle(selection.length ? selection : [node.id], slot);
                  setOpen(false);
                }}
              >
                <FigIcon name="Remove" />
                <span>Detach style</span>
              </FigButton>
            )}

            <div className="fig-label" style={{ padding: '0 6px' }}>
              Styles
            </div>
            {shownStyles.length === 0 ? (
              <div style={{ color: 'var(--fig-dim)', padding: '0 6px 6px' }}>
                {needle ? 'No style by that name.' : 'None yet — create one from a layer you like.'}
              </div>
            ) : (
              <ul role="listbox" aria-label="Styles" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {shownStyles.map((style) => (
                  <li key={style.id}>
                    <FigMenuItem
                      label={style.name}
                      selected={worn === style.id}
                      icon={<StyleChit kind={style.kind} value={style.value} />}
                      onSelect={() => {
                        store.applyStyle(selection.length ? selection : [node.id], style.id, slot);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            {onPickVariable && (
              <>
                <div className="fig-label" style={{ padding: '0 6px' }}>
                  Variables
                </div>
                {shownTokens.length === 0 ? (
                  <div style={{ color: 'var(--fig-dim)', padding: '0 6px 4px' }}>
                    {needle ? 'No variable by that name.' : 'None yet — create them in the Theme tab.'}
                  </div>
                ) : (
                  <ul role="listbox" aria-label="Variables" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {shownTokens.map((token) => (
                      <li key={token.id}>
                        <FigMenuItem
                          label={token.name}
                          icon={
                            <span
                              className="fig-swatch"
                              style={{
                                margin: 0,
                                background: token.type === 'color' ? token.value : 'transparent',
                              }}
                            />
                          }
                          onSelect={() => {
                            onPickVariable(`var(--${token.name})`);
                            setOpen(false);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </FigPopover>
      )}
    </span>
  );
}

/** A style's thumbnail: the paint itself, or the letter its type is set in. */
function StyleChit({ kind, value }: { kind: string; value: unknown }) {
  if (kind === 'paint') {
    const paints = (value as Paint[]) ?? [];
    return (
      <span
        className="fig-swatch"
        style={{ margin: 0, background: paints[0]?.value ?? 'transparent' }}
      />
    );
  }
  if (kind === 'text') {
    const font = value as SceneNode['font'];
    return (
      <span style={{ width: 16, textAlign: 'center', fontFamily: font?.family, fontWeight: font?.weight }}>
        A
      </span>
    );
  }
  if (kind === 'grid') {
    const guides = value as SceneNode['guides'];
    return (
      <span style={{ width: 16, textAlign: 'center', color: guides?.color ?? 'currentColor' }}>▦</span>
    );
  }
  return <span style={{ width: 16, textAlign: 'center' }}>◍</span>;
}

/** The name of the style a layer is wearing, shown where Figma shows it. */
export function StyleBadge({ node, slot }: { node: SceneNode; slot: StyleSlot }) {
  const styles = useStyles();
  const doc = useDoc();
  const worn = node.styles?.[slot];
  const style = worn ? styles.find((entry) => entry.id === worn) : null;
  void doc;
  if (!style) return null;

  return (
    <div className="fig-row" style={{ marginTop: 4 }}>
      <span
        className="fig-style-badge"
        title={`Wearing the ${style.name} style`}
        style={{ flex: 1 }}
      >
        {style.name}
      </span>
    </div>
  );
}
