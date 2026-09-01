'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useStore } from './Session';
import { useUI } from '../state/ui';
import { viewCentre } from '../lib/view';
import { generateImageFill, generateSvg } from '../lib/generate';
import { ROOT_ID } from '../document/types';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };

function aiCreate(prompt: string, store: ReturnType<typeof useStore>, pageId: string, viewport: { x: number; y: number; zoom: number }) {
  const center = viewCentre(viewport);
  const lower = prompt.toLowerCase();
  const created: string[] = [];

  const frameAt = (x: number, y: number, w: number, h: number, name: string, fill: string | null = '#FFFFFF') =>
    store.create('frame', pageId, { name, x: x - w / 2, y: y - h / 2, w, h, fill, clip: true, radius: 12 });

  const textIn = (parent: string, txt: string, x: number, y: number, w: number, h: number, fontSize = 14, weight = 400, color = '#111') =>
    store.create('text', parent, { name: txt.slice(0, 20), text: txt, x, y, w, h, wMode: 'fixed', hMode: 'fit', font: { size: fontSize, weight, color } as any });

  const rectIn = (parent: string, x: number, y: number, w: number, h: number, fill: string, radius = 8) =>
    store.create('rect', parent, { name: 'Rect', x, y, w, h, fill, radius });

  // helper to pick accent from prompt hash via generateImageFill
  const accent = () => generateImageFill(prompt).split(',').pop()?.trim() ?? '#0D99FF';

  if (lower.includes('dashboard')) {
    const f = frameAt(center.x, center.y, 720, 460, 'AI — Dashboard', '#F8FAFC');
    created.push(f);
    textIn(f, 'Dashboard', 24, 18, 200, 24, 20, 600);
    textIn(f, 'Overview of your workspace', 24, 44, 300, 16, 11, 400, '#64748B');
    // stat cards
    [0, 1, 2].forEach((i) => {
      rectIn(f, 24 + i * 222, 80, 200, 96, '#FFFFFF', 12);
      textIn(f, ['Revenue', 'Users', 'Orders'][i], 36 + i * 222, 96, 120, 14, 11, 500, '#64748B');
      textIn(f, ['$24,420', '1,342', '89'][i], 36 + i * 222, 114, 120, 20, 20, 700);
      rectIn(f, 36 + i * 222, 148, 60, 6, accent(), 3);
    });
    // chart placeholder
    rectIn(f, 24, 196, 672, 160, '#FFFFFF', 12);
    textIn(f, 'Revenue trend', 36, 208, 200, 14, 11, 600);
    rectIn(f, 36, 234, 648, 80, generateImageFill(prompt), 8);
    // bottom cards
    rectIn(f, 24, 376, 326, 60, '#FFFFFF', 12);
    textIn(f, 'Recent project — Paperlike', 36, 386, 200, 14, 12, 500);
    textIn(f, 'Updated 2h ago', 36, 404, 200, 14, 11, 400, '#94A3B8');
    rectIn(f, 370, 376, 326, 60, '#0F172A', 12);
    textIn(f, 'Invite team', 386, 394, 200, 14, 12, 600, '#FFFFFF');
    return { frame: f, summary: 'Created dashboard — header, 3 stat cards, chart and footer CTA' };
  }

  if (lower.includes('pricing')) {
    const f = frameAt(center.x, center.y, 720, 380, 'AI — Pricing', '#F8FAFC');
    created.push(f);
    textIn(f, 'Pricing', 24, 20, 200, 24, 18, 600);
    ['Starter', 'Pro', 'Scale'].forEach((name, i) => {
      const x = 24 + i * 222;
      rectIn(f, x, 60, 200, 260, '#FFFFFF', 16);
      textIn(f, name, x + 16, 80, 168, 16, 13, 600);
      textIn(f, `$${[19, 49, 99][i]}/mo`, x + 16, 104, 168, 16, 20, 700);
      textIn(f, ['1 workspace', 'Unlimited projects', 'SSO & audit'][i], x + 16, 136, 168, 14, 11, 400, '#64748B');
      rectIn(f, x + 16, 260, 168, 32, i === 1 ? '#0D99FF' : '#F1F5F9', 8);
      textIn(f, 'Get started', x + 16, 268, 168, 16, 11, 600, i === 1 ? '#FFFFFF' : '#0F172A');
    });
    return { frame: f, summary: 'Created pricing — 3 tiers with CTA' };
  }

  if (lower.includes('login') || lower.includes('auth') || lower.includes('sign')) {
    const f = frameAt(center.x, center.y, 420, 460, 'AI — Login', '#FFFFFF');
    created.push(f);
    textIn(f, 'Welcome back', 32, 32, 356, 24, 20, 650);
    textIn(f, 'Sign in to your workspace', 32, 60, 356, 16, 11, 400, '#64748B');
    textIn(f, 'Email', 32, 104, 356, 14, 11, 500, '#475569');
    rectIn(f, 32, 124, 356, 36, '#F8FAFC', 8);
    textIn(f, 'you@company.com', 44, 135, 200, 14, 11, 400, '#94A3B8');
    textIn(f, 'Password', 32, 172, 356, 14, 11, 500, '#475569');
    rectIn(f, 32, 192, 356, 36, '#F8FAFC', 8);
    rectIn(f, 32, 252, 356, 36, '#0D99FF', 8);
    textIn(f, 'Continue →', 32, 260, 356, 20, 11, 600, '#FFFFFF');
    textIn(f, 'Forgot password?', 32, 296, 356, 14, 11, 400, '#0D99FF');
    return { frame: f, summary: 'Created login form — email, password and CTA' };
  }

  if (lower.includes('card')) {
    const f = frameAt(center.x, center.y, 640, 260, 'AI — Cards', '#F8FAFC');
    created.push(f);
    [0, 1, 2].forEach((i) => {
      const x = 20 + i * 200;
      rectIn(f, x, 20, 180, 220, '#FFFFFF', 14);
      rectIn(f, x + 12, 32, 156, 96, generateImageFill(prompt + i), 10);
      textIn(f, prompt.slice(0, 18) || 'Card title', x + 12, 140, 156, 14, 12, 600);
      textIn(f, 'A concise description that fits two lines nicely.', x + 12, 158, 156, 32, 10, 400, '#64748B');
      rectIn(f, x + 12, 200, 70, 22, '#F1F5F9', 6);
      textIn(f, 'Learn more', x + 12, 206, 70, 10, 10, 500, '#0F172A');
    });
    return { frame: f, summary: `Created 3 cards for "${prompt}"` };
  }

  // generic hero
  const f = frameAt(center.x, center.y, 720, 420, `AI — ${prompt.slice(0, 24) || 'Section'}`, '#FFFFFF');
  created.push(f);
  textIn(f, prompt.slice(0, 48) || 'Design generated from your prompt', 32, 32, 460, 48, 28, 700);
  textIn(f, 'This frame was generated by AI. Edit text, colors and layout directly on canvas — every element is a real layer.', 32, 88, 460, 40, 11, 400, '#64748B');
  rectIn(f, 32, 144, 140, 36, '#0D99FF', 8);
  textIn(f, 'Get started', 32, 152, 140, 20, 11, 600, '#FFFFFF');
  rectIn(f, 184, 144, 120, 36, '#F1F5F9', 8);
  textIn(f, 'Learn more', 184, 152, 120, 20, 11, 500, '#0F172A');
  // visual
  rectIn(f, 520, 32, 168, 220, generateImageFill(prompt), 16);
  // fallback: if prompt looks like image request, also add image fill
  if (lower.includes('image') || lower.includes('photo')) {
    const img = store.create('image', f, {
      name: 'AI Image',
      x: 520,
      y: 32,
      w: 168,
      h: 220,
      radius: 16,
      fill: generateImageFill(prompt),
    });
    created.push(img);
  } else if (lower.includes('logo') || lower.includes('icon')) {
    const svg = store.create('image', f, {
      name: 'AI SVG',
      x: 520,
      y: 32,
      w: 168,
      h: 168,
      radius: 16,
      fill: generateSvg(prompt),
    });
    created.push(svg);
  }
  return { frame: f, summary: `Created hero section for "${prompt}" — title, copy, CTAs and visual` };
}

