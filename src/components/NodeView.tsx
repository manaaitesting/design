'use client';

import { memo, useEffect, useRef } from 'react';
import { nodeStyle } from '../document/css';
import { effectLayers, effectsOf } from '../document/effects';
import { ShaderSurface } from './ShaderSurface';
import { Guides } from './Guides';
import { VectorShape } from './VectorShape';
import { useDoc, useStore, useVarNames } from './Session';
import { useUI } from '../state/ui';
import type { SceneNode } from '../document/types';

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
 * turn the same string into one element per line.
 */
function TextBody({ node }: { node: SceneNode }) {
  const font = node.font;
  const spacing = font?.paragraphSpacing ?? 0;
  const list = font?.list && font.list !== 'none' ? font.list : null;
  const text = node.text ?? '';
  if (!spacing && !list) return <>{text}</>;

  const lines = text.split('\n');
  if (!list) {
    return (
      <>
        {lines.map((line, index) => (
          <div key={index} style={index ? { marginTop: spacing } : undefined}>
            {line}
          </div>
        ))}
      </>
    );
  }

  const Tag = list === 'number' ? 'ol' : 'ul';
  return (
    <Tag style={{ margin: 0, paddingLeft: '1.4em' }}>
      {lines.map((line, index) => (
        <li key={index} style={index ? { marginTop: spacing } : undefined}>
          {line}
        </li>
      ))}
    </Tag>
  );
}

export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const doc = useDoc();
  const store = useStore();
  const varNames = useVarNames();
  const editing = useUI((s) => s.editing);
  const setEditing = useUI((s) => s.setEditing);
  const editorRef = useRef<HTMLDivElement>(null);

  const node = doc[id];
  const isEditing = editing === id;

  useEffect(() => {
    if (!isEditing) return;
    // wait a frame: a node created by the text tool is still being laid out,
    // and focusing too early silently fails
    const frame = requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  if (!node || !node.visible) return null;

  const style = nodeStyle(node, doc, varNames);
  // Noise, texture, progressive blur and glass need a surface of their own —
  // they paint over the node instead of styling it.
  const layers = effectLayers(effectsOf(node), node.clip);
  const overlays = layers.map((layer) => (
    <div key={layer.id} aria-hidden style={layer.style}>
      {layer.shader && <ShaderSurface shaderId={layer.shader.id} params={layer.shader.params} />}
    </div>
  ));

  if (node.type === 'text') {
    if (isEditing) {
      return (
        <div
          ref={editorRef}
          data-node-id={id}
          contentEditable
          suppressContentEditableWarning
          style={{ ...style, outline: '1.5px solid var(--color-select)', cursor: 'text' }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).blur();
            }
          }}
          onBlur={(e) => {
            store.update(id, { text: e.currentTarget.innerText ?? '' });
            setEditing(null);
          }}
        >
          {node.text}
        </div>
      );
    }
    return (
      <div data-node-id={id} style={style}>
        <TextBody node={node} />
        {overlays}
      </div>
    );
  }

  if (node.type === 'vector') {
    return (
      <div data-node-id={id} style={style}>
        <VectorShape node={node} />
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
    <div data-node-id={id} style={style}>
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
      {node.children.map((childId) => (
        <NodeView key={childId} id={childId} />
      ))}
      {node.guides && <Guides guides={node.guides} />}
      {overlays}
    </div>
  );
});
