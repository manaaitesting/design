'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from './Session';
import { useUI } from '../state/ui';
import { readableOn } from '../lib/color';

/**
 * Cursor chat.
 *
 * Press `/` and type: what you write rides along beside your pointer for
 * everyone else in the room, and clears when you stop. It is the lightest way
 * to say something in a design review, and it deliberately leaves no trace —
 * a remark that should outlive the moment is a comment, not this.
 */
export function CursorChat() {
  const { provider, identity } = useSession();
  const open = useUI((s) => s.chatting);
  const setOpen = useUI((s) => s.setChatting);
  const viewport = useUI((s) => s.viewport);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  // opening on `/` is a global gesture, so it lives here rather than in the
  // editor's key map — it must not fire while anything else has the keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !useUI.getState().chatting) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  // follow the pointer while the box is open, so it stays where you are
  useEffect(() => {
    if (!open) return;
    const move = (event: PointerEvent) => setAt({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setText('');
      provider.awareness.setLocalStateField('chat', null);
    }
  }, [open, provider]);

  useEffect(() => {
    if (!open) return;
    provider.awareness.setLocalStateField('chat', text || null);
  }, [text, open, provider]);

  if (!open) return null;
  const point = at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  void viewport;

  return (
    <div
      className="fig-cursor-chat"
      style={{
        left: point.x + 14,
        top: point.y + 10,
        background: identity.color,
        color: readableOn(identity.color),
      }}
    >
      <input
        ref={inputRef}
        value={text}
        placeholder="Say something…"
        maxLength={140}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' || event.key === 'Enter') setOpen(false);
        }}
        onBlur={() => setOpen(false)}
      />
    </div>
  );
}
