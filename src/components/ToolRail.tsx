'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useReadOnly, useStore } from './Session';
import type { DocStore } from '../document/store';
import { useUI, type Tool } from '../state/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface Entry {
  tool: Tool;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
}

/**
 * A group of tools behind one button.
 *
 * Figma stacks the related tools — the cursors, the containers, the shapes —
 * into a single toolbar button that remembers which of them you used last, so
 * the bar stays short without any tool becoming unreachable. Clicking the
 * button arms the tool it is showing; the caret beside it opens the group.
 * `id` names the group so only one of them can be open at a time.
 */
interface Flyout {
  id: string;
  /** what the caret that opens the group is called — never a tool's own name */
  menu: string;
  entries: Entry[];
}

const CURSORS: Flyout = {
  id: 'cursors',
  menu: 'Selection tools',
  entries: [
    { tool: 'move', label: 'Move', shortcut: 'V', icon: <Icon.Move /> },
    { tool: 'scale', label: 'Scale', shortcut: 'K', icon: <Icon.Scale /> },
    { tool: 'pan', label: 'Hand tool', shortcut: 'H', icon: <Icon.Hand /> },
  ],
};

const CONTAINERS: Flyout = {
  id: 'containers',
  menu: 'Container tools',
  entries: [
    { tool: 'frame', label: 'Frame', shortcut: 'F', icon: <Icon.Frame /> },
    { tool: 'section', label: 'Section', shortcut: '⇧S', icon: <Icon.Section /> },
    { tool: 'slice', label: 'Slice', shortcut: 'S', icon: <Icon.Slice /> },
  ],
};

const SHAPES: Flyout = {
  id: 'shapes',
  menu: 'Shape tools',
  entries: [
    { tool: 'rect', label: 'Rectangle', shortcut: 'R', icon: <Icon.Square /> },
    { tool: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: <Icon.Circle /> },
    { tool: 'polygon', label: 'Polygon', icon: <Icon.Polygon /> },
    { tool: 'star', label: 'Star', icon: <Icon.Star /> },
    { tool: 'line', label: 'Line', shortcut: 'L', icon: <Icon.Line /> },
    { tool: 'arrow', label: 'Arrow', shortcut: '⇧L', icon: <Icon.Arrow /> },
  ],
};

const GENERATE: Flyout = {
  id: 'generate',
  menu: 'Generation tools',
  entries: [
    { tool: 'image', label: 'Create image', icon: <Icon.ImageAi /> },
    { tool: 'svg', label: 'Create SVG', icon: <Icon.SvgAi /> },
    { tool: 'shaders', label: 'Shaders', icon: <Icon.Shader /> },
  ],
};

const PEN: Entry = { tool: 'pen', label: 'Pen', shortcut: 'P', icon: <Icon.Pen /> };
const TEXT: Entry = { tool: 'text', label: 'Text', shortcut: 'T', icon: <Icon.Text /> };
const COMMENT: Entry = { tool: 'comment', label: 'Comment', shortcut: 'C', icon: <Icon.Comment /> };

/**
 * Measuring and annotating describe a design for whoever has to build it, which
 * is what the Inspect tab is for — so the bar offers them there and nowhere
 * else, rather than keeping two handoff tools out while you draw.
 */
const HANDOFF: Entry[] = [
  { tool: 'measure', label: 'Measure', shortcut: '⇧E', icon: <Icon.Measure /> },
  { tool: 'annotate', label: 'Annotate', icon: <Icon.Annotate /> },
];

/** Every group, for the effect that keeps their faces in step with the tool. */
const FLYOUTS: Flyout[] = [CURSORS, CONTAINERS, SHAPES, GENERATE];

const isFlyout = (item: Flyout | Entry): item is Flyout => 'entries' in item;

/** What a viewer gets: look, move around, and say something. */
const VIEWER_TOOLS = new Set<Tool>(['move', 'pan', 'comment']);

/**
 * The toolbar: a floating bar along the bottom of the canvas, as Figma's is.
 *
 * It floats rather than docks so the canvas runs edge to edge beneath it, and
 * it sits at the bottom so the pointer's path from the tools to the work is
 * the short one.
 */
