'use client';

import { create } from 'zustand';
import type { SnapGuide } from '../document/snapping';
import type { ExportFormat } from '../document/types';

export type Tool =
  | 'move'
  | 'pan'
  | 'scale'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'slice'
  | 'text'
  | 'comment'
  | 'image'
  | 'svg'
  | 'shaders';

export interface Viewport {
  /** World-space offset of the viewport origin, in screen px. */
  x: number;
  y: number;
  zoom: number;
}

export interface UIState {
  tool: Tool;
  setTool: (tool: Tool) => void;

  selection: string[];
  select: (ids: string[]) => void;
  toggle: (id: string) => void;
  clearSelection: () => void;

  hover: string | null;
  setHover: (id: string | null) => void;

  /**
   * Layer rows that are open in the panel. Figma ships containers collapsed and
   * opens them as you drill in, so absence means closed. Expansion lives here
   * rather than in the rows themselves: selecting on the canvas has to be able
   * to open every ancestor of the selection, which a row cannot do for itself.
   */
  expanded: Record<string, boolean>;
  toggleExpanded: (id: string) => void;
  setExpanded: (ids: string[], open: boolean) => void;

  /**
   * The row a range-select measures from — the last one clicked without shift,
   * exactly as a file list behaves.
   */
  anchor: string | null;
  setAnchor: (id: string | null) => void;

  /**
   * The container you have drilled into. While set, a single click selects
   * siblings at that level instead of jumping back out to the artboard.
   */
  entered: string | null;
  setEntered: (id: string | null) => void;

  viewport: Viewport;
  setViewport: (next: Viewport | ((prev: Viewport) => Viewport)) => void;

  /** id of the text node currently being edited in place */
  editing: string | null;
  setEditing: (id: string | null) => void;

  /**
   * The vector whose points are being edited, and which of them are selected.
   *
   * Point editing is a mode rather than a tool: while it is on, the pointer
   * belongs to the anchors instead of to the layer, exactly as Figma's does.
   */
  vectorEdit: string | null;
  setVectorEdit: (id: string | null) => void;
  anchorSelection: number[];
  setAnchorSelection: (indices: number[]) => void;

  /**
   * The image whose crop is being adjusted. While set, dragging on that layer
   * pans the picture inside it rather than moving the layer.
   */
  cropping: string | null;
  setCropping: (id: string | null) => void;

  /** rulers down the top and left edges, with the guides you drag off them */
  rulers: boolean;
  toggleRulers: () => void;

  /**
   * ⌥ held over the canvas: Figma switches to measuring, showing the distance
   * from the selection to whatever is under the pointer.
   */
  measuring: boolean;
  setMeasuring: (on: boolean) => void;

  leftPanel: boolean;
  toggleLeftPanel: () => void;

  /**
   * Panel widths, in px. Both sides are drag-resizable and persist per
   * browser; the setters clamp so the canvas between them never disappears.
   */
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  resetLeftWidth: () => void;
  resetRightWidth: () => void;
  /** reads the saved widths — call once on mount, never during render */
  hydratePanels: () => void;
  tab: 'design' | 'assets' | 'theme';
  setTab: (tab: 'design' | 'assets' | 'theme') => void;

  /**
   * The right panel's tab. It lives here rather than in the panel because the
   * canvas draws prototype connections whenever Prototype is showing, exactly
   * as Figma does.
   */
  inspectorTab: 'design' | 'prototype' | 'inspect';
  setInspectorTab: (tab: 'design' | 'prototype' | 'inspect') => void;

  /** the frame Present is playing, or null when it is closed */
  presenting: string | null;
  present: (frame: string | null) => void;

  /** the bezel Present draws around the frame */
  device: 'none' | 'phone' | 'tablet' | 'laptop';
  setDevice: (device: 'none' | 'phone' | 'tablet' | 'laptop') => void;

  /** the page currently on the canvas */
  page: string;
  setPage: (id: string) => void;

  /** briefly flags a layer the pointer hit but could not select */
  lockedHint: string | null;
  setLockedHint: (id: string | null) => void;

  /** alignment guides shown while dragging */
  guides: SnapGuide[];
  setGuides: (guides: SnapGuide[]) => void;

  contextMenu: { x: number; y: number; stack: string[] } | null;
  setContextMenu: (menu: { x: number; y: number; stack: string[] } | null) => void;

  shadersOpen: boolean;
  setShadersOpen: (open: boolean) => void;

