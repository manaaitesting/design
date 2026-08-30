'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';
import { Icon } from './ui/Icons';
import { useRects } from './Overlay';
import { useComments, useDoc, usePresence, useSession, useStore } from './Session';
import { listMembersAction } from '../server/actions';
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
  if (filter === 'mine') return namesMe(comment, me);
  return !comment.resolved;
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

interface Person {
  id: string;
  name: string;
  color: string;
}

/**
 * The people you can name here: everyone with access, plus whoever is in the
 * room. Presence alone would only offer the people who are already reading over
 * your shoulder, which is not who a mention is usually for.
 */
function usePeople(): Person[] {
  const { provider, identity } = useSession();
  const presence = usePresence();
  const [members, setMembers] = useState<Person[]>([]);

  useEffect(() => {
    let live = true;
    void listMembersAction(provider.roomname).then((list) => live && setMembers(list));
    return () => {
      live = false;
    };
  }, [provider]);

  const people = new Map<string, Person>([[identity.id, identity]]);
  for (const member of members) people.set(member.id, member);
  for (const peer of presence) people.set(peer.identity.id, peer.identity);
  return [...people.values()];
}

/** A mention is one word, so it is the first word of the name that is written. */
function firstName(person: Person): string {
  return person.name.trim().split(/\s+/)[0] ?? person.name;
}

/**
 * The `@name` being typed, if one is.
 *
 * Only at the end of the box: that is where an `@` is being typed, and reading
 * it off the value alone keeps the picker a pure function of what you can see.
 */
