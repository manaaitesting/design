'use client';

import { Icon } from './ui/Icons';
import { useUI, type Tool } from '../state/ui';

interface Entry {
  tool: Tool;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
}

/** The vertical rail, in the order and grouping from the reference. */
const GROUPS: Entry[][] = [
  [
    { tool: 'move', label: 'Move', shortcut: 'V', icon: <Icon.Move /> },
    { tool: 'pan', label: 'Hand tool', shortcut: 'H', icon: <Icon.Hand /> },
  ],
  [
    { tool: 'frame', label: 'Frame', shortcut: 'F', icon: <Icon.Frame /> },
    { tool: 'rect', label: 'Rectangle', shortcut: 'R', icon: <Icon.Square /> },
    { tool: 'pen', label: 'Pen', shortcut: 'P', icon: <Icon.Pen /> },
    { tool: 'text', label: 'Text', shortcut: 'T', icon: <Icon.Text /> },
    { tool: 'comment', label: 'Comment', shortcut: 'C', icon: <Icon.Comment /> },
  ],
  [
    { tool: 'image', label: 'Create image', icon: <Icon.ImageAi /> },
    { tool: 'svg', label: 'Create SVG', icon: <Icon.SvgAi /> },
    { tool: 'shaders', label: 'Shaders', icon: <Icon.Shader /> },
  ],
];

export function ToolRail() {
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);
  const setShadersOpen = useUI((s) => s.setShadersOpen);

  return (
    <div className="fig-rail">
      {GROUPS.map((group, index) => (
        <div key={index} style={{ width: '100%' }}>
          {index > 0 && <div className="fig-rail-divider" />}
          {group.map((entry) => (
            <button
              key={entry.tool}
              type="button"
              className="fig-tool"
              data-on={tool === entry.tool ? 'true' : undefined}
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
          ))}
        </div>
      ))}
    </div>
  );
}