  /** the floating bottom prompt bar, used by Create image / Create SVG */
  prompt: 'image' | 'svg' | null;
  setPrompt: (kind: 'image' | 'svg' | null) => void;

  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;

  /** the version-history panel, read from the sync server's snapshots */
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;

  /** ⌘/ — every command by name, and every layer by name */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  /**
   * Observation. `following` is the awareness client id whose viewport we are
   * mirroring; `spotlight` is the other direction — everyone follows us.
   */
  following: number | null;
  setFollowing: (clientId: number | null) => void;
  spotlight: boolean;
  setSpotlight: (on: boolean) => void;

  /** the cursor-chat box, opened with `/` */
  chatting: boolean;
  setChatting: (open: boolean) => void;

  exportFormat: ExportFormat;
  setExportFormat: (format: ExportFormat) => void;
  exportScale: number;
  setExportScale: (scale: number) => void;

  /** the suffix and contents-only flag the Export dialog is acting on */
  exportSuffix: string;
  setExportSuffix: (suffix: string) => void;
  exportContentsOnly: boolean;
  setExportContentsOnly: (only: boolean) => void;
}

export type { ExportFormat };

/**
 * Panel geometry. `base` is the width the panel ships at — the same number the
 * stylesheet uses, so an un-dragged panel looks identical either way.
 */
export const PANEL = {
  left: { min: 180, max: 480, base: 241 },
  right: { min: 280, max: 640, base: 355 },
  /** the icon rail, which is not resizable */
  toolRail: 42,
  /** however hard you drag, this much canvas survives between the panels */
  canvasMin: 240,
  /** each panel is separated from the canvas by a 1px border */
  border: 1,
} as const;

interface PanelBounds {
  min: number;
  max: number;
  base: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/**
 * Clamp a panel to its own bounds, then again against the space the other
 * panel leaves. Without the second pass, dragging hard on a narrow window
 * squeezes the canvas out of existence.
 */
function fitPanel(width: number, bounds: PanelBounds, otherWidth: number): number {
  const wanted = clamp(Math.round(width), bounds.min, bounds.max);
  if (typeof window === 'undefined') return wanted;
  const spare =
    window.innerWidth - PANEL.toolRail - PANEL.canvasMin - otherWidth - PANEL.border * 2;
  // `spare` can fall below the minimum on a very narrow window; the minimum
  // wins there, since a panel narrower than that is unusable anyway.
  return Math.max(bounds.min, Math.min(wanted, spare));
}

const PANEL_KEY = 'paperlike:panels';

/** Storage is unavailable in private windows and blocked by some settings. */
function persistPanels(leftWidth: number, rightWidth: number): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ leftWidth, rightWidth }));
  } catch {
    // a panel width is not worth breaking a drag over
  }
}

function readPanels(): { leftWidth?: number; rightWidth?: number } | null {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { leftWidth, rightWidth } = parsed as Record<string, unknown>;
    return {
      leftWidth: typeof leftWidth === 'number' && Number.isFinite(leftWidth) ? leftWidth : undefined,
      rightWidth:
        typeof rightWidth === 'number' && Number.isFinite(rightWidth) ? rightWidth : undefined,
    };
  } catch {
    return null;
  }
}

