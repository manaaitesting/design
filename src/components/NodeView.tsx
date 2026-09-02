'use client';

import { createContext, Fragment, memo, useContext, useEffect, useRef } from 'react';
import { nodeStyle, shaderSurface } from '../document/css';
import { effectLayers, effectsOf } from '../document/effects';
import { ShaderSurface } from './ShaderSurface';
import { Guides } from './Guides';
import { BooleanShape, PathShape } from './Shape';
import { PaintLayers } from './PaintLayers';
import { useDefaultModes, useDoc, useStore, useTokens, useVarNames } from './Session';
import { useUI } from '../state/ui';

/**
 * Instances a running prototype has swapped — Figma's "Change to".
 *
 * The document is not touched: a run is a rehearsal. So the substitution lives
 * here, and the instance keeps its own box while drawing the other variant's
 * content, which is what changing a variant looks like.
 */
export const SwapContext = createContext<Record<string, string>>({});
import { paintsWithPath } from '../document/geometry';
import { pathTextSpec, type PathTextSpec } from '../document/textpath';
import { maskStyles } from '../document/mask';
import { modeVars } from '../document/variables';
import { ensureFont } from '../lib/fonts';
import {
  isPlain,
  LINE_BREAK,
  listBoxStyle,
  plainText,
  runLines,
  runSegments,
  runStyle,
  runsOf,
  textGroups,
  type TextRun,
} from '../document/text';
import { TextEditor } from './TextEditor';
import type { CSSProperties } from 'react';
import { guidesOf, type SceneNode } from '../document/types';

/**
 * Renders one scene node as real DOM.
 *
 * There is no custom layout pass here — the browser lays the tree out from the
 * styles in `nodeStyle`, which is also what gets exported. A flex frame on the
 * canvas reflows exactly like the shipped component will.
 */
/**
 * A text node's content.
 *
 * Plain text stays one `pre-wrap` block, which is what it has always been and
 * what keeps a single line cheap. Paragraph spacing and lists both need the
 * lines to be real blocks before CSS has anything to space or mark, so those
 * turn the same string into one element per line — and styled runs are spans
 * inside whichever of those shapes is in play, so a bold word works in a list
 * exactly as it works in a paragraph.
 */
/**
 * A text layer that follows a path.
 *
 * The glyphs are laid out by the browser along `d`, which is the outline of the
 * layer the text is attached to, drawn in the same coordinates because
 * attaching gave the two layers the same box.
 *
 * The paint is the type colour rather than a CSS `color`: inside SVG the fill
 * is what shows, and taking it from the same `font.color` the box layout uses
 * is what keeps the two renderings of the same layer the same colour.
 */
function PathText({ id, node, spec }: { id: string; node: SceneNode; spec: PathTextSpec }) {
  const font = node.font;
  const pathId = `${id}-textpath`;
  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      viewBox={`0 0 ${spec.width} ${spec.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <path id={pathId} d={spec.d} />
      </defs>
      <text
        fill={font?.color ?? '#000000'}
        fontFamily={font?.family}
        fontSize={font?.size}
        fontWeight={font?.weight}
        letterSpacing={font?.letterSpacing ? `${font.letterSpacing}em` : undefined}
        textAnchor={spec.anchor}
      >
        <textPath
          href={`#${pathId}`}
          startOffset={spec.startOffset}
          // SVG 2's `side`, which the browsers draw and React's types have not
          // caught up with — spreading it is how it reaches the element
          {...({ side: spec.side } as Record<string, string>)}
        >
          {spec.plain
            ? spec.runs.map((run) => run.text).join('')
            : spec.runs.map((run, index) => (
                <tspan key={index} style={runStyle(run, font)}>
                  {run.text}
                </tspan>
              ))}
        </textPath>
      </text>
    </svg>
  );
}

function TextBody({ node }: { node: SceneNode }) {
  const font = node.font;
  const runs = runsOf(node);
  const plain = isPlain(runs);
  const groups = textGroups(runs, font);
  const spacing = font?.paragraphSpacing ?? 0;

  const text = plainText(runs);
  if (plain && !groups && !text.includes(LINE_BREAK)) return <>{text}</>;

  // a soft break is a line inside the paragraph, so it becomes a <br> and takes
  // none of the paragraph spacing with it
  const body = (line: TextRun[]) => (
    <>
      {runSegments(line).map((segment, index) => (
        <Fragment key={index}>
          {index ? <br /> : null}
          {plain
            ? segment.map((run) => run.text).join('')
            : segment.map((run, at) => (
                <span key={at} style={runStyle(run, font)}>
                  {run.text}
                </span>
              ))}
        </Fragment>
      ))}
    </>
  );

  if (!groups) {
    // styled, but a single flowing block: the spans carry the styling and the
    // newlines are still newlines, because the box is `pre-wrap`
    return (
      <>
        {runLines(runs).map((line, index) => (
          <span key={index}>
            {index ? '\n' : ''}
            {body(line)}
          </span>
        ))}
      </>
    );
  }

  const gap = (line: { gap: boolean }) => (line.gap && spacing ? { marginTop: spacing } : undefined);

  return (
    <>
      {groups.map((group, index) => {
        if (!group.list) {
          return (
            <Fragment key={index}>
              {group.lines.map((line, at) => (
                <div key={at} style={gap(line)}>
                  {body(line.runs)}
                </div>
              ))}
            </Fragment>
          );
        }
        const Tag = group.list;
        return (
          <Tag key={index} start={group.start} style={listBoxStyle(font, group.indent)}>
            {group.lines.map((line, at) => (
              <li key={at} style={gap(line)}>
                {body(line.runs)}
              </li>
            ))}
          </Tag>
        );
      })}
    </>
  );
}

