'use client';

import { create } from 'zustand';
import type { SnapGuide } from '../document/snapping';
import type { ExportFormat, PrototypeDevice } from '../document/types';

/** The view options that are simply on or off — pixel preview has three states. */
export type BooleanView =
  | 'pixelGrid'
  | 'snapToPixel'
  | 'layoutGuides'
  | 'cursors'
  | 'comments'
  | 'annotations'
  | 'outlines'
  | 'labels';

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
  | 'shaders'
  // Figma keeps these two beside Comment: one measures, one annotates
  | 'measure'
  | 'annotate';

/**
 * The sub-tools of vector edit mode.
 *
 *   move     select and drag points, handles and segments
 *   lasso    draw around the points you want selected
 *   paint    fill the region you click, closing it if it was open
 *   bend     drag any segment into a curve, and any point into a smooth one
 *   cut      slice a path in two, wherever you click on it
 *   erase    delete the point or the segment under the pointer
 *   builder  Shape builder: merge the overlapping rings into one outline
 *   width    Variable width: drag a point's stroke wider or narrower
 */
export type VectorTool =
  | 'move'
  | 'lasso'
  | 'paint'
  | 'bend'
  | 'cut'
  | 'erase'
  | 'builder'
  | 'width';

export interface Viewport {
  /** World-space offset of the viewport origin, in screen px. */
  x: number;
  y: number;
  zoom: number;
}

export interface UIState {
  tool: Tool;
  setTool: (tool: Tool) => void;

  /** zoom about the middle of the canvas — the keyboard and the zoom menu */
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;

  /**
   * Space held down — the hand tool, borrowed for as long as the key is.
   *
   * It is state rather than a ref because the tool rail lights the Hand button
   * while it is on: in Figma holding Space *is* the hand tool, and a cursor
   * that changes while the toolbar disagrees reads as a glitch.
   */
  spacePan: boolean;
  setSpacePan: (spacePan: boolean) => void;

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
  /** Figma's ⌥L: shut every open row at once. */
  collapseLayers: () => void;

  /**
   * Figma's ⌘\: every panel out of the way, leaving the canvas.
   *
   * It is how you look at what you have made rather than at the tool, and it
   * is the one piece of chrome state worth a shortcut of its own.
   */
  chrome: boolean;
  toggleChrome: () => void;

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
  /** the text layer whose hyperlink editor ⌘K has just opened */
  linkEditor: string | null;
  setLinkEditor: (id: string | null) => void;
  anchorSelection: number[];
  setAnchorSelection: (indices: number[]) => void;

  /**
   * Which sub-tool the vector toolbar is on.
   *
   * Vector edit mode has a toolbar of its own — Move, Lasso, Paint, Bend, Cut,
   * Erase — because inside a path the pointer means six different things and no
   * amount of modifier keys covers them. It resets to Move whenever the mode is
   * entered, exactly as Figma's does.
   */
  vectorTool: VectorTool;
  setVectorTool: (tool: VectorTool) => void;

  /**
   * The image whose crop is being adjusted. While set, dragging on that layer
   * pans the picture inside it rather than moving the layer.
   */
  cropping: string | null;
  setCropping: (id: string | null) => void;

  /** rulers down the top and left edges, with the guides you drag off them */
  rulers: boolean;
  /**
   * Figma's view options, all of them "show this while I work" rather than
   * anything the document remembers — which is why they live here and not on
   * the page. Each one is a toggle in the zoom menu, with Figma's shortcut.
   */
  view: {
    /** the 1px grid, drawn once a pixel is big enough to see */
    pixelGrid: boolean;
    /** round every drag and resize to whole pixels */
    snapToPixel: boolean;
    /** the layout grids frames carry */
    layoutGuides: boolean;
    /** everyone else's pointers */
    cursors: boolean;
    /** comment pins */
    comments: boolean;
    /** the handoff notes pinned to layers */
    annotations: boolean;
    /** draw the design as outlines only — Figma's ⌥⇧O */
    outlines: boolean;
    /**
     * Figma's "Additional labels": the size written under every frame on the
     * page, not only under the one you have selected. It is what you turn on
     * while checking that a set of boards agree with each other.
     */
    labels: boolean;
    /**
     * Figma's pixel preview: the design as it *rasterises*, at 1× or 2×.
     *
     * Off is the normal canvas, which draws vectors at whatever the zoom is.
     * The preview instead renders once at the chosen density and shows that
     * image back with nearest-neighbour scaling — which is the only way to see
     * what a hairline or a small glyph is really going to do to a pixel.
     */
    pixelPreview: 'off' | '1x' | '2x';
  };
  toggleView: (key: BooleanView) => void;
  setPixelPreview: (mode: UIState['view']['pixelPreview']) => void;
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
  /** height of the Pages list, dragged by the handle along its bottom edge */
  pagesHeight: number;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setPagesHeight: (height: number) => void;
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
  /** the device the *viewer* has picked for this run; the page holds the default */
  device: PrototypeDevice;
  setDevice: (device: PrototypeDevice) => void;

