'use client';

import { Fragment, useMemo, useState } from 'react';
import { FigButton, FigGroup, FigLabel, FigSection, FigSelect } from './ui/Figma';
import { Icon } from './ui/Icons';
import {
  useCollections,
  useCustomFonts,
  useDoc,
  useStore,
  useTokens,
  useVarNames,
} from './Session';
import { cssFor, writeText } from '../lib/actions';
import { toHtml, toJson, toReact } from '../export/toCode';
import { nodeStyle } from '../document/css';
import { isInFlow, type Doc, type SceneNode } from '../document/types';

/**
 * The handoff panel.
 *
 * Figma calls this Dev Mode. The premise of this editor makes it unusually
 * short to write: the canvas already renders from `nodeStyle`, so the "code for
 * this layer" is not a translation of the design — it is the thing the design
 * was drawn with. Nothing here re-derives anything.
 */

type Format = 'css' | 'react' | 'html' | 'json';

export function Inspect({ node }: { node?: SceneNode }) {
  const doc = useDoc();
  const store = useStore();
  const tokens = useTokens();
  const collections = useCollections();
  const fonts = useCustomFonts();
  const varNames = useVarNames();
  const [format, setFormat] = useState<Format>('css');
  const [deep, setDeep] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (!node) return '';
    switch (format) {
      case 'react': {
        const { markup, css } = toReact(node.id, doc, tokens, collections, fonts);
        return `${markup}\n\n/* ── stylesheet ── */\n\n${css}`;
      }
      case 'html':
        return toHtml(node.id, doc, tokens, collections, fonts);
      case 'json':
        return toJson(node.id, doc);
      case 'css':
      default:
        return cssFor(node.id, doc, deep, varNames);
    }
  }, [node, doc, tokens, collections, varNames, format, deep]);

  if (!node) {
    return (
      <div className="scroll" style={{ flex: 1 }}>
        <p className="fig-hint">
          Select a layer to inspect it. Everything here is the code the canvas is already rendering
          with — not a translation of it.
        </p>
      </div>
    );
  }

  const style = nodeStyle(node, doc, varNames);
  const spacing = gapsAround(node, doc);
  const used = tokens.filter((token) => code.includes(`var(--${token.name})`));

  return (
    <div className="scroll" style={{ flex: 1 }}>
      <FigSection title="Status">
        <div className="fig-row">
          <FigGroup
            value={node.devStatus ?? 'none'}
            onChange={(devStatus) => store.update(node.id, { devStatus })}
            options={[
              { value: 'none', label: 'Draft', title: 'Still being designed' },
              { value: 'ready', label: 'Ready', title: 'Ready for development' },
              { value: 'done', label: 'Done', title: 'Built' },
            ]}
          />
        </div>
      </FigSection>

      <FigSection
        title="Annotations"
        empty={!(node.annotations ?? []).length}
        onAdd={() =>
          store.update(node.id, {
            annotations: [
              ...(node.annotations ?? []),
              { id: Math.random().toString(36).slice(2, 8), note: '' },
            ],
          })
        }
      >
        {(node.annotations ?? []).map((annotation) => (
          <div key={annotation.id} className="fig-row" style={{ alignItems: 'flex-start' }}>
            <textarea
              className="fig-annotation"
              defaultValue={annotation.note}
              placeholder="What should whoever builds this know?"
              onKeyDown={(event) => event.stopPropagation()}
              onBlur={(event) =>
                store.update(node.id, {
                  annotations: (node.annotations ?? []).map((entry) =>
                    entry.id === annotation.id ? { ...entry, note: event.target.value } : entry,
                  ),
                })
              }
            />
            <FigButton
              title="Remove annotation"
              onClick={() =>
                store.update(node.id, {
                  annotations: (node.annotations ?? []).filter((entry) => entry.id !== annotation.id),
                })
              }
            >
              <Icon.Minus />
            </FigButton>
          </div>
        ))}
      </FigSection>

      <FigSection title={node.name}>
        <div className="fig-inspect-grid">
          <span>Type</span>
          <span>{node.type}</span>
          <span>Size</span>
          <span>
            {Math.round(node.w)} × {Math.round(node.h)}
          </span>
          <span>Position</span>
          <span>
            {isInFlow(node, doc) ? 'laid out by its parent' : `${Math.round(node.x)}, ${Math.round(node.y)}`}
          </span>
          {node.radius || node.radii ? (
            <>
              <span>Radius</span>
              <span>{node.radii ? node.radii.join(' · ') : node.radius}</span>
            </>
          ) : null}
          {node.font && (
            <>
              <span>Type style</span>
              <span>
                {node.font.size}/{node.font.lineHeight} · {node.font.weight} ·{' '}
                {node.font.family.split(',')[0]}
              </span>
            </>
          )}
        </div>
      </FigSection>

      {spacing && (
        <FigSection title="Spacing">
          <div className="fig-inspect-grid">
            <span>To parent</span>
            <span>
              ↑ {spacing.top} → {spacing.right} ↓ {spacing.bottom} ← {spacing.left}
            </span>
            {spacing.padding && (
              <>
                <span>Padding</span>
                <span>{spacing.padding}</span>
              </>
            )}
            {spacing.gap !== undefined && (
              <>
                <span>Gap</span>
                <span>{spacing.gap}</span>
              </>
            )}
          </div>
        </FigSection>
      )}

      {used.length > 0 && (
        <FigSection title="Variables">
          <div className="fig-inspect-grid">
            {used.map((token) => (
              <Fragment key={token.id}>
                <span>--{token.name}</span>
                <span>{token.value}</span>
              </Fragment>
            ))}
          </div>
        </FigSection>
      )}

      <FigSection title="Code">
        <div className="fig-row">
          <FigSelect
            value={format}
            options={[
              { value: 'css', label: 'CSS' },
              { value: 'react', label: 'React' },
              { value: 'html', label: 'HTML' },
              { value: 'json', label: 'JSON' },
            ]}
            title="Code format"
            onChange={setFormat}
          />
          {format === 'css' && (
            <button
              type="button"
              className="btn"
              data-on={deep || undefined}
              onClick={() => setDeep((value) => !value)}
              title="Include every layer inside this one"
            >
              {deep ? 'All layers' : 'This layer'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setCopied(await writeText(code));
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="fig-code">{code}</pre>
      </FigSection>

      <FigSection title="Computed style">
        <FigLabel>What the browser was given</FigLabel>
        <pre className="fig-code">
          {Object.entries(style)
            .filter(([, value]) => value !== undefined && value !== '')
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n')}
        </pre>
      </FigSection>
    </div>
  );
}

/**
 * The gaps between a layer and its parent's edges.
 *
 * Read off the document rather than the DOM: these are the numbers a developer
 * writes down, and they should not change because the canvas is zoomed.
 */
function gapsAround(node: SceneNode, doc: Doc) {
  const parent = node.parent ? doc[node.parent] : null;
  if (!parent) return null;
  return {
    top: Math.round(node.y),
    left: Math.round(node.x),
    right: Math.round(parent.w - (node.x + node.w)),
    bottom: Math.round(parent.h - (node.y + node.h)),
    padding: parent.flex ? parent.flex.padding.join(' ') : undefined,
    gap: parent.flex ? parent.flex.gap : undefined,
  };
}
