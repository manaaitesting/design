'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useComments, useSession, useStore } from './Session';
import { toScreen, useUI } from '../state/ui';
import { readableOn } from '../lib/color';

function when(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Comment pins, anchored in world space.
 *
 * They live in the CRDT alongside the document but outside the undo scope —
 * ⌘Z should rewind your design, never someone else's remark.
 */
export function Comments() {
  const pageId = useUI((s) => s.page);
  const viewport = useUI((s) => s.viewport);
  const tool = useUI((s) => s.tool);
  const comments = useComments(pageId);
  const store = useStore();
  const { identity } = useSession();

  const [openId, setOpenId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState('');

  const visible = showResolved ? comments : comments.filter((c) => !c.resolved);
  if (tool !== 'comment' && visible.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
      {visible.map((comment) => {
        const { x, y } = toScreen(viewport, comment.x, comment.y);
        const open = openId === comment.id;
        return (
          <div key={comment.id} style={{ position: 'absolute', left: x, top: y }}>
            <button
              type="button"
              title={`${comment.authorName}: ${comment.body}`}
              onClick={() => setOpenId(open ? null : comment.id)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '999px 999px 999px 2px',
                border: 0,
                background: comment.resolved ? '#C8C8C8' : comment.authorColor,
                color: readableOn(comment.resolved ? '#C8C8C8' : comment.authorColor),
                fontWeight: 500,
                fontSize: 11,
                cursor: 'default',
                pointerEvents: 'auto',
                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                transform: 'translate(-2px, -24px)',
              }}
            >
              {comment.authorName.charAt(0).toUpperCase()}
            </button>

            {open && (
              <div
                style={{
                  position: 'absolute',
                  left: 28,
                  top: -24,
                  width: 240,
                  background: '#fff',
                  borderRadius: 8,
                  padding: 10,
                  boxShadow: 'var(--shadow-pop)',
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Entry
                  name={comment.authorName}
                  color={comment.authorColor}
                  body={comment.body}
                  at={comment.createdAt}
                />
                {comment.replies.map((reply, index) => (
                  <Entry
                    key={index}
                    name={reply.authorName}
                    color={reply.authorColor}
                    body={reply.body}
                    at={reply.createdAt}
                  />
                ))}

                <input
                  value={draft}
                  placeholder="Reply…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && draft.trim()) {
                      store.replyToComment(comment.id, {
                        authorName: identity.name,
                        authorColor: identity.color,
                        body: draft.trim(),
                        createdAt: Date.now(),
                      });
                      setDraft('');
                    }
                  }}
                  style={{
                    width: '100%',
                    height: 24,
                    marginTop: 8,
                    border: 0,
                    borderRadius: 5,
                    padding: '0 8px',
                    background: 'var(--color-control)',
                    boxShadow: 'var(--shadow-control)',
                    outline: 'none',
                  }}
                />

                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => store.updateComment(comment.id, { resolved: !comment.resolved })}
                  >
                    {comment.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <div style={{ flex: 1 }} />
                  {comment.authorId === identity.id && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        store.removeComment(comment.id);
                        setOpenId(null);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {tool === 'comment' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'var(--color-panel)',
            boxShadow: 'var(--shadow-pop)',
            pointerEvents: 'auto',
          }}
        >
          <Icon.Comment />
          <span>Click anywhere to leave a comment</span>
          <button type="button" className="btn" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
      )}
    </div>
  );
}

function Entry({ name, color, body, at }: { name: string; color: string; body: string; at: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
      <span
        style={{
          width: 18,
          height: 18,
          flex: 'none',
          borderRadius: 999,
          background: color,
          color: readableOn(color),
          display: 'grid',
          placeItems: 'center',
          fontSize: 10,
          fontWeight: 500,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 500 }}>{name}</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>{when(at)}</span>
        </div>
        <div style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>{body}</div>
      </div>
    </div>
  );
}

/** The inline composer shown after clicking with the comment tool. */
export function CommentComposer({
  at,
  onDone,
}: {
  at: { x: number; y: number };
  onDone: () => void;
}) {
  const viewport = useUI((s) => s.viewport);
  const pageId = useUI((s) => s.page);
  const setTool = useUI((s) => s.setTool);
  const store = useStore();
  const { identity } = useSession();
  const [body, setBody] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // autoFocus can lose the race with the popover's own mount; a frame settles it
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const screen = toScreen(viewport, at.x, at.y);

  const submit = () => {
    if (body.trim()) {
      store.addComment({
        page: pageId,
        x: at.x,
        y: at.y,
        authorId: identity.id,
        authorName: identity.name,
        authorColor: identity.color,
        body: body.trim(),
      });
    }
    onDone();
    setTool('move');
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: screen.x + 28,
        top: screen.y - 24,
        width: 240,
        background: '#fff',
        borderRadius: 8,
        padding: 10,
        boxShadow: 'var(--shadow-pop)',
        zIndex: 40,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        value={body}
        placeholder="Leave a comment…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            onDone();
            setTool('move');
          }
        }}
        style={{
          width: '100%',
          minHeight: 52,
          resize: 'vertical',
          border: 0,
          borderRadius: 5,
          padding: 8,
          background: 'var(--color-control)',
          boxShadow: 'var(--shadow-control)',
          outline: 'none',
          font: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => { onDone(); setTool('move'); }}>
          Cancel
        </button>
        <button type="button" className="btn btn-raised" onClick={submit}>
          Comment
        </button>
      </div>
    </div>
  );
}