export function ToolRail() {
  const readOnly = useReadOnly();
  const store = useStore();
  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  const setTool = useUI((s) => s.setTool);
  const setShadersOpen = useUI((s) => s.setShadersOpen);
  const aiOpen = useUI((s) => s.aiChatOpen);
  const toggleAi = useUI((s) => s.toggleAiChat);
  const inspecting = useUI((s) => s.inspectorTab === 'inspect');
  // point editing and the motion timeline each bring their own dark chrome
  // to the same spot; two bars would overlap, and a bar over the lanes would
  // catch the keyframes you drag
  const vectorEditing = useUI((s) => s.vectorEdit !== null);
  const timelineOpen = useUI((s) => s.motion.frame !== null);
  /** the face each flyout shows: the tool you last picked from it */
  const [faces, setFaces] = useState<Record<string, Tool>>({});
  const [open, setOpen] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // picking a tool from anywhere — a shortcut, the command menu — turns the
  // flyout that owns it, so the bar always shows the tool that is armed
  useEffect(() => {
    for (const item of FLYOUTS) {
      if (item.entries.some((entry) => entry.tool === tool)) {
        setFaces((shown) => (shown[item.id] === tool ? shown : { ...shown, [item.id]: tool }));
      }
    }
  }, [tool]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Holding Space borrows the hand tool, so the bar shows the hand *instead of*
  // the tool it borrowed from — lighting both would say two tools are armed.
  const shown = spacePan ? 'pan' : tool;

  const arm = (entry: Entry) => {
    if (entry.tool === 'shaders') setShadersOpen(true);
    else setTool(entry.tool);
  };

  const button = (entry: Entry, menu?: { id: string }) => {
    const label = entry.shortcut ? `${entry.label}  ${entry.shortcut}` : entry.label;
    const btn = (
      <button
        type="button"
        className="fig-tool"
        data-on={shown === entry.tool ? 'true' : undefined}
        title={label}
        aria-label={entry.label}
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? open === menu.id : undefined}
        onClick={(event) => {
          event.currentTarget.blur();
          arm(entry);
          setOpen(null);
        }}
      >
        {entry.icon}
      </button>
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={10}>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const group = (item: Flyout) => {
    const entries = readOnly
      ? item.entries.filter((entry) => VIEWER_TOOLS.has(entry.tool))
      : item.entries;
    if (!entries.length) return null;
    // one tool left is no longer a group: a caret onto a single-row menu
    // would be a click that leads nowhere
    if (entries.length === 1) return button(entries[0]);

    // the armed tool wins over the remembered one: holding Space borrows the
    // hand, and a group that kept showing Move through the pan would be saying
    // the canvas is doing something it is not
    const face =
      entries.find((entry) => entry.tool === shown) ??
      entries.find((entry) => entry.tool === faces[item.id]) ??
      entries[0];
    const armed = entries.some((entry) => entry.tool === shown);
    return (
      <div className="fig-rail-group" data-on={armed ? 'true' : undefined}>
        {button(face, { id: item.id })}
        <button
          type="button"
          className="fig-rail-caret"
          aria-label={item.menu}
          title={item.menu}
          aria-haspopup="menu"
          aria-expanded={open === item.id}
          onClick={(event) => {
            event.currentTarget.blur();
            setOpen((current) => (current === item.id ? null : item.id));
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open === item.id && (
          <div className="fig-flyout" role="menu">
            {entries.map((entry) => (
              <button
                key={entry.tool}
                type="button"
                className="fig-flyout-row"
                role="menuitem"
                data-on={face.tool === entry.tool || undefined}
                onClick={() => {
                  setFaces((shownFaces) => ({ ...shownFaces, [item.id]: entry.tool }));
                  arm(entry);
                  setOpen(null);
                }}
              >
                <span className="fig-flyout-icon">{entry.icon}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{entry.label}</span>
                {entry.shortcut && <span className="fig-flyout-key">{entry.shortcut}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  /** The bar, in order: a flyout is a group, an entry is a lone button. */
  const items: (Flyout | Entry)[] = [
    CURSORS,
    CONTAINERS,
    SHAPES,
    PEN,
    TEXT,
    COMMENT,
    ...(inspecting && !readOnly ? HANDOFF : []),
  ];

  if (vectorEditing || timelineOpen) return null;

  return (
    <div className="fig-rail" ref={railRef} role="toolbar" aria-label="Tools">
      {items.map((item) =>
        isFlyout(item) ? (
          <div key={item.id} className="fig-rail-slot">
            {group(item)}
          </div>
        ) : readOnly && !VIEWER_TOOLS.has(item.tool) ? null : (
          <div key={item.tool} className="fig-rail-slot">
            {button(item)}
          </div>
        ),
      )}

      {!readOnly && (
        <>
          <span className="fig-rail-sep" aria-hidden />
          <div className="fig-rail-slot">{group(GENERATE)}</div>
          <div className="fig-rail-slot">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="fig-tool"
                  title="Copy colors  I"
                  aria-label="Copy colors"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    void sampleColor(store, useUI.getState().selection);
                  }}
                >
                  <Icon.Eyedropper />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10}>
                <p>Copy colors — I</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="fig-rail-slot">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="fig-tool"
                  title="Actions  ⌘/"
                  aria-label="Actions"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    useUI.getState().setPaletteOpen(true);
                  }}
                >
                  <Icon.Command />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={10}>
                <p>Actions — ⌘/</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </>
      )}

      <span className="fig-rail-sep" aria-hidden />
      <div className="fig-rail-slot">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="fig-tool fig-tool-ai"
              data-on={aiOpen ? 'true' : undefined}
              title={aiOpen ? 'Hide assistant' : 'Assistant — design from a description'}
              aria-label={aiOpen ? 'Hide AI chat' : 'AI Assistant'}
              aria-pressed={aiOpen}
              onClick={(event) => {
                event.currentTarget.blur();
                toggleAi();
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>✦</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={10}>
            <p>{aiOpen ? 'Hide assistant' : 'Assistant — design from a description'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Figma's "Copy colors": sample a colour from anywhere on screen and paint the
 * selection with it.
 *
 * The browser's own eyedropper does the sampling, which is the only way to read
 * a pixel outside the page — and is exactly what the colour picker already
 * uses, so the two behave the same.
 */
export async function sampleColor(store: DocStore, selection: string[]): Promise<void> {
  if (!selection.length || !('EyeDropper' in window)) return;
  try {
    const picker = new (window as unknown as {
      EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> };
    }).EyeDropper();
    const { sRGBHex } = await picker.open();
    store.updateMany(selection, { fills: undefined, fill: sRGBHex, fillVisible: true });
  } catch {
    // dismissing the eyedropper is a cancel, not an error
  }
}
