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
import { toAndroidXml, toSwiftUI } from '../export/toNative';
import { nodeStyle } from '../document/css';
import { isInFlow, type Doc, type SceneNode } from '../document/types';
import { measureAgainstParent } from '../lib/measure';
import { useUI } from '../state/ui';

/**
 * The handoff panel.
 *
 * Figma calls this Dev Mode. The premise of this editor makes it unusually
 * short to write: the canvas already renders from `nodeStyle`, so the "code for
 * this layer" is not a translation of the design — it is the thing the design
 * was drawn with. Nothing here re-derives anything.
 */

type Format = 'css' | 'react' | 'html' | 'swift' | 'android' | 'json';

export function Inspect({ node }: { node?: SceneNode }) {
  const doc = useDoc();
  const store = useStore();
  const tokens = useTokens();
  const collections = useCollections();
  const fonts = useCustomFonts();
  const varNames = useVarNames();
  const zoom = useUI((s) => s.viewport.zoom);
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
      case 'swift':
        return toSwiftUI(node.id, doc, tokens);
      case 'android':
        return toAndroidXml(node.id, doc, tokens);
      case 'json':
        return toJson(node.id, doc);
      case 'css':
      default:
        return cssFor(node.id, doc, deep, varNames);
    }
  }, [node, doc, tokens, collections, varNames, format, deep]);

  /**
   * What is ready to build, wherever it is.
   *
   * Figma's Dev Mode answers "what should I build?" without anyone having to
   * say which frame to look at, and a flag nothing lists cannot answer it. The
   * list is here rather than in the layers panel because this is the panel a
   * developer is already in.
   */
  const ready = Object.values(doc).filter((entry) => entry.devStatus === 'ready');

  if (!node) {
    return (
      <div className="scroll" style={{ flex: 1 }}>
        {ready.length > 0 && <ReadyList ready={ready} />}
        <p className="fig-hint">
          Select a layer to inspect it. Everything here is the code the canvas is already rendering
          with — not a translation of it.
        </p>
      </div>
    );
  }

  const style = nodeStyle(node, doc, varNames);
  const spacing = gapsAround(node, doc, zoom);
  const used = tokens.filter((token) => code.includes(`var(--${token.name})`));

  return (
    <div className="scroll" style={{ flex: 1 }}>
      {ready.length > 0 && <ReadyList ready={ready} current={node.id} />}
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
          {/* the laid-out size when the browser owns it, since that is the one
              a developer is going to reproduce */}
          <span>{spacing?.measured ? spacing.size : `${Math.round(node.w)} × ${Math.round(node.h)}`}</span>
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
              { value: 'swift', label: 'SwiftUI' },
              { value: 'android', label: 'Android' },
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

/** Everything marked ready for dev, as a way into it. */
function ReadyList({ ready, current }: { ready: SceneNode[]; current?: string }) {
  const select = useUI((s) => s.select);
  return (
    <FigSection title={`Ready for dev · ${ready.length}`}>
      <div className="fig-ready">
        {ready.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="fig-ready-row"
            data-ready={entry.id}
            data-on={entry.id === current ? 'true' : undefined}
            onClick={() => select([entry.id])}
          >
            {entry.name}
          </button>
        ))}
      </div>
    </FigSection>
  );
}

/**
 * The gaps between a layer and its parent's edges.
 *
 * The numbers a developer writes down, so they are in world units and do not
 * change with the zoom — but where they come from depends on who owns the box.
 * A layer the document positions is measured from the document. A layer in a
 * flow, or one inside a frame sized by its own content, is positioned by the
 * browser: `node.x` is then not where it is and `parent.w` is not how wide the
 * parent is, and the panel was printing exactly the coordinates it refuses to
 * show two rows above. Those are read back off the DOM, which is the same
 * source the ⌥ ruler and the selection chrome already trust.
 */
function gapsAround(node: SceneNode, doc: Doc, zoom: number) {
  const parent = node.parent ? doc[node.parent] : null;
  if (!parent) return null;
  const laidOut = isInFlow(node, doc) || parent.wMode === 'fit' || parent.hMode === 'fit';
  const measured = laidOut ? measureAgainstParent(node.id, parent.id, zoom) : null;
  const box = measured?.child ?? { x: node.x, y: node.y, w: node.w, h: node.h };
  const outer = measured?.parent ?? { x: 0, y: 0, w: parent.w, h: parent.h };
  return {
    measured: !!measured,
    size: `${Math.round(box.w)} × ${Math.round(box.h)}`,
    top: Math.round(box.y),
    left: Math.round(box.x),
    right: Math.round(outer.w - (box.x + box.w)),
    bottom: Math.round(outer.h - (box.y + box.h)),
    padding: parent.flex ? parent.flex.padding.join(' ') : undefined,
    gap: parent.flex ? parent.flex.gap : undefined,
  };
}