export const useUI = create<UIState>((set) => ({
  tool: 'move',
  setTool: (tool) => set({ tool, prompt: tool === 'image' ? 'image' : tool === 'svg' ? 'svg' : null }),

  selection: [],
  select: (selection) => set({ selection }),
  toggle: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((s) => s !== id)
        : [...state.selection, id],
    })),
  clearSelection: () =>
    set({ selection: [], editing: null, entered: null, vectorEdit: null, anchorSelection: [] }),

  hover: null,
  setHover: (hover) => set({ hover }),

  expanded: {},
  toggleExpanded: (id) =>
    set((state) => ({ expanded: { ...state.expanded, [id]: !state.expanded[id] } })),
  setExpanded: (ids, open) =>
    set((state) => {
      // no-op writes would re-render every row, and this runs on every selection
      if (ids.every((id) => !!state.expanded[id] === open)) return {};
      const expanded = { ...state.expanded };
      for (const id of ids) expanded[id] = open;
      return { expanded };
    }),

  anchor: null,
  setAnchor: (anchor) => set({ anchor }),

  entered: null,
  setEntered: (entered) => set({ entered }),

  viewport: { x: 0, y: 0, zoom: 1 },
  setViewport: (next) =>
    set((state) => ({ viewport: typeof next === 'function' ? next(state.viewport) : next })),

  editing: null,
  setEditing: (editing) => set({ editing }),

  vectorEdit: null,
  setVectorEdit: (vectorEdit) => set({ vectorEdit, anchorSelection: [] }),
  anchorSelection: [],
  setAnchorSelection: (anchorSelection) => set({ anchorSelection }),

  cropping: null,
  setCropping: (cropping) => set({ cropping }),

  rulers: false,
  toggleRulers: () => set((state) => ({ rulers: !state.rulers })),

  measuring: false,
  setMeasuring: (measuring) => set({ measuring }),

  leftPanel: true,
  toggleLeftPanel: () => set((state) => ({ leftPanel: !state.leftPanel })),

  leftWidth: PANEL.left.base,
  rightWidth: PANEL.right.base,
  setLeftWidth: (width) =>
    set((state) => {
      const leftWidth = fitPanel(width, PANEL.left, state.rightWidth);
      persistPanels(leftWidth, state.rightWidth);
      return { leftWidth };
    }),
  setRightWidth: (width) =>
    set((state) => {
      const rightWidth = fitPanel(width, PANEL.right, state.leftPanel ? state.leftWidth : 0);
      persistPanels(state.leftWidth, rightWidth);
      return { rightWidth };
    }),
  resetLeftWidth: () =>
    set((state) => {
      persistPanels(PANEL.left.base, state.rightWidth);
      return { leftWidth: PANEL.left.base };
    }),
  resetRightWidth: () =>
    set((state) => {
      persistPanels(state.leftWidth, PANEL.right.base);
      return { rightWidth: PANEL.right.base };
    }),
  hydratePanels: () =>
    set((state) => {
      const saved = readPanels();
      if (!saved) return {};
      const leftWidth = fitPanel(saved.leftWidth ?? state.leftWidth, PANEL.left, 0);
      return { leftWidth, rightWidth: fitPanel(saved.rightWidth ?? state.rightWidth, PANEL.right, leftWidth) };
    }),
  tab: 'design',
  setTab: (tab) => set({ tab }),

  inspectorTab: 'design',
  // leaving the tab drops any half-drawn connection, and entering it drops the
  // drawing tool: you cannot rubber-band a rectangle over the noodles
  setInspectorTab: (inspectorTab) =>
    set((state) => ({
      inspectorTab,
      tool: inspectorTab === 'prototype' && state.tool !== 'pan' ? 'move' : state.tool,
    })),

  presenting: null,
  present: (presenting) => set({ presenting, editing: null }),

  device: 'none',
  setDevice: (device) => set({ device }),

  page: 'root',
  setPage: (page) => set({ page, selection: [], entered: null, editing: null }),

  lockedHint: null,
  setLockedHint: (lockedHint) => set({ lockedHint }),

  guides: [],
  setGuides: (guides) => set({ guides }),

  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),

  shadersOpen: false,
  setShadersOpen: (shadersOpen) => set({ shadersOpen, tool: shadersOpen ? 'shaders' : 'move' }),

  prompt: null,
  setPrompt: (prompt) => set({ prompt }),

  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),

  historyOpen: false,
  setHistoryOpen: (historyOpen) => set({ historyOpen }),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  following: null,
  // following someone and presenting to them are mutually exclusive
  setFollowing: (following) =>
    set((state) => ({ following, spotlight: following === null ? state.spotlight : false })),
  spotlight: false,
  setSpotlight: (spotlight) =>
    set((state) => ({ spotlight, following: spotlight ? null : state.following })),

  chatting: false,
  setChatting: (chatting) => set({ chatting }),

  exportFormat: 'react',
  setExportFormat: (exportFormat) => set({ exportFormat }),
  exportScale: 2,
  setExportScale: (exportScale) => set({ exportScale }),

  exportSuffix: '',
  setExportSuffix: (exportSuffix) => set({ exportSuffix }),
  exportContentsOnly: false,
  setExportContentsOnly: (exportContentsOnly) => set({ exportContentsOnly }),
}));

/** Screen px → world coordinates. */
export function toWorld(vp: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
}

/** World coordinates → screen px. */
export function toScreen(vp: Viewport, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * vp.zoom + vp.x, y: wy * vp.zoom + vp.y };
}
