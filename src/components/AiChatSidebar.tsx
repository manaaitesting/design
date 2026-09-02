'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useDoc, useStore } from './Session';
import { useUI } from '../state/ui';
import { fitBounds, viewCentre } from '../lib/view';
import { generateImageFill, generateSvg } from '../lib/generate';
import { readHtmlInBrowser, writeSpecs, type NodeSpec } from '../lib/html-import';
import { ROOT_ID, type Doc, type SceneNode } from '../document/types';
import type { DocStore } from '../document/store';

/**
 * The design assistant.
 *
 * Describe a screen — or a flow of them — and it lands on the canvas as real,
 * editable layers: frames with auto layout, text, images. The model answers in
 * HTML and CSS (`app/api/ai/design`), and the browser turns that into layers
 * through the same importer the MCP server uses, so the assistant, an agent
 * over MCP and a hand-built screen are all the same kind of thing afterwards.
 *
 * Pictures can be attached — dropped, pasted or picked — and go to the model
 * as reference; ask for one to be used and it is placed as an image layer.
 * Without a model key on the server the assistant still works from a few
 * built-in templates, and says so.
 */

type Attachment = {
  id: string;
  name: string;
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** base64 payload without the data: prefix */
  data: string;
  /** the same picture as a data url, for the thumbnail and the canvas */
  url: string;
};

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
  /** what the turn built, so a click brings it back into view */
  built?: string[];
  tone?: 'note' | 'error';
};

type Status = { ready: boolean; model?: string } | null;

const SUGGESTIONS = [
  'Login and sign-up screens for a mobile banking app',
  'SaaS analytics dashboard, desktop, with a sidebar',
  'Onboarding flow — 3 mobile screens',
  'Pricing page with three tiers',
  'E-commerce product page, desktop',
  'Settings screen with a profile card, mobile',
];

const uid = () => Math.random().toString(36).slice(2, 10);

// ── Placement ───────────────────────────────────────────────────────────

interface Slot {
  x: number;
  y: number;
}

/**
 * Where new screens go: to the right of everything already on the page, top
 * aligned with it, so a flow reads left to right beside the existing work.
 * An empty page puts them where the designer is looking.
 */
function nextSlot(doc: Doc, pageId: string, viewport: { x: number; y: number; zoom: number }): Slot {
  const boards = (doc[pageId]?.children ?? []).map((id) => doc[id]).filter(Boolean) as SceneNode[];
  if (!boards.length) {
    const centre = viewCentre(viewport);
    return { x: Math.round(centre.x - 400), y: Math.round(centre.y - 400) };
  }
  const maxX = Math.max(...boards.map((b) => b.x + b.w));
  const minY = Math.min(...boards.map((b) => b.y));
  return { x: Math.round(maxX + 160), y: Math.round(minY) };
}

/** `attachment:N` in the model's markup becomes the picture that was attached. */
function withAttachments(markup: string, attachments: Attachment[]): string {
  return markup.replace(/attachment:(\d+)/g, (whole, index) => attachments[Number(index) - 1]?.url ?? whole);
}

/**
 * Builds one screen: lays the markup out, then writes it under a top-level
 * frame at the slot. A fragment whose single root is already a frame *is* the
 * screen; anything else is wrapped in one.
 */
async function buildScreen(
  store: DocStore,
  pageId: string,
  screen: { name: string; width: number; html: string; css: string },
  attachments: Attachment[],
  slot: Slot,
): Promise<{ id: string; w: number; h: number } | null> {
  const specs = await readHtmlInBrowser(withAttachments(screen.html, attachments), {
    width: screen.width,
    css: withAttachments(screen.css ?? '', attachments),
  });
  if (!specs.length) return null;

  const root: NodeSpec | null = specs.length === 1 && specs[0].type === 'frame' ? specs[0] : null;
  if (root) {
    root.props.name = screen.name;
    root.props.x = slot.x;
    root.props.y = slot.y;
    root.props.clip = true;
    if (!root.props.fill) root.props.fill = '#FFFFFF';
    const { top } = writeSpecs(store, [root], pageId);
    return { id: top[0], w: Number(root.props.w) || screen.width, h: Number(root.props.h) || 0 };
  }

  const height = Math.max(...specs.map((s) => (Number(s.props.y) || 0) + (Number(s.props.h) || 0)));
  const id = store.create('frame', pageId, {
    name: screen.name,
    x: slot.x,
    y: slot.y,
    w: screen.width,
    h: Math.max(1, Math.round(height)),
    fill: '#FFFFFF',
    clip: true,
  });
  writeSpecs(store, specs, id);
  return { id, w: screen.width, h: height };
}