export const NodeView = memo(function NodeView({
  id,
  mask,
}: {
  id: string;
  /** clip or mask handed down by a masking sibling, merged over the node's own style */
  mask?: CSSProperties;
}) {
  const doc = useDoc();
  const store = useStore();
  const varNames = useVarNames();
  const tokens = useTokens();
  const baseModes = useDefaultModes();
  const swaps = useContext(SwapContext);
  // while a prototype is playing, this instance may be standing in for another
  // variant; its own box stays, the other's content is drawn inside it
  const swappedTo = swaps[id] ? doc[swaps[id]] : null;
  const editing = useUI((s) => s.editing);

  const node = doc[id];
  const isEditing = editing === id;

  if (!node || !node.visible) return null;

  // A frame that overrides a variable mode re-declares those variables on
  // itself; everything inside then inherits them through the ordinary cascade.
  const style = {
    ...nodeStyle(node, doc, varNames),
    ...mask,
    ...modeVars(node, tokens, baseModes),
  } as CSSProperties;
  // masks are resolved by the parent, because which layers one covers is a
  // question about the sibling order rather than about any single layer
  const masking = node.children.length ? maskStyles(node, doc) : null;
  // A shader fill is a live GPU surface, so it cannot be a `background` — it
  // gets a canvas at the bottom of the fill stack, beneath the image paints and
  // the children, which is where a fill belongs.
  const surface = node.type === 'shader' ? null : shaderSurface(node);
  // Noise, texture, progressive blur and glass need a surface of their own —
  // they paint over the node instead of styling it.
  const layers = effectLayers(effectsOf(node), node.clip);
  const overlays = layers.map((layer) => (
    <div key={layer.id} aria-hidden style={layer.style}>
      {layer.shader && <ShaderSurface shaderId={layer.shader.id} params={layer.shader.params} />}
    </div>
  ));

  // a web family has to be fetched before it can render; this is idempotent
  if (node.font) ensureFont(node.font.family);

  if (node.type === 'text') {
    if (isEditing) return <TextEditor node={node} style={style} />;
    const onPath = pathTextSpec(node, doc);
    return (
      <div data-node-id={id} style={style}>
        {onPath ? <PathText id={id} node={node} spec={onPath} /> : <TextBody node={node} />}
        {overlays}
      </div>
    );
  }

  // A slice paints nothing: it marks a region to export. The dashed outline
  // that shows where it is belongs to the editor chrome, not to the design, so
  // it is drawn by the overlay and never lands in an export.
  if (node.type === 'slice') {
    return <div data-node-id={id} data-slice="" style={{ ...style, background: 'none' }} />;
  }

  if (paintsWithPath(node)) {
    // A line's box is one axis thin, and a thin box is impossible to click.
    // A transparent pad carrying the same id widens what hit-testing sees
    // without changing what the layer measures or exports as.
    const thin = node.w < 12 || node.h < 12;
    return (
      <div data-node-id={id} style={style}>
        <PathShape node={node} />
        {thin && (
          <span
            data-node-id={id}
            aria-hidden
            style={{ position: 'absolute', inset: -6, display: 'block' }}
          />
        )}
        {overlays}
      </div>
    );
  }

  if (node.type === 'boolean') {
    return (
      <div data-node-id={id} style={style}>
        <BooleanShape node={node} doc={doc} />
        {overlays}
      </div>
    );
  }

  if (node.type === 'shader' && node.shader) {
    return (
      <div data-node-id={id} style={style}>
        <ShaderSurface shaderId={node.shader.id} params={node.shader.params} />
        {overlays}
      </div>
    );
  }

  return (
    <div
      data-node-id={id}
      // Scrolling and pinning are playback behaviour, not canvas behaviour, so
      // the intent is published as data and the Present stylesheet is what acts
      // on it. The canvas stays a flat board, as Figma's does.
      data-scroll={node.scroll && node.scroll !== 'none' ? node.scroll : undefined}
      data-fix={node.scrollBehavior && node.scrollBehavior !== 'scrolls' ? node.scrollBehavior : undefined}
      // "Show in exports", read back by the exporter off the element it is
      // about — the canvas keeps painting the fill either way
      data-export-background={node.exportBackground === false ? 'off' : undefined}
      style={style}
    >
      {surface && (
        <div aria-hidden style={surface.style}>
          <ShaderSurface shaderId={surface.shader.id} params={surface.shader.params} />
        </div>
      )}
      <PaintLayers node={node} />
      {node.video?.src && (
        <video
          key={node.video.src}
          src={node.video.src}
          loop={node.video.loop}
          muted={node.video.muted}
          autoPlay={node.video.autoplay}
          playsInline
          // the canvas owns pointer events; the element is paint only
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: node.video.fit,
            pointerEvents: 'none',
            borderRadius: 'inherit',
          }}
        />
      )}
      {(swappedTo?.children ?? node.children).map((childId) => (
        <NodeView key={childId} id={childId} mask={masking?.styles[childId]} />
      ))}
      {guidesOf(node).map((guide, index) => (
        <Guides key={guide.id ?? index} guides={guide} />
      ))}
      {overlays}
    </div>
  );
});
