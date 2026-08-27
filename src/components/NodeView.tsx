'use client';

import { memo, useEffect, useRef } from 'react';
import { nodeStyle } from '../document/css';
import { ShaderSurface } from './ShaderSurface';
import { Guides } from './Guides';
import { VectorShape } from './VectorShape';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';

/**
 * Renders one scene node as real DOM.
 *
 * There is no custom layout pass here — the browser lays the tree out from the
 * styles in `nodeStyle`, which is also what gets exported. A flex frame on the
 * canvas reflows exactly like the shipped component will.
 */
export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const doc = useDoc();
  const store = useStore();
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

  const style = nodeStyle(node, doc);

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
            store.update(id, { text: e.currentTarget.textContent ?? '' });
            setEditing(null);
          }}
        >
          {node.text}
        </div>
      );
    }
    return (
      <div data-node-id={id} style={style}>
        {node.text}
      </div>
    );
  }

  if (node.type === 'vector') {
    return (
      <div data-node-id={id} style={style}>
        <VectorShape node={node} />
      </div>
    );
  }

  if (node.type === 'shader' && node.shader) {
    return (
      <div data-node-id={id} style={style}>
        <ShaderSurface shaderId={node.shader.id} params={node.shader.params} />
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
    </div>
  );
});