// ── Offline templates ───────────────────────────────────────────────────

/**
 * What the assistant can do with no model behind it: a handful of screens
 * written as HTML, built through the same importer, so the result is the same
 * kind of editable design the model would have produced.
 */
function templateFor(prompt: string): { name: string; width: number; html: string; css: string }[] {
  const lower = prompt.toLowerCase();
  const accent = generateImageFill(prompt).split(',').pop()?.trim() ?? '#0D99FF';
  const hero = generateImageFill(prompt);
  const mark = generateSvg(prompt);
  const mobile = /mobile|phone|ios|android|app\b/.test(lower);

  const css = `
    .screen{display:flex;flex-direction:column;background:#ffffff;font-family:Inter,system-ui,sans-serif;color:#0f172a}
    .muted{color:#64748b;font-size:13px;line-height:20px}
    .h1{font-size:28px;font-weight:700;line-height:34px;letter-spacing:-0.4px}
    .h2{font-size:18px;font-weight:600;line-height:24px}
    .btn{display:flex;align-items:center;justify-content:center;height:44px;border-radius:10px;background:${accent};color:#fff;font-size:14px;font-weight:600}
    .btn.ghost{background:#f1f5f9;color:#0f172a}
    .field{display:flex;align-items:center;height:44px;padding:0 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#94a3b8;font-size:14px}
    .card{display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:14px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(15,23,42,0.06)}
    .label{font-size:12px;font-weight:500;color:#475569}
    .row{display:flex;align-items:center;gap:12px}
    .grow{flex:1}
    .avatar{width:36px;height:36px;border-radius:18px;background:${hero}}
    .mark{width:40px;height:40px;border-radius:12px;background-image:${mark};background-size:cover}
  `;

  if (/login|sign\s?in|sign\s?up|auth/.test(lower)) {
    return [
      {
        name: 'Login — Mobile',
        width: 390,
        css,
        html: `<div class="screen" data-name="Login" style="width:390px;min-height:844px;padding:64px 24px 32px;gap:28px">
          <div class="mark"></div>
          <div style="display:flex;flex-direction:column;gap:6px"><p class="h1">Welcome back</p><p class="muted">Sign in to continue to your workspace.</p></div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;flex-direction:column;gap:6px"><p class="label">Email</p><div class="field">you@company.com</div></div>
            <div style="display:flex;flex-direction:column;gap:6px"><p class="label">Password</p><div class="field">••••••••</div></div>
            <p style="font-size:13px;font-weight:500;color:${accent}">Forgot password?</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px"><div class="btn">Continue</div><div class="btn ghost">Continue with Google</div></div>
          <div class="grow"></div>
          <p class="muted" style="text-align:center">New here? <b>Create an account</b></p>
        </div>`,
      },
    ];
  }

  if (/dashboard|analytics|admin/.test(lower)) {
    const stat = (label: string, value: string, delta: string) =>
      `<div class="card grow"><p class="label">${label}</p><p style="font-size:26px;font-weight:700;line-height:32px">${value}</p><p style="font-size:12px;color:#16a34a">${delta}</p></div>`;
    return [
      {
        name: 'Dashboard — Desktop',
        width: 1440,
        css,
        html: `<div class="screen" data-name="Dashboard" style="width:1440px;min-height:900px;flex-direction:row;background:#f8fafc">
          <div data-name="Sidebar" style="display:flex;flex-direction:column;gap:6px;width:240px;padding:24px 16px;background:#0f172a;color:#cbd5e1">
            <div class="row" style="padding:4px 8px 20px"><div class="mark" style="width:28px;height:28px;border-radius:8px"></div><p style="color:#fff;font-weight:600;font-size:15px">Northwind</p></div>
            ${['Overview', 'Customers', 'Orders', 'Products', 'Reports', 'Settings']
              .map((item, i) => `<div class="row" style="height:36px;padding:0 10px;border-radius:8px;${i === 0 ? 'background:rgba(255,255,255,0.08);color:#fff' : ''}"><div style="width:16px;height:16px;border-radius:4px;background:${i === 0 ? accent : '#334155'}"></div><p style="font-size:13px;font-weight:500">${item}</p></div>`)
              .join('')}
          </div>
          <div style="display:flex;flex-direction:column;gap:24px;padding:32px 40px;flex:1">
            <div class="row"><div style="display:flex;flex-direction:column;gap:4px;flex:1"><p class="h1" style="font-size:24px;line-height:30px">Overview</p><p class="muted">Tuesday, 2 September</p></div><div class="btn" style="width:140px">New report</div></div>
            <div class="row" style="gap:16px">${stat('Revenue', '$128,430', '+12.4% vs last month')}${stat('Active users', '8,214', '+3.1%')}${stat('Orders', '1,902', '+8.7%')}${stat('Churn', '1.8%', '−0.4 pts')}</div>
            <div class="row" style="gap:16px;align-items:stretch">
              <div class="card" style="flex:2;gap:16px"><div class="row"><p class="h2 grow">Revenue trend</p><p class="muted">Last 30 days</p></div><div style="height:260px;border-radius:10px;background:${hero}"></div></div>
              <div class="card" style="flex:1;gap:14px"><p class="h2">Top customers</p>${['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Hooli']
                .map((c, i) => `<div class="row"><div class="avatar" style="width:28px;height:28px;border-radius:14px"></div><p class="grow" style="font-size:13px;font-weight:500">${c}</p><p class="muted">$${(24 - i * 3).toFixed(1)}k</p></div>`)
                .join('')}</div>
            </div>
          </div>
        </div>`,
      },
    ];
  }

  if (/pricing|plans?/.test(lower)) {
    const tier = (name: string, price: string, items: string[], hot: boolean) =>
      `<div class="card" style="flex:1;gap:18px;padding:28px;${hot ? `border:2px solid ${accent}` : ''}"><div style="display:flex;flex-direction:column;gap:6px"><p class="h2">${name}</p><p class="muted">For ${name === 'Starter' ? 'individuals' : name === 'Pro' ? 'growing teams' : 'large organisations'}</p></div><div class="row" style="gap:4px;align-items:flex-end"><p style="font-size:40px;font-weight:700;line-height:44px">${price}</p><p class="muted">/month</p></div><div style="display:flex;flex-direction:column;gap:10px">${items.map((i) => `<div class="row" style="gap:8px"><div style="width:16px;height:16px;border-radius:8px;background:${accent}"></div><p style="font-size:14px">${i}</p></div>`).join('')}</div><div class="btn ${hot ? '' : 'ghost'}">Get started</div></div>`;
    return [
      {
        name: 'Pricing — Desktop',
        width: 1440,
        css,
        html: `<div class="screen" data-name="Pricing" style="width:1440px;min-height:900px;align-items:center;padding:96px 120px;gap:48px;background:#f8fafc">
          <div style="display:flex;flex-direction:column;gap:12px;align-items:center;max-width:640px"><p class="h1" style="font-size:44px;line-height:52px;text-align:center">Simple, transparent pricing</p><p class="muted" style="font-size:16px;line-height:24px;text-align:center">Start free, upgrade when your team grows. No hidden fees.</p></div>
          <div class="row" style="gap:24px;align-items:stretch;width:1080px">${tier('Starter', '$0', ['1 workspace', '3 projects', 'Community support'], false)}${tier('Pro', '$24', ['Unlimited projects', 'Version history', 'Priority support', 'Shared libraries'], true)}${tier('Business', '$64', ['SSO & SAML', 'Audit log', 'Dedicated success manager'], false)}</div>
        </div>`,
      },
    ];
  }

  if (/onboard|welcome|walkthrough/.test(lower)) {
    const step = (i: number, title: string, body: string) => ({
      name: `Onboarding ${i} — Mobile`,
      width: 390,
      css,
      html: `<div class="screen" data-name="Onboarding ${i}" style="width:390px;min-height:844px;padding:64px 24px 40px;gap:32px;align-items:center">
        <div style="width:342px;height:360px;border-radius:24px;background:${generateImageFill(prompt + i)}"></div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:center"><p class="h1" style="text-align:center">${title}</p><p class="muted" style="text-align:center;font-size:15px;line-height:22px">${body}</p></div>
        <div class="row" style="gap:6px">${[1, 2, 3].map((d) => `<div style="width:${d === i ? 20 : 6}px;height:6px;border-radius:3px;background:${d === i ? accent : '#e2e8f0'}"></div>`).join('')}</div>
        <div class="grow"></div>
        <div class="btn" style="width:342px">${i === 3 ? 'Get started' : 'Next'}</div>
      </div>`,
    });
    return [
      step(1, 'Design together', 'Real-time collaboration with your whole team, on any device.'),
      step(2, 'Ship faster', 'Every layer is real code — hand off without the translation.'),
      step(3, 'Stay in flow', 'Components, variables and prototypes, all in one canvas.'),
    ];
  }

  // a landing / hero for everything else
  const title = prompt.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Build something people love';
  return [
    {
      name: mobile ? `${title.slice(0, 24)} — Mobile` : `${title.slice(0, 24)} — Desktop`,
      width: mobile ? 390 : 1440,
      css,
      html: mobile
        ? `<div class="screen" style="width:390px;min-height:844px;padding:60px 20px 32px;gap:24px">
            <div class="row"><div class="mark" style="width:32px;height:32px;border-radius:10px"></div><p class="grow" style="font-weight:600">${title.slice(0, 18)}</p><div class="avatar" style="width:32px;height:32px;border-radius:16px"></div></div>
            <div style="height:220px;border-radius:20px;background:${hero}"></div>
            <div style="display:flex;flex-direction:column;gap:8px"><p class="h1">${title}</p><p class="muted" style="font-size:15px;line-height:22px">Generated from your prompt. Every element is a real layer — edit the copy, colours and layout directly.</p></div>
            <div class="row"><div class="btn grow">Get started</div><div class="btn ghost grow">Learn more</div></div>
            <div class="card"><p class="h2">What you get</p>${['Editable auto layout frames', 'Real text and image layers', 'Ready to prototype'].map((i) => `<div class="row" style="gap:8px"><div style="width:8px;height:8px;border-radius:4px;background:${accent}"></div><p style="font-size:14px">${i}</p></div>`).join('')}</div>
          </div>`
        : `<div class="screen" style="width:1440px;min-height:900px">
            <div class="row" data-name="Nav" style="height:72px;padding:0 80px;gap:32px"><div class="row" style="gap:10px"><div class="mark" style="width:28px;height:28px;border-radius:8px"></div><p style="font-weight:600;font-size:16px">${title.slice(0, 18)}</p></div><div class="grow"></div>${['Product', 'Pricing', 'Docs', 'Blog'].map((l) => `<p style="font-size:14px;font-weight:500;color:#334155">${l}</p>`).join('')}<div class="btn" style="width:120px;height:40px">Sign up</div></div>
            <div class="row" data-name="Hero" style="padding:96px 80px;gap:64px;align-items:center">
              <div style="display:flex;flex-direction:column;gap:20px;flex:1"><p class="h1" style="font-size:56px;line-height:62px;letter-spacing:-1px">${title}</p><p class="muted" style="font-size:18px;line-height:28px;max-width:520px">Generated from your prompt. Every element is a real layer — edit the copy, colours and layout directly on the canvas.</p><div class="row"><div class="btn" style="width:160px;height:48px">Get started</div><div class="btn ghost" style="width:140px;height:48px">Learn more</div></div></div>
              <div style="width:560px;height:400px;border-radius:24px;background:${hero}"></div>
            </div>
            <div class="row" data-name="Features" style="padding:0 80px 96px;gap:24px;align-items:stretch">${['Fast', 'Collaborative', 'Code-native'].map((f, i) => `<div class="card" style="flex:1;padding:24px;gap:12px"><div style="width:40px;height:40px;border-radius:12px;background:${generateImageFill(prompt + f)}"></div><p class="h2">${f}</p><p class="muted">${['Ship screens in minutes, not days.', 'Design with your whole team in real time.', 'What you draw is what you ship.'][i]}</p></div>`).join('')}</div>
          </div>`,
    },
  ];
}

