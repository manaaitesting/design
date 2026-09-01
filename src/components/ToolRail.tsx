'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { useReadOnly, useStore } from './Session';
import type { DocStore } from '../document/store';
import { useUI, type Tool } from '../state/ui';

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
 * into a single rail button that remembers which of them you used last, so the
 * rail stays a short column without any tool becoming unreachable. Pointing at
 * the button opens the group; clicking it arms the tool the button is showing.
 * `id` names the group so only one of them can be open at a time.
 */
interface Flyout {
  id: string;
  entries: Entry[];
}

const CURSORS: Flyout = {
  id: 'cursors',
  entries: [
    { tool: 'move', label: 'Move', shortcut: 'V', icon: <Icon.Move /> },
    { tool: 'scale', label: 'Scale', shortcut: 'K', icon: <Icon.Scale /> },
    { tool: 'pan', label: 'Hand tool', shortcut: 'H', icon: <Icon.Hand /> },
  ],
};

const CONTAINERS: Flyout = {
  id: 'containers',
  entries: [
    { tool: 'frame', label: 'Frame', shortcut: 'F', icon: <Icon.Frame /> },
    { tool: 'section', label: 'Section', shortcut: '⇧S', icon: <Icon.Section /> },
    { tool: 'slice', label: 'Slice', shortcut: 'S', icon: <Icon.Slice /> },
  ],
};

const SHAPES: Flyout = {
  id: 'shapes',
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
 * is what the Inspect tab is for — so the rail offers them there and nowhere
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

export function ToolRail() {
  const readOnly = useReadOnly();
  const store = useStore();
  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  const setTool = useUI((s) => s.setTool);
  const setShadersOpen = useUI((s) => s.setShadersOpen);
  const leftPanel = useUI((s) => s.leftPanel);
  const toggleLeftPanel = useUI((s) => s.toggleLeftPanel);
  const inspecting = useUI((s) => s.inspectorTab === 'inspect');
  /** the face each flyout shows: the tool you last picked from it */
  const [faces, setFaces] = useState<Record<string, Tool>>({});
  const [open, setOpen] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  // picking a tool from anywhere — a shortcut, the command menu — turns the
  // flyout that owns it, so the rail always shows the tool that is armed
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
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current ?? undefined), []);

  /**
   * What the pointer asks for as it crosses the rail.
   *
   * A menu that opened the instant the pointer touched a button would flash
   * open and shut every time you crossed the rail on the way somewhere else, so
   * a group waits to be pointed at. Once one is open the rest follow at once —
   * by then you are reading the rail, not passing over it — and leaving waits a
   * moment too, so that clipping a corner on the way to the menu does not shut
   * the menu you were reaching for.
   */
  const hover = (id: string | null) => {
    window.clearTimeout(hoverTimer.current ?? undefined);
    if (id !== null && open) {
      setOpen(id);
      return;
    }
    hoverTimer.current = window.setTimeout(() => setOpen(id), id === null ? 140 : 260);
  };

  // Holding Space borrows the hand tool, so the rail shows the hand *instead of*
  // the tool it borrowed from — lighting both would say two tools are armed.
  const shown = spacePan ? 'pan' : tool;

  const arm = (entry: Entry) => {
    if (entry.tool === 'shaders') setShadersOpen(true);
    else setTool(entry.tool);
  };

  const button = (entry: Entry, menu?: { id: string }) => (
    <button
      type="button"
      className="fig-tool"
      data-on={shown === entry.tool ? 'true' : undefined}
      title={entry.shortcut ? `${entry.label}  ${entry.shortcut}` : entry.label}
      aria-label={entry.label}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? open === menu.id : undefined}
      // the keyboard has no hover, so reaching the button is what opens its
      // menu — otherwise the tools behind it would be Tab-unreachable
      onFocus={menu ? () => setOpen(menu.id) : undefined}
      onClick={(event) => {
        // hand focus back to the canvas: a still-focused button would
        // swallow Enter and Space, which belong to the selection
        event.currentTarget.blur();
        arm(entry);
      }}
    >
      {entry.icon}
    </button>
  );

  const group = (item: Flyout) => {
    const entries = readOnly
      ? item.entries.filter((entry) => VIEWER_TOOLS.has(entry.tool))
      : item.entries;
    if (!entries.length) return null;
    // one tool left is no longer a group: a caret onto a single-row menu
    // would be a click that leads nowhere
    if (entries.length === 1) return <div style={{ width: '100%' }}>{button(entries[0])}</div>;

    // the armed tool wins over the remembered one: holding Space borrows the
    // hand, and a group that kept showing Move through the pan would be saying
    // the canvas is doing something it is not
    const face =
      entries.find((entry) => entry.tool === shown) ??
      entries.find((entry) => entry.tool === faces[item.id]) ??
      entries[0];
    return (
      <div className="fig-rail-group" onPointerEnter={() => hover(item.id)}>
        {button(face, { id: item.id })}
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

  /** The rail, in order: a flyout is a group, an entry is a lone button. */
  const items: (Flyout | Entry)[] = [
    CURSORS,
    CONTAINERS,
    SHAPES,
    PEN,
    TEXT,
    COMMENT,
    ...(inspecting && !readOnly ? HANDOFF : []),
    GENERATE,
  ];

  return (
    <div className="fig-rail" ref={railRef} onPointerLeave={() => hover(null)}>
      {/* the panel toggle lives here as well as in the panel's own header:
          once the panel is hidden its header goes with it, and the rail is
          then the only place left to bring it back */}
      <div style={{ width: '100%' }} onPointerEnter={() => hover(null)}>
        <button
          type="button"
          className="fig-tool"
          data-on={leftPanel ? 'true' : undefined}
          title={leftPanel ? 'Hide panel' : 'Show panel'}
          aria-label={leftPanel ? 'Hide panel' : 'Show panel'}
          aria-pressed={leftPanel}
          onClick={(event) => {
            event.currentTarget.blur();
            toggleLeftPanel();
          }}
        >
          <Icon.PanelToggle />
        </button>
      </div>

      {items.map((item) =>
        isFlyout(item) ? (
          <div key={item.id} style={{ width: '100%' }}>
            {group(item)}
          </div>
        ) : readOnly && !VIEWER_TOOLS.has(item.tool) ? null : (
          <div key={item.tool} style={{ width: '100%' }} onPointerEnter={() => hover(null)}>
            {button(item)}
          </div>
        ),
      )}

      {!readOnly && (
        <div style={{ width: '100%' }} onPointerEnter={() => hover(null)}>
          {/* Figma keeps these two beside the drawing tools: one samples a
              colour from anywhere on screen, the other is the command menu. */}
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
        </div>
      )}
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