  /** the page currently on the canvas */
  page: string;
  setPage: (id: string) => void;

  /**
   * Clears everything that belongs to *a* document rather than to you.
   *
   * This store is one store for the whole app, which is right for panel widths
   * and wrong for a selection: switching tabs would otherwise carry a selection,
   * a drilled-into frame and a page id from the file you left into the file you
   * arrived at, where those ids name nothing. Panels, tools, view options and
   * chrome are yours and survive the switch.
   */
  resetForFile: () => void;

  /** briefly flags a layer the pointer hit but could not select */
  lockedHint: string | null;
  setLockedHint: (id: string | null) => void;

  /** alignment guides shown while dragging */
  guides: SnapGuide[];
  setGuides: (guides: SnapGuide[]) => void;

  /** `page` is set when the menu was opened on a row in the Pages list */
  contextMenu: { x: number; y: number; stack: string[]; page?: string } | null;
  setContextMenu: (menu: { x: number; y: number; stack: string[]; page?: string } | null) => void;

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
 * Rename and delete, published by the mounted Pages panel for its context menu.
 *
 * Which row is showing a rename input is panel state, and deleting a page has
 * to hand the active page on to a survivor — both live in the panel. This is
 * cheaper than lifting the list into the store for the sake of one menu.
 */
export const pageActions: {
  rename: ((id: string) => void) | null;
  remove: ((id: string) => void) | null;
} = { rename: null, remove: null };

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
  /** the Pages list: one row is 24px, so the default shows a few and scrolls */
  pages: { min: 40, max: 400, base: 96 },
} as const;

interface PanelBounds {
  min: number;
  max: number;
  base: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/**
 * Zoom limits, and the ratio one step of it moves.
 *
 * They live here rather than in the canvas because the wheel, the keyboard and
 * the zoom menu all have to agree — they used to clamp to their own copies of
 * the numbers, which is how two of them ended up with different ceilings.
 */
export const ZOOM = { min: 0.02, max: 64, step: 1.25 } as const;

/**
 * The middle of the canvas area, in the canvas element's own pixels.
 *
 * A zoom has to hold *something* still. The wheel holds the point under the
 * pointer; a keyboard or menu zoom has no pointer, so it holds the middle of
 * what you are looking at.
 */
function canvasCentre(): { x: number; y: number } {
  const rect =
    typeof document === 'undefined'
      ? null
      : document.querySelector('[data-canvas-root]')?.getBoundingClientRect();
  return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
}

/**
 * `vp` rescaled to `next`, with the canvas centre pinned.
 *
 * Scaling `zoom` on its own zooms about the world origin, which walks whatever
 * you were looking at off the screen — the reason ⌘+ read as broken rather than
 * merely coarse.
 */
function zoomed(vp: Viewport, next: number): Viewport {
  const zoom = clamp(next, ZOOM.min, ZOOM.max);
  const { x: px, y: py } = canvasCentre();
  const scale = zoom / vp.zoom;
  return { zoom, x: px - (px - vp.x) * scale, y: py - (py - vp.y) * scale };
}

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
function persistPanels(leftWidth: number, rightWidth: number, pagesHeight: number): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ leftWidth, rightWidth, pagesHeight }));
  } catch {
    // a panel width is not worth breaking a drag over
  }
}

function readPanels(): { leftWidth?: number; rightWidth?: number; pagesHeight?: number } | null {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { leftWidth, rightWidth, pagesHeight } = parsed as Record<string, unknown>;
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    return {
      leftWidth: number(leftWidth),
      rightWidth: number(rightWidth),
      pagesHeight: number(pagesHeight),
    };
  } catch {
    return null;
  }
}

// ── Where you were in each file ──────────────────────────────────────────

const VIEW_KEY = 'paperlike:views';
/** Enough files to cover any plausible tab strip, and no more. */
const VIEW_LIMIT = 24;

export interface FileView {
  viewport: Viewport;
  page: string;
}

/**
 * The viewport and page you left a file on, per file.
 *
 * Tabs are only worth having if coming back to one puts you where you were.
 * Keeping every open file's document live would do it and cost a WebSocket
 * each; remembering this much costs nothing and is indistinguishable in use,
 * because a file you return to reopens framed exactly as you left it rather
 * than snapping back to fit-all.
 */
export function saveFileView(room: string, view: FileView): void {
  try {
    const all = readViews();
    delete all[room];
    const entries = Object.entries(all).slice(-(VIEW_LIMIT - 1));
    localStorage.setItem(VIEW_KEY, JSON.stringify({ ...Object.fromEntries(entries), [room]: view }));
  } catch {
    // a remembered viewport is not worth breaking a pan over
  }
}