export function AiChatSidebar() {
  const store = useStore();
  const page = useUI((s) => s.page);
  const viewport = useUI((s) => s.viewport);
  const open = useUI((s) => s.aiChatOpen);
  const setOpen = useUI((s) => s.setAiChatOpen);
  const select = useUI((s) => s.select);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 'm0', role: 'assistant', text: 'Hi! I’m your design assistant. Describe what you want — e.g. “pricing cards”, “dashboard with stats”, “login form” — and I’ll create editable layers on the canvas.' },
  ]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      const h = Math.min(taRef.current.scrollHeight, 84);
      taRef.current.style.height = h + 'px';
    }
  }, [input]);

  if (!open) return null;

  const send = async (text: string = input) => {
    const prompt = text.trim();
    if (!prompt) return;
    const userMsg: Msg = { id: Math.random().toString(36).slice(2), role: 'user', text: prompt };
    setMsgs((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    // simulate thinking
    await new Promise((r) => setTimeout(r, 480));
    try {
      const { frame, summary } = aiCreate(prompt, store, page, viewport);
      // select the created frame so user sees it
      select([frame]);
      // nudge viewport to frame
      // we rely on store commit; selection will follow
      setMsgs((m) => [
        ...m,
        { id: Math.random().toString(36).slice(2), role: 'assistant', text: `${summary}. You can edit every layer directly.` },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { id: Math.random().toString(36).slice(2), role: 'assistant', text: 'Sorry, I could not create that. Try a different prompt.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fig"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        bottom: 8,
        width: 360,
        zIndex: 18,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        border: '1px solid #ececec',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: 'none',
      }}
    >
      <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 14px', borderBottom: '1px solid #ececec' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: '#0D99FF', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>✦</span>
        <span style={{ fontWeight: 600, flex: 1 }}>AI Assistant</span>
        <span style={{ fontSize: 10, color: '#94A3B8', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 6px' }}>Chat</span>
        <button
          type="button"
          className="fig-btn"
          title="Close AI chat"
          onClick={() => setOpen(false)}
          style={{ marginLeft: 4 }}
        >
          ✕
        </button>
      </div>

      <div ref={listRef} className="scroll" style={{ flex: 1, padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc' }}>
        {msgs.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '84%',
              padding: '8px 10px',
              borderRadius: 12,
              borderBottomRightRadius: m.role === 'user' ? 4 : 12,
              borderBottomLeftRadius: m.role === 'assistant' ? 4 : 12,
              background: m.role === 'user' ? '#0D99FF' : '#fff',
              color: m.role === 'user' ? '#fff' : '#0f172a',
              border: m.role === 'assistant' ? '1px solid #e2e8f0' : '0',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              boxShadow: m.role === 'assistant' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', padding: '8px 10px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <span className="ai-dot" /> Thinking
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 12px 10px', borderTop: 0, background: '#fff' }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            minHeight: 52,
            padding: '8px',
            borderRadius: 14,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 110,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              padding: '8px 8px 8px 12px',
              border: focused ? '1px solid #0D99FF' : '1px solid #e2e8f0',
              borderRadius: 12,
              background: '#fff',
              boxShadow: focused ? '0 0 0 3px rgba(13,153,255,0.12), 0 1px 2px rgba(0,0,0,0.04)' : '0 1px 2px rgba(0,0,0,0.04)',
              transition: 'border-color 150ms, box-shadow 150ms',
            }}
          >
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Describe a design…"
              rows={1}
              style={{
                flex: 1,
                border: 0,
                outline: 'none',
                resize: 'none',
                fontSize: 12.5,
                lineHeight: '18px',
                maxHeight: 84,
                minHeight: 18,
                height: 18,
                background: 'transparent',
                fontFamily: 'inherit',
                color: '#0f172a',
                padding: '1px 0',
              }}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={!input.trim() || busy}
              title={busy ? 'Generating…' : 'Send — Enter'}
              aria-label="Send"
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                border: 0,
                background: busy ? '#e2e8f0' : input.trim() ? '#0D99FF' : '#f1f5f9',
                color: busy ? '#94a3b8' : input.trim() ? '#fff' : '#cbd5e1',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
                cursor: busy ? 'default' : input.trim() ? 'pointer' : 'default',
                opacity: busy ? 0.7 : 1,
                transform: input.trim() && !busy ? 'scale(1)' : 'scale(0.98)',
                transition: 'all 150ms ease',
                boxShadow: input.trim() && !busy ? '0 2px 6px rgba(13,153,255,0.3)' : 'none',
              }}
            >
              {busy ? (
                <span style={{ width: 14, height: 14, border: '2px solid #94a3b8', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'ai-spin 0.8s linear infinite' } as any} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: '#22c55e', display: 'inline-block', boxShadow: '0 0 0 3px rgba(34,197,94,0.15)' }} />
            AI creates real editable layers
          </div>
          <div style={{ fontSize: 10, color: '#cbd5e1' }}>↵ send · ⇧↵ newline</div>
        </div>
      </div>

      <style>{`@keyframes ai-bounce{0%,80%,100%{opacity:.3}40%{opacity:1}}.ai-dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#94a3b8;animation:ai-bounce 1s infinite}@keyframes ai-spin{to{transform:rotate(360deg)}}textarea::placeholder{color:#94a3b8}`}</style>
    </div>
  );
}
