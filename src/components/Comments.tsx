'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';
import { Icon } from './ui/Icons';
import { useRects } from './Overlay';
import { useComments, useDoc, useSession, useStore } from './Session';
import { toScreen, useUI } from '../state/ui';
import { fitBounds } from '../lib/view';
import { pagePoint, type Doc } from '../document/types';
import { readableOn } from '../lib/color';
import type { Comment } from '../document/store';

function when(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export type ThreadFilter = 'open' | 'resolved' | 'mine';

/**
 * Which thread is open, and which threads are shown.
 *
 * The pins and the panel are two views of one list, so neither can own the
 * choice. It is not in `ui.ts` because nothing else in the editor has any
 * business knowing which remark you happen to have open.
 */
export const useThreads = create<{
  open: string | null;
  filter: ThreadFilter;
  setOpen: (id: string | null) => void;
  setFilter: (filter: ThreadFilter) => void;
}>((set) => ({
  open: null,
  filter: 'open',
  setOpen: (open) => set({ open }),
  setFilter: (filter) => set({ filter }),
}));

/** Whether a thread belongs in the list you are looking at. */
function matches(comment: Comment, filter: ThreadFilter, me: string): boolean {
  if (filter === 'resolved') return comment.resolved;
  const named = [comment.body, ...comment.replies.map((reply) => reply.body)].some((text) =>
    namesMe(text, me),
  );
  return filter === 'mine' ? named : !comment.resolved;
}

/** The pin's world point: on its layer if that layer is still in the file. */
function pinPoint(comment: Comment, doc: Doc): { x: number; y: number } {
  const anchor = comment.anchor;
  const node = anchor && doc[anchor.node];
  if (!anchor || !node) return { x: comment.x, y: comment.y };
  const at = pagePoint(anchor.node, doc);
  return { x: at.x + node.w * anchor.u, y: at.y + node.h * anchor.v };
}

/** Takes the canvas to a thread: its page, framed on its pin. */
function reveal(comment: Comment, doc: Doc): void {
  const ui = useUI.getState();
  ui.setPage(comment.page);
  const at = pinPoint(comment, doc);
  ui.setViewport(
    fitBounds(
      { minX: at.x - 240, minY: at.y - 160, maxX: at.x + 240, maxY: at.y + 160 },
      ui.leftPanel,
      ui.leftWidth,
      ui.rightWidth,
    ),
  );
}

/**
 * Where a pin sits: on the layer it is about, if that layer is still there.
 *
 * Measured from the DOM rather than computed, for the same reason the selection
 * chrome is — the browser has already resolved auto layout, so a pin on a child
 * of a reflowed frame lands where the child actually ended up.
 */
export function anchorIn(
  node: string | undefined,
  clientX: number,
  clientY: number,
): Comment['anchor'] {
  if (!node) return undefined;
  const box = document.querySelector(`[data-node-id="${node}"]`)?.getBoundingClientRect();
  if (!box?.width || !box.height) return undefined;
  return { node, u: (clientX - box.left) / box.width, v: (clientY - box.top) / box.height };
}

/**
 * Comment pins, anchored to the layer they were left on.
 *
 * They live in the CRDT alongside the document but outside the undo scope —
 * ⌘Z should rewind your design, never someone else's remark.
 */
export function Comments({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const pageId = useUI((s) => s.page);
  const viewport = useUI((s) => s.viewport);
  const tool = useUI((s) => s.tool);
  // the view menu hides the pins; the comment tool still works, exactly as in
  // Figma, because turning them off is about reading the design, not editing it
  const shown = useUI((s) => s.view.comments);
  const comments = useComments(pageId);
  const store = useStore();
  const { identity } = useSession();

  const openId = useThreads((s) => s.open);
  const setOpenId = useThreads((s) => s.setOpen);
  const filter = useThreads((s) => s.filter);
  const setFilter = useThreads((s) => s.setFilter);
  const setInspectorTab = useUI((s) => s.setInspectorTab);
  const [draft, setDraft] = useState('');

  // Reaching for the comment tool is asking to work on comments, and the list
  // is where the threads you cannot see from here are.
  useEffect(() => {
    if (tool === 'comment') setInspectorTab('comments');
  }, [tool, setInspectorTab]);

  const all = comments.filter((comment) => matches(comment, filter, identity.name));
  const visible = shown ? all : [];
  const rects = useRects(
    visible.flatMap((comment) => (comment.anchor ? [comment.anchor.node] : [])),
    containerRef,
  );
  if (tool !== 'comment' && visible.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
      {visible.map((comment) => {
        // the layer it was left on, if it is still on this page; otherwise the
        // point it was dropped at, so a remark outlives the thing it was about
        const rect = comment.anchor && rects[comment.anchor.node];
        const { x, y } = rect
          ? { x: rect.x + rect.w * comment.anchor!.u, y: rect.y + rect.h * comment.anchor!.v }
          : toScreen(viewport, comment.x, comment.y);
        const open = openId === comment.id;
        return (
          <div key={comment.id} style={{ position: 'absolute', left: x, top: y }}>
            <button
              type="button"
              title={`${comment.authorName}: ${comment.body}`}
              data-mine={
                [comment.body, ...comment.replies.map((reply) => reply.body)].some((text) =>
                  namesMe(text, identity.name),
                ) || undefined
              }
              className="fig-pin"
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
          <button
            type="button"
            className="btn"
            onClick={() => setFilter(filter === 'resolved' ? 'open' : 'resolved')}
          >
            {filter === 'resolved' ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A comment's text, with the people in it picked out.
 *
 * Mentions are plain text — `@name` — because that is what someone types and
 * what survives a copy out of the thread. Marking them up on the way to the
 * screen is enough to make a thread scannable, and the person named gets a flag
 * on the pin without a notification system behind it.
 */
export function mentions(body: string): string[] {
  return [...body.matchAll(/@([\p{L}][\p{L}\d'’-]*)/gu)].map((match) => match[1].toLowerCase());
}

/** True when this thread names you — the pin marks it. */
export function namesMe(text: string, me: string): boolean {
  const first = me.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return false;
  return mentions(text).some((name) => name === first || me.toLowerCase().startsWith(name));
}

function Body({ text }: { text: string }) {
  const parts = text.split(/(@[\p{L}][\p{L}\d'’-]*)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('@') ? (
          <span key={index} className="fig-mention">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
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
        <div style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>
          <Body text={body} />
        </div>
      </div>
    </div>
  );
}

const FILTERS: { key: ThreadFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'mine', label: 'Mentions me' },
];

/**
 * Every thread in the file, as a list.
 *
 * A pin is only reachable if you can already see it, which leaves a thread that
 * is off-screen, on another page, or resolved with no entry point at all — you
 * cannot answer "what is still open?" by looking at the canvas. So this lists
 * the whole file rather than the page, newest first, and a row takes the canvas
 * to its pin and opens it.
 */
export function CommentsPanel() {
  const doc = useDoc();
  const page = useUI((s) => s.page);
  const { identity } = useSession();
  const comments = useComments();
  const filter = useThreads((s) => s.filter);
  const setFilter = useThreads((s) => s.setFilter);
  const setOpen = useThreads((s) => s.setOpen);

  const threads = comments
    .filter((comment) => matches(comment, filter, identity.name))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <>
      <div className="fig-tabs" style={{ height: 32 }}>
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="fig-tab"
            data-on={filter === entry.key}
            onClick={() => setFilter(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="scroll" style={{ flex: 1 }}>
        {threads.length === 0 ? (
          <div className="fig-thread-empty">Nothing here.</div>
        ) : (
          threads.map((comment) => (
            <button
              key={comment.id}
              type="button"
              className="fig-thread"
              data-mine={
                matches(comment, 'mine', identity.name) && !comment.resolved ? true : undefined
              }
              onClick={() => {
                reveal(comment, doc);
                setOpen(comment.id);
              }}
            >
              <span
                className="fig-thread-avatar"
                style={{
                  background: comment.authorColor,
                  color: readableOn(comment.authorColor),
                }}
              >
                {comment.authorName.charAt(0).toUpperCase()}
              </span>
              <span className="fig-thread-body">
                <span className="fig-thread-head">
                  <span className="fig-thread-name">{comment.authorName}</span>
                  <span className="fig-thread-when">{when(comment.createdAt)}</span>
                </span>
                <span className="fig-thread-snippet">{comment.body}</span>
                <span className="fig-thread-meta">
                  {comment.page !== page && `${doc[comment.page]?.name ?? 'Another page'} · `}
                  {comment.replies.length === 1
                    ? '1 reply'
                    : `${comment.replies.length} replies`}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

/** The inline composer shown after clicking with the comment tool. */
export function CommentComposer({
  at,
  onDone,
}: {
  at: { x: number; y: number; anchor?: Comment['anchor'] };
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
        anchor: at.anchor,
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