export function loadFileView(room: string): FileView | null {
  const saved = readViews()[room];
  if (!saved || typeof saved.page !== 'string') return null;
  const { x, y, zoom } = saved.viewport ?? {};
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (!finite(x) || !finite(y) || !finite(zoom) || zoom <= 0) return null;
  return saved;
}

function readViews(): Record<string, FileView> {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, FileView>) : {};
  } catch {
    return {};
  }
}

export const useUI = create<UIState>((set) => ({
  tool: 'move',
  setTool: (tool) =>
    set({
      tool,
      prompt: tool === 'image' ? 'image' : tool === 'svg' ? 'svg' : null,
      // the Measure tool is the ⌥ readout, held on until you pick another tool
      measuring: tool === 'measure',
    }),

  spacePan: false,
  setSpacePan: (spacePan) => set({ spacePan }),

  zoomBy: (factor) => set((state) => ({ viewport: zoomed(state.viewport, state.viewport.zoom * factor) })),
  zoomTo: (zoom) => set((state) => ({ viewport: zoomed(state.viewport, zoom) })),

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

  collapseLayers: () => set({ expanded: {} }),

  chrome: true,
  toggleChrome: () => set((state) => ({ chrome: !state.chrome })),

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
  setVectorEdit: (vectorEdit) =>
    set({ vectorEdit, anchorSelection: [], vectorTool: 'move', tool: 'move' }),

  linkEditor: null,
  setLinkEditor: (linkEditor) => set({ linkEditor }),
  anchorSelection: [],
  setAnchorSelection: (anchorSelection) => set({ anchorSelection }),

  vectorTool: 'move',
  setVectorTool: (vectorTool) => set({ vectorTool }),

  cropping: null,
  setCropping: (cropping) => set({ cropping }),

  rulers: false,
  toggleRulers: () => set((state) => ({ rulers: !state.rulers })),

  view: {
    pixelGrid: true,
    snapToPixel: true,
    layoutGuides: true,
    cursors: true,
    comments: true,
    annotations: true,
    outlines: false,
    labels: false,
    pixelPreview: 'off',
  },
  toggleView: (key) =>
    set((state) => ({ view: { ...state.view, [key]: !state.view[key] } })),
  setPixelPreview: (pixelPreview) =>
    set((state) => ({ view: { ...state.view, pixelPreview } })),

  measuring: false,
  setMeasuring: (measuring) => set({ measuring }),

  leftPanel: true,
  toggleLeftPanel: () => set((state) => ({ leftPanel: !state.leftPanel })),

  leftWidth: PANEL.left.base,
  rightWidth: PANEL.right.base,
  pagesHeight: PANEL.pages.base,
  setLeftWidth: (width) =>
    set((state) => {
      const leftWidth = fitPanel(width, PANEL.left, state.rightWidth);
      persistPanels(leftWidth, state.rightWidth, state.pagesHeight);
      return { leftWidth };
    }),
  setRightWidth: (width) =>
    set((state) => {
      const rightWidth = fitPanel(width, PANEL.right, state.leftPanel ? state.leftWidth : 0);
      persistPanels(state.leftWidth, rightWidth, state.pagesHeight);
      return { rightWidth };
    }),
  setPagesHeight: (height) =>
    set((state) => {
      const pagesHeight = clamp(Math.round(height), PANEL.pages.min, PANEL.pages.max);
      persistPanels(state.leftWidth, state.rightWidth, pagesHeight);
      return { pagesHeight };
    }),
  resetLeftWidth: () =>
    set((state) => {
      persistPanels(PANEL.left.base, state.rightWidth, state.pagesHeight);
      return { leftWidth: PANEL.left.base };
    }),
  resetRightWidth: () =>
    set((state) => {
      persistPanels(state.leftWidth, PANEL.right.base, state.pagesHeight);
      return { rightWidth: PANEL.right.base };
    }),
  hydratePanels: () =>
    set((state) => {
      const saved = readPanels();
      if (!saved) return {};
      const leftWidth = fitPanel(saved.leftWidth ?? state.leftWidth, PANEL.left, 0);
      return {
        leftWidth,
        rightWidth: fitPanel(saved.rightWidth ?? state.rightWidth, PANEL.right, leftWidth),
        pagesHeight: clamp(saved.pagesHeight ?? state.pagesHeight, PANEL.pages.min, PANEL.pages.max),
      };
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
  resetForFile: () =>
    set({
      page: 'root',
      selection: [],
      hover: null,
      anchor: null,
      entered: null,
      editing: null,
      vectorEdit: null,
      anchorSelection: [],
      linkEditor: null,
      cropping: null,
      expanded: {},
      guides: [],
      lockedHint: null,
      contextMenu: null,
      presenting: null,
      paletteOpen: false,
      historyOpen: false,
      exportOpen: false,
      shadersOpen: false,
      prompt: null,
      following: null,
      spotlight: false,
      chatting: false,
    }),

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