// ── The sidebar ─────────────────────────────────────────────────────────

export function AiChatSidebar() {
  const store = useStore();
  const doc = useDoc();
  const page = useUI((s) => s.page);
  const open = useUI((s) => s.aiChatOpen);
  const setOpen = useUI((s) => s.setAiChatOpen);
  const select = useUI((s) => s.select);

  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: 'm0',
      role: 'assistant',
      text: 'Describe a screen, a component, or a whole flow — "login and sign-up for a banking app", "3 onboarding screens", "SaaS dashboard with a sidebar" — and it lands on the canvas as editable layers. Attach a screenshot or a photo to design from it.',
    },
  ]);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/ai/design')
      .then((r) => (r.ok ? r.json() : { ready: false }))
      .then((s: { ready: boolean; model?: string }) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus({ ready: false }));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  if (!open) return null;

  const attach = async (files: FileList | File[] | null) => {
    if (!files) return;
    const picked: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) continue;
      if (file.size > 8 * 1024 * 1024) continue;
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      picked.push({
        id: uid(),
        name: file.name || 'image',
        media_type: file.type as Attachment['media_type'],
        data: url.split(',')[1] ?? '',
        url,
      });
    }
    if (picked.length) setAttachments((list) => [...list, ...picked].slice(0, 6));
  };

  const post = (msg: Omit<Msg, 'id'>) => setMsgs((m) => [...m, { id: uid(), ...msg }]);

  /** Builds screens and frames them on the canvas; returns the ids made. */
  const build = async (
    screens: { name: string; width: number; html: string; css: string }[],
    pictures: Attachment[],
  ): Promise<string[]> => {
    const { viewport, leftPanel, leftWidth, rightWidth, setViewport } = useUI.getState();
    let slot = nextSlot(store.getSnapshot(), page, viewport);
    const made: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const [index, screen] of screens.entries()) {
      setBusy(`Building ${screen.name} (${index + 1}/${screens.length})…`);
      const built = await buildScreen(store, page, screen, pictures, slot);
      if (!built) continue;
      made.push({ ...built, x: slot.x, y: slot.y });
      slot = { x: slot.x + built.w + 120, y: slot.y };
    }
    store.commit();
    if (made.length) {
      select(made.map((m) => m.id));
      const bounds = {
        minX: Math.min(...made.map((m) => m.x)),
        minY: Math.min(...made.map((m) => m.y)),
        maxX: Math.max(...made.map((m) => m.x + m.w)),
        maxY: Math.max(...made.map((m) => m.y + m.h)),
      };
      setViewport(fitBounds(bounds, leftPanel, leftWidth, rightWidth));
    }
    return made.map((m) => m.id);
  };

  const send = async (text: string = input) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const pictures = attachments;
    post({ role: 'user', text: prompt, attachments: pictures });
    setInput('');
    setAttachments([]);
    setBusy('Designing…');

    try {
      const snapshot = store.getSnapshot();
      const screens = (snapshot[page]?.children ?? [])
        .map((id) => snapshot[id])
        .filter((n): n is SceneNode => !!n && (n.type === 'frame' || n.type === 'section'))
        .map((n) => n.name);
      const selectedId = useUI.getState().selection[0];
      const history = msgs
        .filter((m) => m.id !== 'm0' && m.tone !== 'error')
        .map((m) => ({ role: m.role, text: m.text }));

      const response = await fetch('/api/ai/design', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          attachments: pictures.map(({ media_type, data }) => ({ media_type, data })),
          context: { screens, selection: selectedId ? snapshot[selectedId]?.name ?? null : null },
          history,
        }),
      });

      if (response.status === 503 || response.status === 401) {
        // no model on the server: the templates stand in, and say so
        const made = await build(templateFor(prompt), pictures);
        post({
          role: 'assistant',
          text:
            (made.length
              ? `Built ${made.length} screen${made.length === 1 ? '' : 's'} from a built-in template. `
              : 'No template fits that yet. ') +
            'The full assistant needs ANTHROPIC_API_KEY set on the server — add it to .env.local and restart to design anything from a description or a screenshot.',
          built: made,
          tone: 'note',
        });
        return;
      }

      const payload = (await response.json()) as {
        reply?: string;
        screens?: { name: string; width: number; html: string; css: string }[];
        error?: string;
        message?: string;
        truncated?: boolean;
      };
      if (!response.ok) {
        post({ role: 'assistant', text: payload.message ?? 'The assistant could not answer that.', tone: 'error' });
        return;
      }

      const made = payload.screens?.length ? await build(payload.screens, pictures) : [];
      post({
        role: 'assistant',
        text: [
          payload.reply ?? '',
          made.length ? `Placed ${made.length} screen${made.length === 1 ? '' : 's'} on the canvas — every element is an editable layer.` : '',
          payload.truncated ? 'The answer was cut short by its length; ask for fewer screens at once for the rest.' : '',
        ]
          .filter(Boolean)
          .join(' '),
        built: made,
      });
    } catch (error) {
      post({
        role: 'assistant',
        text: `Something went wrong while building: ${error instanceof Error ? error.message : 'unknown error'}`,
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const reveal = (ids: string[]) => {
    const snapshot = store.getSnapshot();
    const boards = ids.map((id) => snapshot[id]).filter(Boolean) as SceneNode[];
    if (!boards.length) return;
    select(boards.map((b) => b.id));
    const { leftPanel, leftWidth, rightWidth, setViewport } = useUI.getState();
    setViewport(
      fitBounds(
        {
          minX: Math.min(...boards.map((b) => b.x)),
          minY: Math.min(...boards.map((b) => b.y)),
          maxX: Math.max(...boards.map((b) => b.x + b.w)),
          maxY: Math.max(...boards.map((b) => b.y + b.h)),
        },
        leftPanel,
        leftWidth,
        rightWidth,
      ),
    );
  };

  const fresh = msgs.length === 1;
  const ready = status?.ready === true;

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
        border: dragging ? '1px solid #0D99FF' : '1px solid #ececec',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: 'none',
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void attach(e.dataTransfer.files);
      }}
    >
      <div style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 14px', borderBottom: '1px solid #ececec' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: '#0D99FF', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>✦</span>
        <span style={{ fontWeight: 600, flex: 1 }}>Assistant</span>
        <span
          title={
            status === null
              ? 'Checking the model…'
              : ready
                ? `Designs are generated by ${status.model}`
                : 'Add ANTHROPIC_API_KEY to .env.local to enable the model; built-in templates are used meanwhile'
          }
          style={{
            fontSize: 10,
            color: ready ? '#15803d' : '#92400e',
            background: ready ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${ready ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: 6,
            padding: '2px 6px',
          }}
        >
          {status === null ? '…' : ready ? 'Claude' : 'Templates'}
        </span>
        <button type="button" className="fig-btn" title="Close assistant" onClick={() => setOpen(false)} style={{ marginLeft: 4 }}>
          ✕
        </button>
      </div>

      <div ref={listRef} className="scroll" style={{ flex: 1, padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc' }}>
        {msgs.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.attachments && m.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '84%' }}>
                {m.attachments.map((a) => (
                  <img key={a.id} src={a.url} alt={a.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                ))}
              </div>
            )}
            <div
              style={{
                maxWidth: '84%',
                padding: '8px 10px',
                borderRadius: 12,
                borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                borderBottomLeftRadius: m.role === 'assistant' ? 4 : 12,
                background: m.role === 'user' ? '#0D99FF' : m.tone === 'error' ? '#fef2f2' : m.tone === 'note' ? '#fffbeb' : '#fff',
                color: m.role === 'user' ? '#fff' : m.tone === 'error' ? '#991b1b' : '#0f172a',
                border: m.role === 'assistant' ? `1px solid ${m.tone === 'error' ? '#fecaca' : m.tone === 'note' ? '#fde68a' : '#e2e8f0'}` : '0',
                fontSize: 11.5,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                boxShadow: m.role === 'assistant' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {m.text}
            </div>
            {m.built && m.built.length > 0 && (
              <button
                type="button"
                onClick={() => reveal(m.built!)}
                style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '4px 8px', fontSize: 10.5, color: '#0D99FF', cursor: 'pointer' }}
              >
                Show on canvas
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', padding: '8px 10px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="ai-dot" /> {busy}
            </span>
          </div>
        )}
        {fresh && !busy && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 999, padding: '5px 10px', fontSize: 10.5, color: '#334155', cursor: 'pointer', textAlign: 'left' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px 10px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {attachments.map((a, i) => (
              <div key={a.id} style={{ position: 'relative', width: 52, height: 52 }} title={`${a.name} — attachment:${i + 1}`}>
                <img src={a.url} alt={a.name} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                  style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', fontSize: 10, lineHeight: '16px', cursor: 'pointer', padding: 0 }}
                >
                  ✕
                </button>
                <span style={{ position: 'absolute', left: 3, bottom: 3, fontSize: 9, fontWeight: 600, color: '#fff', background: 'rgba(15,23,42,0.7)', borderRadius: 4, padding: '0 4px' }}>{i + 1}</span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            padding: '6px 6px 6px 6px',
            border: focused ? '1px solid #0D99FF' : '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            boxShadow: focused ? '0 0 0 3px rgba(13,153,255,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
            transition: 'border-color 150ms, box-shadow 150ms',
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="fig-btn"
            title="Attach an image — or paste or drop one"
            aria-label="Attach an image"
            onClick={() => fileRef.current?.click()}
            style={{ width: 28, height: 28, flex: 'none' }}
          >
            <Icon.Plus />
          </button>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
              if (files.length) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={ready ? 'Describe a screen or a flow…' : 'Describe a screen…'}
            rows={1}
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              resize: 'none',
              fontSize: 12.5,
              lineHeight: '18px',
              maxHeight: 120,
              minHeight: 18,
              height: 18,
              padding: '5px 2px',
              background: 'transparent',
              fontFamily: 'inherit',
              color: '#0f172a',
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || !!busy}
            title={busy ? 'Working…' : 'Send — Enter'}
            aria-label="Send"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: 0,
              background: busy ? '#e2e8f0' : input.trim() ? '#0D99FF' : '#f1f5f9',
              color: busy ? '#94a3b8' : input.trim() ? '#fff' : '#cbd5e1',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
              cursor: busy || !input.trim() ? 'default' : 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            {busy ? (
              <span style={{ width: 12, height: 12, border: '2px solid #94a3b8', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'ai-spin 0.8s linear infinite' }} />
            ) : (
              <Icon.Send />
            )}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Screens land as editable layers</span>
          <span style={{ fontSize: 10, color: '#cbd5e1' }}>↵ send · ⇧↵ newline</span>
        </div>
      </div>

      <style>{`@keyframes ai-bounce{0%,80%,100%{opacity:.3}40%{opacity:1}}.ai-dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#94a3b8;animation:ai-bounce 1s infinite}@keyframes ai-spin{to{transform:rotate(360deg)}}textarea::placeholder{color:#94a3b8}`}</style>
    </div>
  );
}