const TYPING = /(?:^|\s)@([\p{L}\d'’-]*)$/u;

function typing(value: string): string | null {
  return TYPING.exec(value)?.[1].toLowerCase() ?? null;
}

function offer(people: Person[], query: string | null): Person[] {
  if (query === null) return [];
  return people.filter((person) => person.name.toLowerCase().startsWith(query)).slice(0, 6);
}

function withMention(value: string, person: Person): string {
  return `${value.replace(TYPING, (match) => match.slice(0, match.indexOf('@')))}@${firstName(person)} `;
}

/** The accounts a finished message actually names, from the ones that were picked. */
function mentionedIds(body: string, picked: Person[]): string[] {
  const written = new Set(
    [...body.matchAll(/@([\p{L}][\p{L}\d'’-]*)/gu)].map((match) => match[1].toLowerCase()),
  );
  return [
    ...new Set(
      picked.filter((person) => written.has(firstName(person).toLowerCase())).map((p) => p.id),
    ),
  ];
}

/**
 * The `@` picker.
 *
 * A mention that is only text is a guess: it used to be matched against your
 * name by prefix, so `@a` reached every Alex in the file and a name typed
 * slightly wrong reached nobody. Resolving it against a real person as it is
 * typed is what makes it a reference.
 */
function Mentions({
  options,
  onPick,
}: {
  options: Person[];
  onPick: (person: Person) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="fig-mention-list">
      {options.map((person) => (
        <button
          key={person.id}
          type="button"
          className="fig-mention-option"
          // the box must not lose focus, or the caret goes with it
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(person);
          }}
        >
          <span className="fig-mention-dot" style={{ background: person.color }} />
          {person.name}
        </button>
      ))}
    </div>
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

  // Reaching for the comment tool is asking to work on comments, and the list
  // is where the threads you cannot see from here are.
  useEffect(() => {
    if (tool === 'comment') setInspectorTab('comments');
  }, [tool, setInspectorTab]);

  const all = comments.filter((comment) => matches(comment, filter, identity.id));
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
              data-mine={namesMe(comment, identity.id) || undefined}
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
                  reactions={comment.reactions}
                  me={identity.id}
                  onReact={(emoji) => store.toggleReaction(comment.id, -1, emoji, identity.id)}
                />
                {comment.replies.map((reply, index) => (
                  <Entry
                    key={index}
                    name={reply.authorName}
                    color={reply.authorColor}
                    body={reply.body}
                    at={reply.createdAt}
                    reactions={reply.reactions}
                    me={identity.id}
                    onReact={(emoji) => store.toggleReaction(comment.id, index, emoji, identity.id)}
                  />
                ))}

                <ReplyBox id={comment.id} />

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
 * True when this thread names you — the pin marks it.
 *
 * A mention used to be a regex over the text matched against your name, and one
 * of its clauses accepted any prefix: `@a` in anyone's comment lit up the pin
 * for every Alex in the file, and a name typed slightly wrong reached nobody at
 * all. The picker resolves a mention to an account as it is typed, so this is
 * now an id check and nothing else.
 */
export function namesMe(comment: Comment, me: string): boolean {
  return [comment, ...comment.replies].some((message) => message.mentions?.includes(me));
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

/**
 * The reply line at the foot of an open thread.
 *
 * Its own component because it is the only thing here that needs the file's
 * members: `usePeople` watches presence and asks the server who has access, and
 * the pin layer — which is mounted for the whole life of the canvas — has no
 * business re-rendering every time somebody moves their pointer.
 */
function ReplyBox({ id }: { id: string }) {
  const store = useStore();
  const { identity } = useSession();
  const people = usePeople();
  const [draft, setDraft] = useState('');
  /** the people this reply picked, so a mention resolves to an account */
  const [named, setNamed] = useState<Person[]>([]);
  const ref = useRef<HTMLInputElement>(null);

  const options = offer(people, typing(draft));
  const pick = (person: Person) => {
    setDraft(withMention(draft, person));
    setNamed((list) => [...list, person]);
    ref.current?.focus();
  };

  const send = () => {
    const mentions = mentionedIds(draft, named);
    store.replyToComment(id, {
      authorName: identity.name,
      authorColor: identity.color,
      body: draft.trim(),
      createdAt: Date.now(),
      ...(mentions.length && { mentions }),
    });
    setDraft('');
    setNamed([]);
  };

  return (
    <div style={{ position: 'relative' }}>
      <Mentions options={options} onPick={pick} />
      <input
        ref={ref}
        value={draft}
        placeholder="Reply…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Enter') return;
          // while the picker is up, ⏎ takes the person rather than posting
          if (options.length) pick(options[0]);
          else if (draft.trim()) send();
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
    </div>
  );
}

/** Figma's six, which is all a reaction row ever needs to be. */
const REACTIONS = ['👍', '❤️', '🎉', '😄', '😮', '👀'];

/**
 * The reactions on one message.
 *
 * Every acknowledgement used to cost a whole reply, so a thread that should
 * have been one line and a thumbs-up became four messages that then had to be
 * resolved. Reactions sit outside the undo scope for free, since the comments
 * map already is.
 */
function Reactions({
  reactions,
  me,
  onReact,
}: {
  reactions: Record<string, string[]> | undefined;
  me: string;
  onReact: (emoji: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const held = Object.entries(reactions ?? {}).filter(([, who]) => who.length);

  return (
    <div className="fig-react">
      {held.map(([emoji, who]) => (
        <button
          key={emoji}
          type="button"
          className="fig-react-chip"
          data-mine={who.includes(me) || undefined}
          title={`${who.length} ${who.length === 1 ? 'person' : 'people'}`}
          onClick={() => onReact(emoji)}
        >
          {emoji} {who.length}
        </button>
      ))}
      <button
        type="button"
        className="fig-react-chip"
        title="React"
        onClick={() => setPicking(!picking)}
      >
        ＋
      </button>
      {picking && (
        <div className="fig-react-pick">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact(emoji);
                setPicking(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Entry({
  name,
  color,
  body,
  at,
  reactions,
  me,
  onReact,
}: {
  name: string;
  color: string;
  body: string;
  at: number;
  reactions?: Record<string, string[]>;
  me: string;
  onReact: (emoji: string) => void;
}) {
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
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 500 }}>{name}</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>{when(at)}</span>
        </div>
        <div style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>
          <Body text={body} />
        </div>
        <Reactions reactions={reactions} me={me} onReact={onReact} />
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
    .filter((comment) => matches(comment, filter, identity.id))
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
                matches(comment, 'mine', identity.id) && !comment.resolved ? true : undefined
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
  const people = usePeople();
  const [named, setNamed] = useState<Person[]>([]);
  const options = offer(people, typing(body));

  // autoFocus can lose the race with the popover's own mount; a frame settles it
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const screen = toScreen(viewport, at.x, at.y);

  const pick = (person: Person) => {
    setBody(withMention(body, person));
    setNamed((list) => [...list, person]);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (body.trim()) {
      const mentions = mentionedIds(body, named);
      store.addComment({
        page: pageId,
        x: at.x,
        y: at.y,
        anchor: at.anchor,
        authorId: identity.id,
        authorName: identity.name,
        authorColor: identity.color,
        body: body.trim(),
        ...(mentions.length && { mentions }),
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
      <div style={{ position: 'relative' }}>
        <Mentions options={options} onPick={pick} />
        <textarea
          ref={inputRef}
          value={body}
          placeholder="Leave a comment…"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              // while the picker is up, ⏎ takes the person rather than posting
              if (options.length) pick(options[0]);
              else submit();
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
            display: 'block',
          }}
        />
      </div>
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
