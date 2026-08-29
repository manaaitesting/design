'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
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
 * The shapes behind one button.
 *
 * Figma keeps six shape tools in a flyout under the rectangle and remembers
 * which you used last, so the rail stays narrow without hiding the tools. Same
 * here: the button shows the current shape, and holding or clicking the caret
 * opens the rest.
 */
const SHAPES: Entry[] = [
  { tool: 'rect', label: 'Rectangle', shortcut: 'R', icon: <Icon.Square /> },
  { tool: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: <Icon.Circle /> },
  { tool: 'polygon', label: 'Polygon', icon: <Icon.Polygon /> },
  { tool: 'star', label: 'Star', icon: <Icon.Star /> },
  { tool: 'line', label: 'Line', shortcut: 'L', icon: <Icon.Line /> },
  { tool: 'arrow', label: 'Arrow', shortcut: '⇧L', icon: <Icon.Arrow /> },
];

const SHAPE_TOOLS = new Set<Tool>(SHAPES.map((shape) => shape.tool));

/** The vertical rail, in the order and grouping from the reference. */
const GROUPS: Entry[][] = [
  [
    { tool: 'move', label: 'Move', shortcut: 'V', icon: <Icon.Move /> },
    { tool: 'scale', label: 'Scale', shortcut: 'K', icon: <Icon.Scale /> },
    { tool: 'pan', label: 'Hand tool', shortcut: 'H', icon: <Icon.Hand /> },
  ],
  [
    { tool: 'frame', label: 'Frame', shortcut: 'F', icon: <Icon.Frame /> },
    // the shape flyout is spliced in here
    { tool: 'pen', label: 'Pen', shortcut: 'P', icon: <Icon.Pen /> },
    { tool: 'slice', label: 'Slice', shortcut: 'S', icon: <Icon.Slice /> },
    { tool: 'text', label: 'Text', shortcut: 'T', icon: <Icon.Text /> },
    { tool: 'comment', label: 'Comment', shortcut: 'C', icon: <Icon.Comment /> },
    { tool: 'measure', label: 'Measure', shortcut: '⇧E', icon: <Icon.Measure /> },
    { tool: 'annotate', label: 'Annotate', icon: <Icon.Annotate /> },
  ],
  [
    { tool: 'image', label: 'Create image', icon: <Icon.ImageAi /> },
    { tool: 'svg', label: 'Create SVG', icon: <Icon.SvgAi /> },
    { tool: 'shaders', label: 'Shaders', icon: <Icon.Shader /> },
  ],
];

/** What a viewer gets: look, move around, and say something. */
const VIEWER_TOOLS = new Set<Tool>(['move', 'pan', 'comment']);

export function ToolRail() {
  const readOnly = useReadOnly();
  const store = useStore();
  const tool = useUI((s) => s.tool);
  const spacePan = useUI((s) => s.spacePan);
  const setTool = useUI((s) => s.setTool);
  const setShadersOpen = useUI((s) => s.setShadersOpen);
  const [shape, setShape] = useState<Tool>('rect');
  const [flyout, setFlyout] = useState(false);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // picking a shape from anywhere — a shortcut, the menu — keeps the button in
  // step, so the rail always shows the tool that is actually armed
  useEffect(() => {
    if (SHAPE_TOOLS.has(tool)) setShape(tool);
  }, [tool]);

  useEffect(() => {
    if (!flyout) return;
    const close = (event: PointerEvent) => {
      if (!flyoutRef.current?.contains(event.target as Node)) setFlyout(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [flyout]);

  const activeShape = SHAPES.find((entry) => entry.tool === shape) ?? SHAPES[0];
  // Holding Space borrows the hand tool, so the rail shows the hand *instead of*
  // the tool it borrowed from — lighting both would say two tools are armed.
  const shown = spacePan ? 'pan' : tool;
  const groups = readOnly
    ? GROUPS.map((group) => group.filter((entry) => VIEWER_TOOLS.has(entry.tool))).filter(
        (group) => group.length,
      )
    : GROUPS;

  const button = (entry: Entry) => (
    <button
      key={entry.tool}
      type="button"
      className="fig-tool"
      data-on={shown === entry.tool ? 'true' : undefined}
      title={entry.shortcut ? `${entry.label}  ${entry.shortcut}` : entry.label}
      aria-label={entry.label}
      onClick={(event) => {
        // hand focus back to the canvas: a still-focused button would
        // swallow Enter and Space, which belong to the selection
        event.currentTarget.blur();
        if (entry.tool === 'shaders') setShadersOpen(true);
        else setTool(entry.tool);
      }}
    >
      {entry.icon}
    </button>
  );

  return (
    <div className="fig-rail">
      {groups.map((group, index) => (
        <div key={index} style={{ width: '100%' }}>
          {index > 0 && <div className="fig-rail-divider" />}
          {group.map((entry) => (
            <div key={entry.tool} style={{ width: '100%' }}>
              {button(entry)}
              {entry.tool === 'frame' && !readOnly && (
                <div ref={flyoutRef} style={{ position: 'relative', width: '100%' }}>
                  {button(activeShape)}
                  <button
                    type="button"
                    className="fig-tool-caret"
                    aria-label="More shapes"
                    title="More shapes"
                    onClick={(event) => {
                      event.currentTarget.blur();
                      setFlyout((open) => !open);
                    }}
                  >
                    <Icon.Caret />
                  </button>
                  {flyout && (
                    <div className="fig-flyout" role="menu">
                      {SHAPES.map((entry) => (
                        <button
                          key={entry.tool}
                          type="button"
                          className="fig-flyout-row"
                          role="menuitem"
                          data-on={shape === entry.tool || undefined}
                          onClick={() => {
                            setShape(entry.tool);
                            setTool(entry.tool);
                            setFlyout(false);
                          }}
                        >
                          <span className="fig-flyout-icon">{entry.icon}</span>
                          <span style={{ flex: 1, textAlign: 'left' }}>{entry.label}</span>
                          {entry.shortcut && (
                            <span className="fig-flyout-key">{entry.shortcut}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {!readOnly && (
        <div style={{ width: '100%' }}>
          <div className="fig-rail-divider" />
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
            <FigIcon name="Copy colors" size={16} />
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
            <FigIcon name="Actions" size={16} />
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
