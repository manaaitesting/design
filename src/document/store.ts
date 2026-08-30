import * as Y from 'yjs';
import { BOOLEAN_LABEL, DEFAULT_FLEX, makeNode, nameFor } from './defaults';
import { applyConstraints } from './constraints';
import { newInteraction } from './prototype';
import {
  anchorBounds,
  cloneAnchor,
  flattenAnchors,
  isClosedShape,
  isPathType,
  outlinePaths,
  placedRegion,
  regionBounds,
  regionOf,
  scaleAnchors,
  shiftRegion,
  subpathBounds,
  subpathsFromRegion,
  subpathsOf,
  variableWidthRegion,
  type Anchor,
} from './geometry';
import { clip, clipAll, strokeRegion, type Region } from './clipper';
import { booleanRegion } from './boolean';
import {
  descendants,
  instanceRoot,
  isCanvasRoot,
  isInFlow,
  setOf,
  ROOT_ID,
  type Align,
  type Axis,
  type BooleanOp,
  type ComponentProp,
  type Doc,
  type FlexSpec,
  type Interaction,
  type NodeType,
  type NumericField,
  FONT_FIELDS,
  isFontField,
  type Paint,
  type PropBinding,
  type SceneNode,
  type StyleKind,
  type VectorPath,
  type StyleSlot,
  type Token,
} from './types';
import { newId } from '../lib/id';
import type { CustomFont } from '../lib/fonts';
import { DEFAULT_COLLECTION, DEFAULT_COLLECTION_ID, type Collection } from './variables';

/** Tag for edits made by this client, so the UndoManager only rewinds our own work. */
export const LOCAL_ORIGIN = Symbol('local');

type YNode = Y.Map<unknown>;

/** Fields held as Yjs collections rather than plain values. */
const CHILDREN = 'children';

/**
 * Identity and placement stay with the instance; everything else follows the
 * main component. Without this, propagation would drag every instance back to
 * the main's coordinates.
 */
const NOT_INHERITED = new Set([
  'id', 'parent', 'children', 'x', 'y', 'name',
  'isComponent', 'instanceOf', 'overridden', 'locked',
  // a main publishes properties and says which variant it is; an instance
  // chooses values. Neither side wants the other's half copied onto it.
  'props', 'isComponentSet', 'variantValues', 'propValues',
  // where a main came from is the main's business; an instance of it is not
  // itself an import, and saying so would offer the update twice
  'libraryId', 'libraryVersion',
]);

function toY(node: SceneNode): YNode {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(node)) {
    if (key === CHILDREN) {
      const arr = new Y.Array<string>();
      arr.push(value as string[]);
      map.set(CHILDREN, arr);
    } else if (value !== undefined) {
      map.set(key, value);
    }
  }
  return map;
}

function fromY(map: YNode): SceneNode {
  const out: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    out[key] = value instanceof Y.Array ? value.toArray() : value;
  }
  return out as unknown as SceneNode;
}

/** The number inside a token's value — "16", "16px" and "1.5rem" all count. */
function numberOf(value: string): number | null {
  const match = /-?\d*\.?\d+/.exec(String(value));
  return match ? Number(match[0]) : null;
}

/**
 * Writes a bound field's resolved number back onto the node.
 *
 * Most bound fields are properties of the node, but the four type ones live
 * inside `font`, and opacity is stored as a fraction of the percentage the
 * variable holds. The rendered CSS carries `var(--name)` either way — this is
 * what keeps the *stored* number honest, because snapping, measuring and the
 * panel all read that rather than the DOM.
 */
function writeBound(ymap: YNode, node: SceneNode, field: NumericField, value: number): void {
  if (isFontField(field)) {
    // read through the Y map rather than the snapshot: inside a transaction the
    // snapshot is still last tick's, and a size written a moment ago is exactly
    // what the line-height ratio below has to divide by
    const font = (ymap.get('font') as SceneNode['font']) ?? node.font;
    if (!font) return;
    const key = FONT_FIELDS[field];
    // The variable holds what the field shows — px for line height, a
    // percentage for letter spacing — while the model stores a ratio and an em
    // fraction. `css.ts` converts the same way on the way out, so the number
    // kept here and the number rendered are the same number.
    const next =
      field === 'lineHeight'
        ? value / Math.max(font.size, 1)
        : field === 'letterSpacing'
          ? value / 100
          : value;
    if (font[key] === next) return;
    ymap.set('font', { ...font, [key]: next });
    return;
  }
  const next = field === 'opacity' ? value / 100 : value;
  if (node[field] !== next) ymap.set(field, next);
}

/** Which kind of style a slot wears, and which slot a kind lands in. */
const KIND_OF: Record<StyleSlot, StyleKind> = {
  fill: 'paint',
  stroke: 'paint',
  text: 'text',
  effect: 'effect',
  grid: 'grid',
};

const SLOT_OF: Record<StyleKind, StyleSlot> = {
  paint: 'fill',
  text: 'text',
  effect: 'effect',
  grid: 'grid',
};

/** The gaps between neighbours in a sorted run, along one axis. */
function between(run: SceneNode[], axis: 'x' | 'y'): number[] {
  const size = axis === 'x' ? 'w' : 'h';
  const gaps: number[] = [];
  for (let i = 1; i < run.length; i++) {
    gaps.push(run[i][axis] - (run[i - 1][axis] + run[i - 1][size]));
  }
  return gaps;
}

/** The tallest member of a row — what the next row has to clear. */
function tallest(row: SceneNode[]): SceneNode {
  return row.reduce((best, node) => (node.h > best.h ? node : best), row[0]);
}

/** The median gap, so one outlier does not set the spacing for everything. */
function typicalGap(gaps: number[]): number {
  if (!gaps.length) return 16;
  const sorted = [...gaps].sort((a, b) => a - b);
  return Math.max(0, Math.round(sorted[sorted.length >> 1]));
}

/** A laid-out box, in coordinates local to its parent. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Within a pixel — DOM measurements never land on exact integers. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

/**
 * Reads an auto-layout spec back out of children that are still absolutely
 * placed — the inference behind Figma's ⇧A.
 */
function inferFlex(frame: SceneNode, kids: SceneNode[]): FlexSpec {
  if (kids.length === 0) return { ...DEFAULT_FLEX, padding: [...DEFAULT_FLEX.padding] };

  const minX = Math.min(...kids.map((k) => k.x));
  const minY = Math.min(...kids.map((k) => k.y));
  const maxX = Math.max(...kids.map((k) => k.x + k.w));
  const maxY = Math.max(...kids.map((k) => k.y + k.h));

  // Children flow along the axis they are *spread* across: a row occupies far
  // more width than its boxes need side by side, while its heights all sit on
  // top of one another. Comparing span against summed size says which is which
  // whatever the sizes are — subtracting them would call an overlap "tight".
  const spreadX = (maxX - minX) / Math.max(1, kids.reduce((sum, k) => sum + k.w, 0));
  const spreadY = (maxY - minY) / Math.max(1, kids.reduce((sum, k) => sum + k.h, 0));
  const direction: Axis = kids.length < 2 ? 'column' : spreadX >= spreadY ? 'row' : 'column';
  const isRow = direction === 'row';

  // gap: the typical space between neighbours, not the average — one outlier
  // shouldn't drag every other spacing with it
  const order = [...kids].sort((a, b) => (isRow ? a.x - b.x : a.y - b.y));
  const gaps: number[] = [];
  for (let i = 1; i < order.length; i++) {
    const previous = order[i - 1];
    const current = order[i];
    gaps.push(isRow ? current.x - (previous.x + previous.w) : current.y - (previous.y + previous.h));
  }
  gaps.sort((a, b) => a - b);
  const gap = gaps.length ? Math.max(0, Math.round(gaps[gaps.length >> 1])) : DEFAULT_FLEX.gap;

  // cross-axis alignment: whichever edge the children agree on
  const starts = kids.map((k) => (isRow ? k.y : k.x));
  const ends = kids.map((k) => (isRow ? k.y + k.h : k.x + k.w));
  const centres = kids.map((k, i) => (starts[i] + ends[i]) / 2);
  const boxStart = isRow ? minY : minX;
  const boxEnd = isRow ? maxY : maxX;
  let align: Align = 'start';
  const flush = starts.every((v) => near(v, boxStart)) && ends.every((v) => near(v, boxEnd));
  if (flush && kids.length > 1) align = 'stretch';
  else if (starts.every((v) => near(v, boxStart))) align = 'start';
  else if (ends.every((v) => near(v, boxEnd))) align = 'end';
  else if (centres.every((v) => near(v, (boxStart + boxEnd) / 2))) align = 'center';

  const padding: FlexSpec['padding'] = [
    Math.max(0, Math.round(minY)),
    Math.max(0, Math.round(frame.w - maxX)),
    Math.max(0, Math.round(frame.h - maxY)),
    Math.max(0, Math.round(minX)),
  ];

  return { ...DEFAULT_FLEX, direction, gap, crossGap: gap, padding, align, justify: 'start' };
}

/** Cheap structural equality so unchanged nodes keep their object identity across snapshots. */
function same(a: SceneNode | undefined, b: SceneNode): boolean {
  if (!a) return false;
  for (const key of Object.keys(b) as (keyof SceneNode)[]) {
    const av = a[key];
    const bv = b[key];
    if (av === bv) continue;
    if (typeof bv === 'object' && bv !== null) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
      continue;
    }
    return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}

export interface Comment {
  id: string;
  page: string;
  x: number;
  y: number;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  createdAt: number;
  resolved: boolean;
  replies: { authorName: string; authorColor: string; body: string; createdAt: number }[];
}

export type { Token };

/**
 * A style: a named set of properties layers subscribe to.
 *
 * A variable is one value, so a layer can hold it inline as `var(--x)`. A style
 * is a whole spec — the paints on a fill, an entire type spec, a stack of
 * effects — so the layer records which style it wears and the store pushes the
 * values onto it, the same way an instance follows its main.
 */
export interface Style {
  id: string;
  name: string;
  kind: StyleKind;
  /** paint → Paint[] · text → FontSpec · effect → the node's effect list */
  value: unknown;
}

export class DocStore {
  readonly ydoc: Y.Doc;
  readonly nodes: Y.Map<YNode>;
  /** page ids, in tab order */
  readonly pages: Y.Array<string>;
  readonly tokens: Y.Map<Token>;
  readonly collections: Y.Map<Collection>;
  readonly fonts: Y.Map<CustomFont>;
  readonly styles: Y.Map<Style>;
  readonly comments: Y.Map<Comment>;
  readonly undoManager: Y.UndoManager;

  /**
   * A viewer's store.
   *
   * Every structural mutation funnels through `transact`, so one flag here
   * stops the whole editor writing — the panels, the canvas, the shortcuts and
   * anything added later. Comments are deliberately outside it: a viewer can
   * still say something about the design, as they can in Figma.
   */
  readOnly = false;

  private snap: Doc = {};
  private listeners = new Set<() => void>();
  /** bumps on any change — nodes, pages or tokens */
  private revision = 0;
  /** guards propagation against re-entering itself */
  private propagating = false;
  private propagationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ydoc: Y.Doc) {
    this.ydoc = ydoc;
    this.nodes = ydoc.getMap<YNode>('nodes');
    this.pages = ydoc.getArray<string>('pages');
    this.tokens = ydoc.getMap<Token>('tokens');
    this.collections = ydoc.getMap<Collection>('collections');
    this.fonts = ydoc.getMap<CustomFont>('fonts');
    this.styles = ydoc.getMap<Style>('styles');
    this.comments = ydoc.getMap<Comment>('comments');
    // comments are conversation, not document history — undo must not eat them
    this.undoManager = new Y.UndoManager([this.nodes, this.pages, this.tokens, this.styles, this.collections], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 350,
    });
    this.rebuild();
    const notify = () => {
      this.rebuild();
      this.revision += 1;
      for (const fn of this.listeners) fn();
    };
    this.nodes.observeDeep(notify);
    this.pages.observe(notify);
    this.tokens.observe(notify);
    this.collections.observe(notify);
    this.fonts.observe(notify);
    this.styles.observe(notify);
    this.comments.observe(notify);
  }

  // ── React binding ──────────────────────────────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Doc => this.snap;

  /** Pages and tokens live outside `snap`, so they need their own change signal. */
  getRevision = (): number => this.revision;

  private rebuild(): void {
    const next: Doc = {};
    let changed = Object.keys(this.snap).length !== this.nodes.size;
    for (const [id, ymap] of this.nodes.entries()) {
      const fresh = fromY(ymap);
      const prev = this.snap[id];
      if (same(prev, fresh)) {
        next[id] = prev!;
      } else {
        next[id] = fresh;
        changed = true;
      }
    }
    if (changed) this.snap = next;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private transact<T>(fn: () => T): T | undefined {
    if (this.readOnly) return undefined;
    return this.ydoc.transact(fn, LOCAL_ORIGIN);
  }

  private childrenOf(id: string): Y.Array<string> | null {
    const node = this.nodes.get(id);
    return (node?.get(CHILDREN) as Y.Array<string> | undefined) ?? null;
  }

  private detach(id: string): void {
    const parentId = this.nodes.get(id)?.get('parent') as string | null | undefined;
    if (!parentId) return;
    const siblings = this.childrenOf(parentId);
    if (!siblings) return;
    const index = siblings.toArray().indexOf(id);
    if (index >= 0) siblings.delete(index, 1);
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  /** Creates the page if the document is empty. Safe to call from every client. */
  ensureRoot(): void {
    if (this.readOnly) return;
    this.ydoc.transact(() => {
      if (!this.nodes.has(ROOT_ID)) {
        this.nodes.set(ROOT_ID, toY(makeNode(ROOT_ID, 'page', null, { name: 'Page 1' })));
      }
      // documents written before pages existed still need indexing
      if (this.pages.length === 0) this.pages.push([ROOT_ID]);
    });
  }

  // ── Pages ──────────────────────────────────────────────────────────────

  listPages(): string[] {
    return this.pages.toArray();
  }

  addPage(name?: string): string {
    const id = newId();
    this.transact(() => {
      const label = name ?? `Page ${this.pages.length + 1}`;
      this.nodes.set(id, toY(makeNode(id, 'page', null, { name: label })));
      this.pages.push([id]);
    });
    return id;
  }

  /**
   * Figma's Duplicate page: the page and everything on it, inserted directly
   * after the original.
   *
   * Deliberately not the clipboard path. `serialize` normalises the roots it
   * packs to the origin so a paste lands under the pointer — on a whole page
   * that would drag the entire layout into the top-left corner.
   */
  duplicatePage(id: string): string | null {
    const source = this.snap[id];
    if (!source || source.type !== 'page') return null;
    const copyId = newId();

    this.transact(() => {
      const copy = (from: string, parent: string | null, into: string, name?: string): void => {
        const node = this.snap[from];
        if (!node) return;
        this.nodes.set(
          into,
          toY(makeNode(into, node.type, parent, {
            ...node,
            id: into,
            parent,
            children: [],
            ...(name ? { name } : null),
          })),
        );
        const list = this.childrenOf(into);
        for (const child of node.children) {
          const childId = newId();
          copy(child, into, childId);
          list?.push([childId]);
        }
      };

      copy(id, null, copyId, `${source.name} copy`);
      const index = this.pages.toArray().indexOf(id);
      this.pages.insert(index < 0 ? this.pages.length : index + 1, [copyId]);
    });

    return copyId;
  }

  removePage(id: string): void {
    if (this.pages.length <= 1) return; // never leave the file page-less
    this.transact(() => {
      const index = this.pages.toArray().indexOf(id);
      if (index < 0) return;
      for (const child of descendants(id, this.snap)) this.nodes.delete(child);
      this.pages.delete(index, 1);
      this.nodes.delete(id);
    });
  }

  // ── Theme tokens ───────────────────────────────────────────────────────

  /**
   * Tokens arrive from other clients and from the MCP server, so one malformed
   * record must not take the panel down with it — a token with no name used to
   * throw out of the sort and blank the whole inspector.
   */
  listTokens(): Token[] {
    return [...this.tokens.values()]
      .filter((token): token is Token => !!token && typeof token.name === 'string')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Fonts ──────────────────────────────────────────────────────────────
  //
  // A face uploaded here travels in the document, so a file opened by someone
  // who does not have the font installed still renders the design rather than
  // a fallback. That is the same trade images make, and the same size ceiling
  // applies for the same reason.

  listFonts(): CustomFont[] {
    return [...this.fonts.values()].filter((font): font is CustomFont => !!font?.name);
  }

  addFont(font: Omit<CustomFont, 'id'>): string {
    const id = newId();
    this.transact(() => this.fonts.set(id, { ...font, id }));
    return id;
  }

  removeFont(id: string): void {
    this.transact(() => this.fonts.delete(id));
  }

  /**
   * The variable collections in the document.
   *
   * A file that has never made one still has a collection — the default, with a
   * single mode — so every caller can resolve through the same path instead of
   * special-casing "no modes yet".
   */
  listCollections(): Collection[] {
    const stored = [...this.collections.values()].filter(
      (entry): entry is Collection => !!entry && Array.isArray(entry.modes) && entry.modes.length > 0,
    );
    const hasDefault = stored.some((entry) => entry.id === DEFAULT_COLLECTION_ID);
    return hasDefault ? stored : [DEFAULT_COLLECTION, ...stored];
  }

  addCollection(name: string): string {
    const id = newId();
    const modeId = newId();
    this.transact(() =>
      this.collections.set(id, {
        id,
        name,
        modes: [{ id: modeId, name: 'Mode 1' }],
        defaultMode: modeId,
      }),
    );
    return id;
  }

  updateCollection(id: string, patch: Partial<Collection>): void {
    this.transact(() => {
      const existing = this.collections.get(id) ?? (id === DEFAULT_COLLECTION_ID ? DEFAULT_COLLECTION : null);
      if (existing) this.collections.set(id, { ...existing, ...patch, id });
    });
    this.schedulePropagation();
  }

  /** Adds a mode, seeded from the one the collection already shows. */
  addMode(collectionId: string, name?: string): string | null {
    const collection =
      this.collections.get(collectionId) ??
      (collectionId === DEFAULT_COLLECTION_ID ? DEFAULT_COLLECTION : null);
    if (!collection) return null;
    const modeId = newId();
    const from = collection.defaultMode;

    this.transact(() => {
      this.collections.set(collectionId, {
        ...collection,
        modes: [...collection.modes, { id: modeId, name: name ?? `Mode ${collection.modes.length + 1}` }],
      });
      // A new mode that resolves to nothing would blank every layer wearing one
      // of its variables, so it starts as a copy of what you were looking at.
      for (const token of this.listTokens()) {
        if ((token.collection ?? DEFAULT_COLLECTION_ID) !== collectionId) continue;
        const current = token.values?.[from] ?? token.value;
        this.tokens.set(token.id, {
          ...token,
          values: { ...(token.values ?? {}), [modeId]: current },
        });
      }
    });
    return modeId;
  }

  removeMode(collectionId: string, modeId: string): void {
    const collection =
      this.collections.get(collectionId) ??
      (collectionId === DEFAULT_COLLECTION_ID ? DEFAULT_COLLECTION : null);
    if (!collection || collection.modes.length <= 1) return;

    this.transact(() => {
      const modes = collection.modes.filter((mode) => mode.id !== modeId);
      this.collections.set(collectionId, {
        ...collection,
        modes,
        defaultMode: collection.defaultMode === modeId ? modes[0].id : collection.defaultMode,
      });
      for (const token of this.listTokens()) {
        if (!token.values || !(modeId in token.values)) continue;
        const values = { ...token.values };
        delete values[modeId];
        this.tokens.set(token.id, { ...token, values });
      }
      // and any frame still asking for the mode that just went away
      for (const [id, ymap] of this.nodes) {
        const node = this.snap[id];
        if (node?.modes?.[collectionId] !== modeId) continue;
        const modesLeft = { ...node.modes };
        delete modesLeft[collectionId];
        ymap.set('modes', modesLeft);
      }
    });
    this.schedulePropagation();
  }

  /** Sets one variable's value in one mode. */
  setTokenValue(tokenId: string, modeId: string, value: string): void {
    this.transact(() => {
      const token = this.tokens.get(tokenId);
      if (!token) return;
      const collection = this.listCollections().find(
        (entry) => entry.id === (token.collection ?? DEFAULT_COLLECTION_ID),
      );
      const isDefault = !collection || collection.defaultMode === modeId;
      this.tokens.set(tokenId, {
        ...token,
        // the default mode stays in `value`, so a document that never uses
        // modes reads exactly as it always did
        ...(isDefault ? { value } : null),
        values: { ...(token.values ?? {}), [modeId]: value },
      });
    });
    this.schedulePropagation();
  }

  /** Points a frame at a mode, or clears the override when `modeId` is null. */
  setNodeMode(id: string, collectionId: string, modeId: string | null): void {
    const node = this.snap[id];
    if (!node) return;
    const modes = { ...(node.modes ?? {}) };
    if (modeId) modes[collectionId] = modeId;
    else delete modes[collectionId];
    this.update(id, { modes });
  }

  addToken(token: Omit<Token, 'id'>): string {
    if (typeof token?.name !== 'string' || !token.name) {
      throw new TypeError('addToken needs a named token: { name, type, value }');
    }
    const id = newId();
    this.transact(() => this.tokens.set(id, { ...token, id }));
    return id;
  }

  updateToken(id: string, patch: Partial<Token>): void {
    this.transact(() => {
      const existing = this.tokens.get(id);
      if (existing) this.tokens.set(id, { ...existing, ...patch, id });
    });
    // a number variable drives real fields now, so moving one has to reach them
    this.schedulePropagation();
  }

  removeToken(id: string): void {
    this.transact(() => this.tokens.delete(id));
  }

  // ── Comments ───────────────────────────────────────────────────────────

  // ── Styles ──────────────────────────────────────────────────────────

  listStyles(kind?: StyleKind): Style[] {
    return [...this.styles.values()]
      .filter((style): style is Style => !!style && typeof style.name === 'string')
      .filter((style) => !kind || style.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  addStyle(style: Omit<Style, 'id'>): string {
    const id = newId();
    this.transact(() => this.styles.set(id, { ...style, id }));
    return id;
  }

  updateStyle(id: string, patch: Partial<Style>): void {
    this.transact(() => {
      const existing = this.styles.get(id);
      if (existing) this.styles.set(id, { ...existing, ...patch, id });
    });
    this.schedulePropagation();
  }

  /**
   * Deleting a style leaves what it was worn as behind.
   *
   * Figma calls this detaching: the layers keep the paint they had, they just
   * stop following anything. Clearing their values instead would make deleting
   * a style a destructive act on every layer that used it.
   */
  removeStyle(id: string): void {
    this.transact(() => {
      this.styles.delete(id);
      for (const node of Object.values(this.snap)) {
        if (!node.styles) continue;
        const kept = Object.fromEntries(
          Object.entries(node.styles).filter(([, styleId]) => styleId !== id),
        );
        if (Object.keys(kept).length !== Object.keys(node.styles).length) {
          this.nodes.get(node.id)?.set('styles', kept);
        }
      }
    });
  }

  // ── Number variables ────────────────────────────────────────────────

  /**
   * Binds a numeric field to a number variable, or releases it.
   *
   * The field's number is set from the variable straight away, so nothing has
   * to wait a propagation tick to look right.
   */
  bindVariable(ids: string[], field: NumericField, tokenId: string | null): void {
    const token = tokenId ? this.tokens.get(tokenId) : null;
    const resolved = token ? numberOf(token.value) : null;
    this.transact(() => {
      for (const id of ids) {
        const node = this.snap[id];
        const ymap = this.nodes.get(id);
        if (!node || !ymap) continue;
        const bound = { ...(node.vars ?? {}) };
        if (tokenId) bound[field] = tokenId;
        else delete bound[field];
        ymap.set('vars', bound);
        if (resolved !== null) writeBound(ymap, node, field, resolved);
      }
    });
  }

  /**
   * Re-resolves every bound field.
   *
   * The rendered CSS already carries `var(--name)`, so this is not what makes
   * the canvas correct — it is what keeps the *stored* number honest, because
   * snapping, resizing and bounds all read that number rather than the DOM.
   */
  private syncVariables(): void {
    if (this.tokens.size === 0) return;
    this.transact(() => {
      for (const node of Object.values(this.snap)) {
        if (!node.vars) continue;
        const ymap = this.nodes.get(node.id);
        if (!ymap) continue;
        // Line height is stored as a ratio of the font size, so a layer with
        // both bound has to resolve its size before the ratio is worked out.
        const fields = (Object.entries(node.vars) as [NumericField, string][]).sort(
          ([a], [b]) => Number(b === 'fontSize') - Number(a === 'fontSize'),
        );
        for (const [field, tokenId] of fields) {
          const token = this.tokens.get(tokenId);
          const value = token ? numberOf(token.value) : null;
          if (value === null) continue;
          writeBound(ymap, node, field, value);
        }
      }
    });
  }

  /** Captures what a layer is wearing now as a style, and subscribes it. */
  createStyleFrom(nodeId: string, slot: StyleSlot, name: string): string | null {
    const node = this.snap[nodeId];
    if (!node) return null;
    const kind = KIND_OF[slot];
    const value =
      slot === 'fill'
        ? (node.fills?.length
            ? node.fills
            : node.fill
              ? [{ id: 'base', value: node.fill, opacity: node.fillOpacity ?? 1, visible: true }]
              : [])
        : slot === 'stroke'
          ? [{ id: 'base', value: node.border?.color ?? '#000000', opacity: 1, visible: true }]
          : slot === 'text'
            ? node.font
            : slot === 'grid'
              ? node.guides
              : (node.effects ?? []);
    const id = this.addStyle({ name, kind, value });
    this.applyStyle([nodeId], id, slot);
    return id;
  }

  /**
   * A paint style can be worn as either a fill or a stroke, so the slot is the
   * caller's to name; the other kinds have only one place to go.
   */
  applyStyle(ids: string[], styleId: string, slot?: StyleSlot): void {
    const style = this.styles.get(styleId);
    if (!style) return;
    const target = slot && KIND_OF[slot] === style.kind ? slot : SLOT_OF[style.kind];
    this.transact(() => {
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (!node) continue;
        node.set('styles', { ...(this.snap[id]?.styles ?? {}), [target]: styleId });
      }
    });
    this.schedulePropagation();
  }

  /** Keeps the values, drops the subscription — Figma's detach. */
  detachStyle(ids: string[], slot: StyleSlot): void {
    this.transact(() => {
      for (const id of ids) {
        const current = this.snap[id]?.styles;
        if (!current?.[slot]) continue;
        const kept = { ...current };
        delete kept[slot];
        this.nodes.get(id)?.set('styles', kept);
      }
    });
  }

  /**
   * Pushes every style onto whatever wears it.
   *
   * Runs beside component propagation, and for the same reason: the layer holds
   * a reference, so the values have to be written somewhere before anything can
   * render them.
   */
  private syncStyles(): void {
    if (this.styles.size === 0) return;
    this.transact(() => {
      for (const node of Object.values(this.snap)) {
        const worn = node.styles;
        if (!worn) continue;
        const ymap = this.nodes.get(node.id);
        if (!ymap) continue;

        for (const [slot, styleId] of Object.entries(worn) as [StyleSlot, string][]) {
          const style = this.styles.get(styleId);
          if (!style) continue;
          if (slot === 'fill' && style.kind === 'paint') {
            const paints = style.value as Paint[];
            if (JSON.stringify(node.fills) === JSON.stringify(paints)) continue;
            ymap.set('fills', paints);
            ymap.set('fill', paints[0]?.value ?? null);
          } else if (slot === 'stroke' && style.kind === 'paint') {
            const color = (style.value as Paint[])[0]?.value;
            if (!color || !node.border || node.border.color === color) continue;
            ymap.set('border', { ...node.border, color });
          } else if (slot === 'text' && style.kind === 'text') {
            if (JSON.stringify(node.font) === JSON.stringify(style.value)) continue;
            ymap.set('font', style.value);
          } else if (slot === 'effect' && style.kind === 'effect') {
            if (JSON.stringify(node.effects) === JSON.stringify(style.value)) continue;
            ymap.set('effects', style.value);
          } else if (slot === 'grid' && style.kind === 'grid') {
            if (JSON.stringify(node.guides) === JSON.stringify(style.value)) continue;
            ymap.set('guides', style.value);
          }
        }
      }
    });
  }

  listComments(page: string): Comment[] {
    return [...this.comments.values()]
      .filter((comment) => comment.page === page)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  addComment(comment: Omit<Comment, 'id' | 'createdAt' | 'resolved' | 'replies'>): string {
    const id = newId();
    // deliberately outside the undo scope — see the UndoManager above
    this.ydoc.transact(() => {
      this.comments.set(id, { ...comment, id, createdAt: Date.now(), resolved: false, replies: [] });
    });
    return id;
  }

  replyToComment(id: string, reply: Comment['replies'][number]): void {
    this.ydoc.transact(() => {
      const comment = this.comments.get(id);
      if (comment) this.comments.set(id, { ...comment, replies: [...comment.replies, reply] });
    });
  }

  updateComment(id: string, patch: Partial<Comment>): void {
    this.ydoc.transact(() => {
      const comment = this.comments.get(id);
      if (comment) this.comments.set(id, { ...comment, ...patch, id });
    });
  }

  removeComment(id: string): void {
    this.ydoc.transact(() => this.comments.delete(id));
  }

  create(type: NodeType, parentId: string, patch: Partial<SceneNode> = {}, index?: number): string {
    const id = newId();
    this.transact(() => {
      const parent = this.nodes.get(parentId);
      if (!parent) return;
      const node = makeNode(id, type, parentId, { name: nameFor(type, this.snap), ...patch });
      this.nodes.set(id, toY(node));
      const siblings = this.childrenOf(parentId);
      if (siblings) siblings.insert(index ?? siblings.length, [id]);
    });
    return id;
  }

  update(id: string, patch: Partial<SceneNode>): void {
    const before = this.snap[id];
    this.transact(() => {
      const node = this.nodes.get(id);
      if (!node) return;
      for (const [key, value] of Object.entries(patch)) {
        if (key === CHILDREN || key === 'id') continue;
        node.set(key, value);
      }
      this.markOverridden(id, Object.keys(patch));
      this.reflowChildren(id, before, patch);
    });
    this.schedulePropagation();
  }

  /**
   * A frame that changed size drags its constrained children with it. Runs
   * inside the caller's transaction so a resize stays one undo step.
   */
  private reflowChildren(id: string, before: SceneNode | undefined, patch: Partial<SceneNode>): void {
    if (!before || (patch.w === undefined && patch.h === undefined)) return;
    if (!before.children.length) return;

    const moves = applyConstraints(
      this.snap,
      id,
      { w: before.w, h: before.h },
      { w: patch.w ?? before.w, h: patch.h ?? before.h },
    );
    for (const [childId, delta] of moves) {
      const child = this.nodes.get(childId);
      if (!child) continue;
      for (const [key, value] of Object.entries(delta)) child.set(key, value);
    }
  }

  /**
   * Editing a node inside an instance pins those properties locally, so a later
   * change to the main component leaves them alone.
   */
  private markOverridden(id: string, keys: string[]): void {
    if (this.propagating) return;
    const node = this.snap[id];
    if (!node || !instanceRoot(id, this.snap)) return;
    const ymap = this.nodes.get(id);
    if (!ymap) return;
    const local = new Set(node.overridden ?? []);
    let changed = false;
    for (const key of keys) {
      if (NOT_INHERITED.has(key) || local.has(key)) continue;
      local.add(key);
      changed = true;
    }
    if (changed) ymap.set('overridden', [...local]);
  }

  updateMany(ids: string[], patch: Partial<SceneNode> | ((node: SceneNode) => Partial<SceneNode>)): void {
    this.transact(() => {
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (!node) continue;
        const delta = typeof patch === 'function' ? patch(this.snap[id]) : patch;
        for (const [key, value] of Object.entries(delta)) {
          if (key === CHILDREN || key === 'id') continue;
          node.set(key, value);
        }
        this.markOverridden(id, Object.keys(delta));
      }
    });
    this.schedulePropagation();
  }

  remove(ids: string[]): void {
    this.transact(() => {
      for (const id of ids) {
        if (id === ROOT_ID) continue;
        if (!this.nodes.has(id)) {
          // An id can outlive its node — a merge that dropped one side, an
          // interrupted delete. Skipping it left it listed as a child for good,
          // because every later delete skipped it for the same reason, and the
          // document had no way back to a consistent tree.
          this.pruneChild(id);
          continue;
        }
        for (const child of descendants(id, this.snap)) this.nodes.delete(child);
        this.detach(id);
        this.nodes.delete(id);
      }
    });
  }

  /**
   * Strips an id out of whichever children list holds it.
   *
   * `detach` asks the node where its parent is; this is for the case where
   * there is no node left to ask, so the lists are searched instead.
   */
  private pruneChild(id: string): void {
    for (const [, node] of this.nodes) {
      const kids = node.get(CHILDREN);
      if (!(kids instanceof Y.Array)) continue;
      const index = (kids as Y.Array<string>).toArray().indexOf(id);
      if (index >= 0) (kids as Y.Array<string>).delete(index, 1);
    }
  }

  reparent(id: string, parentId: string, index?: number): void {
    if (id === parentId) return;
    // refuse to drop a node inside its own subtree
    if (descendants(id, this.snap).includes(parentId)) return;
    this.transact(() => {
      const node = this.nodes.get(id);
      const siblings = this.childrenOf(parentId);
      if (!node || !siblings) return;
      this.detach(id);
      node.set('parent', parentId);
      siblings.insert(Math.min(index ?? siblings.length, siblings.length), [id]);
    });
  }

  /**
   * Moves a node to a new parent and index, adjusting x/y so it does not visually
   * jump. Used by drag-and-drop in the layers panel.
   */
  move(id: string, parentId: string, index: number): void {
    this.moveMany([id], parentId, index);
  }

  /**
   * Drops several nodes at one place, as a block, in a single undo step — what
   * dragging a multi-layer selection in the panel does. `ids` are inserted in
   * the order given, so pass them back-to-front to preserve stacking.
   */
  moveMany(ids: string[], parentId: string, index: number): void {
    const to = this.snap[parentId];
    if (!to) return;

    const movers = ids.filter(
      (id) =>
        id !== parentId &&
        this.snap[id] &&
        !descendants(id, this.snap).includes(parentId) &&
        // a node already carried along inside another mover must not move twice
        !ids.some((other) => other !== id && descendants(other, this.snap).includes(id)),
    );
    if (!movers.length) return;

    this.transact(() => {
      const target = this.childrenOf(parentId);
      if (!target) return;

      // taking a node out shifts everything after it down, so count the movers
      // already sitting before the insertion point before touching anything
      const order = target.toArray();
      const before = movers.filter((id) => {
        const at = order.indexOf(id);
        return at >= 0 && at < index;
      }).length;
      const at = Math.max(0, index - before);

      // Every mover comes out before any goes back in. Detaching and inserting
      // one at a time shifts the list under the movers still to come, so two
      // layers dragged together from the same parent used to end up either side
      // of a layer they were both supposed to pass.
      const lifted: string[] = [];
      for (const id of movers) {
        const node = this.snap[id];
        const ymap = this.nodes.get(id);
        if (!node || !ymap) continue;
        const from = node.parent ? this.snap[node.parent] : null;
        const sameParent = node.parent === parentId;

        this.detach(id);
        ymap.set('parent', parentId);
        if (!sameParent && from) {
          // keep it where it looks like it is by rebasing on the new parent
          ymap.set('x', Math.round(node.x + (from.x ?? 0) - (to.x ?? 0)));
          ymap.set('y', Math.round(node.y + (from.y ?? 0) - (to.y ?? 0)));
        }
        lifted.push(id);
      }
      // as one block, so they keep the order they were given
      if (lifted.length) target.insert(Math.min(at, target.length), lifted);
    });
  }

  /**
   * `]` bring to front · `[` send to back · `⌘]` forward · `⌘[` backward.
   *
   * Z-order is document order, last child in front. The stepping pair moves one
   * place rather than all the way, which is the difference between nudging a
   * layer past the one above it and losing where it was in the stack.
   */
  reorder(ids: string[], where: 'front' | 'back' | 'forward' | 'backward'): void {
    this.transact(() => {
      for (const id of ids) {
        const parentId = this.snap[id]?.parent;
        if (!parentId) continue;
        const siblings = this.childrenOf(parentId);
        if (!siblings) continue;
        const index = siblings.toArray().indexOf(id);
        if (index < 0) continue;
        // the insertion point is read against the list with this layer already
        // taken out of it, which is one shorter
        const last = siblings.length - 1;
        const to =
          where === 'front'
            ? last
            : where === 'back'
              ? 0
              : where === 'forward'
                ? Math.min(index + 1, last)
                : Math.max(index - 1, 0);
        siblings.delete(index, 1);
        siblings.insert(to, [id]);
      }
    });
  }

  duplicate(ids: string[], offset = 20): string[] {
    const created: string[] = [];
    this.transact(() => {
      for (const id of ids) {
        const source = this.snap[id];
        if (!source?.parent) continue;
        const copy = (srcId: string, parentId: string, shift: boolean): string => {
          const src = this.snap[srcId];
          const newNodeId = newId();
          const node = makeNode(newNodeId, src.type, parentId, {
            ...src,
            id: newNodeId,
            parent: parentId,
            children: [],
            x: src.x + (shift ? offset : 0),
            y: src.y + (shift ? offset : 0),
          });
          this.nodes.set(newNodeId, toY(node));
          const kids = this.childrenOf(newNodeId);
          for (const childId of src.children) {
            const childCopy = copy(childId, newNodeId, false);
            kids?.push([childCopy]);
          }
          return newNodeId;
        };
        const dupId = copy(id, source.parent, true);
        const siblings = this.childrenOf(source.parent);
        if (siblings) siblings.insert(siblings.toArray().indexOf(id) + 1, [dupId]);
        created.push(dupId);
      }
    });
    return created;
  }

  /**
   * ⇧A — wrap the selection in a flex container sized to its bounding box, so the
   * new parent lays the children out instead of them being absolutely placed.
   */
  wrapInFlex(ids: string[], flex = true): string | null {
    const items = ids.map((id) => this.snap[id]).filter(Boolean);
    if (!items.length) return null;
    const parentId = items[0].parent;
    if (!parentId) return null;

    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + n.w));
    const maxY = Math.max(...items.map((n) => n.y + n.h));

    const wrapperId = this.create('frame', parentId, {
      name: nameFor('frame', this.snap),
      x: minX - 16,
      y: minY - 16,
      w: maxX - minX + 32,
      h: maxY - minY + 32,
      wMode: flex ? 'fit' : 'fixed',
      hMode: flex ? 'fit' : 'fixed',
      fill: flex ? null : '#FFFFFF',
      clip: false,
      flex: flex ? { direction: 'row', gap: 16, padding: [16, 16, 16, 16], align: 'start', justify: 'start', wrap: false } : null,
    });

    this.transact(() => {
      const kids = this.childrenOf(wrapperId);
      if (!kids) return;
      for (const item of items) {
        this.detach(item.id);
        this.nodes.get(item.id)?.set('parent', wrapperId);
        kids.push([item.id]);
      }
    });
    return wrapperId;
  }

  /**
   * Figma's ⇧A on a frame, and the auto-layout button in the Layout section.
   *
   * Switching auto layout *on* reads the flow back out of where the children
   * already sit — direction, order, gap, padding and cross-axis alignment — so
   * the frame looks the same the instant it becomes a layout. That inference is
   * what makes the shortcut usable on artwork nobody planned as a layout.
   *
   * Switching it *off* needs the opposite: the browser owns those positions, so
   * the caller measures them and they are baked back into x/y here. Without
   * that, every child would snap to whatever stale x/y it was carrying.
   */
  setAutoLayout(
    id: string,
    on: boolean,
    options: { measured?: Record<string, Box>; seed?: Partial<FlexSpec> } = {},
  ): void {
    const node = this.snap[id];
    if (!node) return;
    const measured = options.measured ?? {};

    if (!on) {
      this.transact(() => {
        for (const childId of node.children) {
          const child = this.snap[childId];
          const ychild = this.nodes.get(childId);
          const box = measured[childId];
          if (!child || !ychild || !box) continue;
          ychild.set('x', Math.round(box.x));
          ychild.set('y', Math.round(box.y));
          // "Fill container" has no container to fill once the flow is gone
          if (child.wMode === 'fill') {
            ychild.set('wMode', 'fixed');
            ychild.set('w', Math.max(1, Math.round(box.w)));
          }
          if (child.hMode === 'fill') {
            ychild.set('hMode', 'fixed');
            ychild.set('h', Math.max(1, Math.round(box.h)));
          }
          // absolute-position is meaningless outside an auto layout
          if (child.absolute) ychild.set('absolute', false);
        }
        this.nodes.get(id)?.set('flex', null);
      });
      this.schedulePropagation();
      return;
    }

    const inferred = inferFlex(node, node.children.map((c) => this.snap[c]).filter(Boolean));
    // an explicit choice from the Flow control wins over what was inferred
    this.update(id, { flex: { ...inferred, ...options.seed } });

    // Flow order is document order, so the children have to be re-sorted to
    // match how they were arranged — otherwise the layout scrambles the frame.
    const flex = this.snap[id]?.flex;
    if (!flex || flex.mode === 'grid') return;
    const axis = flex.direction === 'row' ? 'x' : 'y';
    const sorted = [...node.children].sort(
      (a, b) => (this.snap[a]?.[axis] ?? 0) - (this.snap[b]?.[axis] ?? 0),
    );
    if (sorted.every((childId, index) => childId === node.children[index])) return;
    this.transact(() => {
      const kids = this.childrenOf(id);
      if (!kids) return;
      kids.delete(0, kids.length);
      kids.insert(0, sorted);
    });
  }

  /**
   * Figma's "Resize to fit".
   *
   * Anything the browser can shrink-wrap — text, and any auto-layout frame —
   * simply switches to hug. A freeform frame has no such rule to lean on, so its
   * box is recomputed from the children's bounds and the frame is moved by the
   * same amount it shrank, leaving the artwork exactly where it was.
   */
  resizeToFit(ids: string[]): void {
    this.transact(() => {
      for (const id of ids) {
        const node = this.snap[id];
        const ynode = this.nodes.get(id);
        if (!node || !ynode) continue;
        if (node.type !== 'text' && node.children.length === 0) continue;

        if (node.type === 'text' || node.flex) {
          ynode.set('wMode', 'fit');
          ynode.set('hMode', 'fit');
          continue;
        }

        const kids = node.children.map((c) => this.snap[c]).filter(Boolean);
        if (!kids.length) continue;
        const minX = Math.min(...kids.map((k) => k.x));
        const minY = Math.min(...kids.map((k) => k.y));
        const maxX = Math.max(...kids.map((k) => k.x + k.w));
        const maxY = Math.max(...kids.map((k) => k.y + k.h));

        ynode.set('x', Math.round(node.x + minX));
        ynode.set('y', Math.round(node.y + minY));
        ynode.set('w', Math.max(1, Math.round(maxX - minX)));
        ynode.set('h', Math.max(1, Math.round(maxY - minY)));
        ynode.set('wMode', 'fixed');
        ynode.set('hMode', 'fixed');
        // the frame moved by (minX, minY), so the children move back by it
        for (const kid of kids) {
          const child = this.nodes.get(kid.id);
          if (!child) continue;
          child.set('x', Math.round(kid.x - minX));
          child.set('y', Math.round(kid.y - minY));
        }
      }
    });
    this.schedulePropagation();
  }

  /**
   * ⇧A.
   *
   * On a single frame Figma turns *that* frame into a layout; on anything else
   * it wraps the selection in a new one. The shortcut means "lay this out", and
   * which of the two that is depends on what you have selected.
   */
  autoLayoutSelection(ids: string[]): string | null {
    const only = ids.length === 1 ? this.snap[ids[0]] : null;
    if (only && only.type === 'frame' && !only.flex) {
      this.setAutoLayout(only.id, true);
      return only.id;
    }
    return this.wrapInFlex(ids);
  }

  /**
   * ⇧S — puts the selection inside a section.
   *
   * A section is a board for organising artboards, so unlike a group it takes
   * only what sits at canvas level, and it keeps a margin around its contents
   * the way Figma's does — a section flush with its frames reads as a mistake.
   */
  wrapInSection(ids: string[]): string | null {
    const items = ids
      .map((id) => this.snap[id])
      .filter((node): node is SceneNode => !!node && isCanvasRoot(this.snap[node.parent ?? '']));
    if (!items.length) return null;
    const parentId = items[0].parent!;

    const margin = 48;
    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + n.w));
    const maxY = Math.max(...items.map((n) => n.y + n.h));

    // a section sits behind what it holds, so it goes in at the back
    const sectionId = this.create(
      'section',
      parentId,
      {
        name: nameFor('section', this.snap),
        x: Math.round(minX - margin),
        y: Math.round(minY - margin),
        w: Math.round(maxX - minX + margin * 2),
        h: Math.round(maxY - minY + margin * 2),
      },
      0,
    );

    this.transact(() => {
      const kids = this.childrenOf(sectionId);
      const section = this.snap[sectionId];
      if (!kids || !section) return;
      for (const item of items) {
        const node = this.nodes.get(item.id);
        if (!node) continue;
        this.detach(item.id);
        node.set('parent', sectionId);
        // rebase onto the section's origin so nothing appears to move
        node.set('x', Math.round(item.x - section.x));
        node.set('y', Math.round(item.y - section.y));
        kids.push([item.id]);
      }
    });
    return sectionId;
  }

  /**
   * ⌘G — wraps the selection in a transparent frame sized to its bounds.
   * A group is just a frame with no paint of its own, so nothing about the
   * layout model has to know it is special.
   */
  group(ids: string[]): string | null {
    const items = ids.map((id) => this.snap[id]).filter(Boolean);
    if (items.length < 1) return null;
    const parentId = items[0].parent;
    if (!parentId) return null;

    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + n.w));
    const maxY = Math.max(...items.map((n) => n.y + n.h));

    // the group takes the place of the frontmost member, so z-order survives
    const order = this.snap[parentId]?.children ?? [];
    const insertAt = Math.min(...items.map((n) => order.indexOf(n.id)).filter((i) => i >= 0));

    const groupId = this.create(
      'frame',
      parentId,
      {
        name: nameFor('frame', this.snap),
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
        fill: null,
        clip: false,
        flex: null,
      },
      Number.isFinite(insertAt) ? insertAt : undefined,
    );

    this.transact(() => {
      const kids = this.childrenOf(groupId);
      if (!kids) return;
      for (const item of items) {
        this.detach(item.id);
        const node = this.nodes.get(item.id);
        if (!node) continue;
        node.set('parent', groupId);
        // children are positioned relative to the group's origin now
        node.set('x', item.x - minX);
        node.set('y', item.y - minY);
        kids.push([item.id]);
      }
    });
    return groupId;
  }

  /** ⇧⌘G — lifts children back into the grandparent and drops the wrapper. */
  ungroup(ids: string[]): string[] {
    const freed: string[] = [];
    this.transact(() => {
      for (const id of ids) {
        const group = this.snap[id];
        if (!group?.parent || group.children.length === 0) continue;
        const parentId = group.parent;
        const siblings = this.childrenOf(parentId);
        if (!siblings) continue;

        let index = siblings.toArray().indexOf(id);
        for (const childId of [...group.children]) {
          const child = this.snap[childId];
          const node = this.nodes.get(childId);
          if (!child || !node) continue;
          this.detach(childId);
          node.set('parent', parentId);
          node.set('x', group.x + child.x);
          node.set('y', group.y + child.y);
          siblings.insert(Math.min(++index, siblings.length), [childId]);
          freed.push(childId);
        }
        const remaining = siblings.toArray().indexOf(id);
        if (remaining >= 0) siblings.delete(remaining, 1);
        this.nodes.delete(id);
      }
    });
    return freed;
  }

  /**
   * Combines layers into a live boolean group.
   *
   * The children keep their own geometry — the group is a rule for reading them,
   * not a new outline baked over the top, which is why the operation can be
   * changed afterwards and the parts can still be moved inside it.
   */
  booleanGroup(ids: string[], op: BooleanOp): string | null {
    const items = ids
      .map((id) => this.snap[id])
      .filter((node): node is SceneNode => !!node && !!node.parent);
    if (items.length < 2) return null;
    const parentId = items[0].parent!;

    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + n.w));
    const maxY = Math.max(...items.map((n) => n.y + n.h));

    const order = this.snap[parentId]?.children ?? [];
    const insertAt = Math.min(...items.map((n) => order.indexOf(n.id)).filter((i) => i >= 0));

    // Figma gives the result the frontmost member's paint, which is what makes
    // a boolean look like an edit of the shape you were working on
    const lead = items[items.length - 1];

    const groupId = this.create(
      'boolean',
      parentId,
      {
        name: BOOLEAN_LABEL[op],
        op,
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
        fill: lead.fill,
        fills: lead.fills ? lead.fills.map((paint) => ({ ...paint })) : undefined,
        fillOpacity: lead.fillOpacity,
        fillVisible: lead.fillVisible,
        border: lead.border ? { ...lead.border } : null,
        clip: false,
      },
      Number.isFinite(insertAt) ? insertAt : undefined,
    );

    this.transact(() => {
      const kids = this.childrenOf(groupId);
      if (!kids) return;
      for (const item of items) {
        this.detach(item.id);
        const node = this.nodes.get(item.id);
        if (!node) continue;
        node.set('parent', groupId);
        node.set('x', item.x - minX);
        node.set('y', item.y - minY);
        kids.push([item.id]);
      }
    });
    return groupId;
  }

  /** Changes which operation a boolean group applies. */
  setBooleanOp(id: string, op: BooleanOp): void {
    const node = this.snap[id];
    if (!node || node.type !== 'boolean') return;
    const renamed = Object.values(BOOLEAN_LABEL).includes(node.name);
    this.update(id, { op, ...(renamed ? { name: BOOLEAN_LABEL[op] } : null) });
  }

  /**
   * Turns the selection into mask layers, or back.
   *
   * A mask shapes the siblings painted above it, so it has to be the *lowest*
   * of the layers it applies to — Figma moves it there for you, and so does
   * this: the alternative is a mask that silently masks nothing.
   */
  toggleMask(ids: string[]): void {
    const items = ids.map((id) => this.snap[id]).filter(Boolean) as SceneNode[];
    if (!items.length) return;
    const turningOn = items.some((node) => !node.isMask);

    this.transact(() => {
      for (const item of items) {
        const node = this.nodes.get(item.id);
        if (!node) continue;
        node.set('isMask', turningOn);
        if (turningOn && !item.maskType) node.set('maskType', 'alpha');
      }
      if (!turningOn) return;

      // drop each new mask to the bottom of its parent's stack
      for (const item of items) {
        const siblings = item.parent ? this.childrenOf(item.parent) : null;
        if (!siblings) continue;
        const index = siblings.toArray().indexOf(item.id);
        if (index > 0) {
          siblings.delete(index, 1);
          siblings.insert(0, [item.id]);
        }
      }
    });
  }

  /**
   * Paint seeds moved along with the box they are measured in.
   *
   * A seed is a point in the node's own space, so re-fitting the box around
   * edited points moves the geometry under it. Shifting the seeds by the same
   * amount is what keeps a painted region painted while its shape is dragged
   * about; one whose region is edited away simply stops finding it, which is
   * the graceful half of storing a point rather than an outline.
   */
  private shiftSeeds(
    node: SceneNode,
    dx: number,
    dy: number,
  ): [number, number][] | undefined {
    if (!node.fillSeeds?.length || (!dx && !dy)) return node.fillSeeds;
    return node.fillSeeds.map(([x, y]) => [x - dx, y - dy] as [number, number]);
  }

  /**
   * Replaces a vector's anchors and re-fits its box around them.
   *
   * The path is stored relative to the layer, so an edit that moves a point
   * outside the old box has to move the box as well — otherwise dragging a
   * point would slowly detach the outline from the thing you can select.
   */
  setAnchors(id: string, anchors: Anchor[]): void {
    const node = this.snap[id];
    if (!node) return;
    const box = anchorBounds(anchors);
    if (!box) {
      this.update(id, { anchors: anchors.map(cloneAnchor) });
      return;
    }
    const shifted = anchors.map((anchor) => ({
      ...cloneAnchor(anchor),
      x: anchor.x - box.minX,
      y: anchor.y - box.minY,
    }));
    this.update(id, {
      anchors: shifted,
      fillSeeds: this.shiftSeeds(node, box.minX, box.minY),
      x: Math.round(node.x + box.minX),
      y: Math.round(node.y + box.minY),
      w: Math.max(1, Math.round(box.maxX - box.minX)),
      h: Math.max(1, Math.round(box.maxY - box.minY)),
      wMode: 'fixed',
      hMode: 'fixed',
      // a point list is the geometry now; the legacy field would win on reload
      points: undefined,
    });
  }

  /**
   * Replaces a vector's subpaths and re-fits its box around them.
   *
   * The single-anchor-list case goes through here too, so a path that grows a
   * hole and a path that never does are stored and re-fitted the same way.
   */
  setPaths(id: string, paths: VectorPath[]): void {
    const node = this.snap[id];
    if (!node) return;
    const box = subpathBounds(paths);
    if (!box) return;

    const shifted = paths.map((sub) => ({
      closed: sub.closed,
      anchors: sub.anchors.map((anchor) => ({
        ...cloneAnchor(anchor),
        x: anchor.x - box.minX,
        y: anchor.y - box.minY,
      })),
    }));

    this.update(id, {
      paths: shifted,
      // keep the shorthand in step: one subpath is still one anchor list, and
      // everything that reads `anchors` should see the same geometry
      anchors: shifted.length === 1 ? shifted[0].anchors : undefined,
      closed: shifted.length === 1 ? shifted[0].closed : undefined,
      fillSeeds: this.shiftSeeds(node, box.minX, box.minY),
      x: Math.round(node.x + box.minX),
      y: Math.round(node.y + box.minY),
      w: Math.max(1, Math.round(box.maxX - box.minX)),
      h: Math.max(1, Math.round(box.maxY - box.minY)),
      wMode: 'fixed',
      hMode: 'fixed',
      points: undefined,
    });
  }

  /**
   * Brings a published component into this file.
   *
   * The payload is the same one the clipboard carries, so importing is a paste
   * — and what lands is a *local* main component that remembers where it came
   * from. Instances point at that local main, which is what lets an update from
   * the library be applied in one place and reach every instance at once.
   */
  importComponent(
    payload: string,
    parentId: string,
    library: { id: string; version: number },
    at?: { x: number; y: number },
  ): string | null {
    const pasted = this.paste(payload, parentId, at ?? { x: 0, y: 0 });
    const main = pasted.map((id) => this.snap[id]).find((node) => node?.isComponent) ?? this.snap[pasted[0]];
    if (!main) return null;
    // whatever the payload said about *its* library, this copy's provenance is
    // the entry it was taken from
    this.update(main.id, {
      isComponent: true,
      libraryId: library.id,
      libraryVersion: library.version,
    });
    return main.id;
  }

  /**
   * Takes a newer revision of a library component.
   *
   * The main keeps its id — every instance in the file is pointing at it — and
   * its contents are replaced by the new payload's. Propagation then rebuilds
   * the instances, exactly as it does when a main is edited by hand.
   */
  updateFromLibrary(mainId: string, payload: string, version: number): boolean {
    const main = this.snap[mainId];
    if (!main?.parent) return false;

    const libraryId = main.libraryId ?? null;
    // paste the new revision beside it, move its contents across, drop the shell
    const pasted = this.paste(payload, main.parent, { x: 0, y: 0 });
    const fresh = pasted.map((id) => this.snap[id]).find((node) => node?.isComponent) ?? this.snap[pasted[0]];
    if (!fresh) return false;
    // The payload carries the library markers of the file it was published
    // from. Left on the copy, they would make it look like a second import of
    // the same component — so they come off before anything else happens.
    this.update(fresh.id, { libraryId: undefined, libraryVersion: undefined, isComponent: false });

    this.transact(() => {
      const target = this.nodes.get(mainId);
      const kids = this.childrenOf(mainId);
      if (!target || !kids) return;

      // the main's own properties, minus the ones that say where it sits
      for (const [key, value] of Object.entries(fresh)) {
        if (NOT_INHERITED.has(key) || key === 'children') continue;
        target.set(key, value);
      }
      target.set('libraryId', libraryId);
      target.set('libraryVersion', version);

      // hand the new revision's children over rather than copying them again
      const incoming = [...fresh.children];
      for (let i = kids.length - 1; i >= 0; i--) {
        const gone = kids.toArray()[i];
        for (const child of descendants(gone, this.snap)) this.nodes.delete(child);
        kids.delete(i, 1);
        this.nodes.delete(gone);
      }
      for (const child of incoming) {
        const node = this.nodes.get(child);
        if (!node) continue;
        node.set('parent', mainId);
        kids.push([child]);
      }
      // the shell the paste created has given up its children
      const shell = this.childrenOf(fresh.id);
      if (shell) shell.delete(0, shell.length);
    });

    this.remove([fresh.id]);
    this.update(mainId, { libraryVersion: version });
    this.schedulePropagation();
    return true;
  }

  /**
   * Figma's Flatten.
   *
   * A boolean group is a rule for reading its parts; flattening asks the
   * geometry kernel what that rule actually produces and keeps the answer as
   * one editable path. It is a one-way door, which is exactly why it is a
   * separate command from making the group in the first place.
   */
  flatten(ids: string[]): string | null {
    const items = ids
      .map((id) => this.snap[id])
      .filter((node): node is SceneNode => !!node && !!node.parent);
    if (!items.length) return null;

    const target = items[0];
    // A single ordinary shape flattens exactly, through its own curves — the
    // kernel would answer the same question with sampled polygons, and losing
    // the béziers of an ellipse to a flatten nobody asked for is a poor trade.
    if (items.length === 1 && target.type !== 'boolean') {
      const [outlined] = this.outlineShape([target.id]);
      return outlined ?? null;
    }

    // one boolean group flattens to what it was already showing; several layers
    // flatten to their union, which is what selecting them and asking implies
    const region =
      items.length === 1 && target.type === 'boolean'
        ? booleanRegion(target, target.children.map((id) => this.snap[id]).filter(Boolean))
        : clipAll(items.map((node) => placedRegion(node)), 'union');

    const box = regionBounds(region);
    if (!box) return null;

    const parentId = target.parent!;
    const order = this.snap[parentId]?.children ?? [];
    const insertAt = Math.min(...items.map((n) => order.indexOf(n.id)).filter((i) => i >= 0));

    const id = this.create(
      'vector',
      parentId,
      {
        name: target.name,
        x: Math.round(box.minX),
        y: Math.round(box.minY),
        w: Math.max(1, Math.round(box.maxX - box.minX)),
        h: Math.max(1, Math.round(box.maxY - box.minY)),
        paths: subpathsFromRegion(shiftRegion(region, -box.minX, -box.minY)),
        closed: true,
        fill: target.fill,
        fills: target.fills ? target.fills.map((paint) => ({ ...paint })) : undefined,
        fillOpacity: target.fillOpacity,
        fillVisible: target.fillVisible,
        border: target.border ? { ...target.border } : null,
        opacity: target.opacity,
        blend: target.blend,
        effects: target.effects ? target.effects.map((effect) => ({ ...effect })) : undefined,
      },
      Number.isFinite(insertAt) ? insertAt : undefined,
    );

    this.remove(items.map((node) => node.id));
    return id;
  }

  /**
   * Figma's "Outline stroke".
   *
   * The stroke becomes a filled shape — the region a round pen of that width
   * sweeps along the path, trimmed to the side the alignment asked for. A layer
   * that also had a fill keeps it: the outline is added beside it rather than
   * replacing what was there.
   */
  outlineStroke(ids: string[]): string[] {
    const made: string[] = [];

    for (const id of ids) {
      const node = this.snap[id];
      if (!node?.parent || !node.border || node.border.width <= 0) continue;

      // A path is stroked along its whole length, so an open run of two points
      // is a stroke source even though it is not a region — `regionOf` drops it
      // because a two-point ring has no area to be a ring with.
      const outline =
        node.type === 'vector'
          ? (subpathsOf(node)
              .map((sub) => flattenAnchors(sub.anchors, sub.closed, node.smooth ?? 0))
              .filter((ring) => ring.length >= 2) as Region)
          : regionOf(node);
      const closed = isClosedShape(node);
      // A tapered stroke is already a shape rather than a width, so outlining
      // it is a matter of taking the band it draws — running a round pen of one
      // width down it would throw the taper away.
      const varied =
        node.type === 'vector'
          ? variableWidthRegion(subpathsOf(node), node.border.width, node.smooth ?? 0)
          : null;
      if (!varied && !outline.length) continue;
      const band = varied ?? strokeRegion(outline, node.border.width, closed);
      const region =
        varied || !closed || node.border.position === 'center'
          ? band
          : node.border.position === 'inside'
            ? clip(band, outline, 'intersect')
            : clip(band, outline, 'difference');

      const box = regionBounds(region);
      if (!box) continue;

      const order = this.snap[node.parent]?.children ?? [];
      const at = order.indexOf(id);

      const strokeId = this.create(
        'vector',
        node.parent,
        {
          name: `${node.name} stroke`,
          x: Math.round(node.x + box.minX),
          y: Math.round(node.y + box.minY),
          w: Math.max(1, Math.round(box.maxX - box.minX)),
          h: Math.max(1, Math.round(box.maxY - box.minY)),
          paths: subpathsFromRegion(shiftRegion(region, -box.minX, -box.minY)),
          closed: true,
          fill: node.border.color,
          fillVisible: true,
          fillOpacity: 1,
          border: null,
        },
        at >= 0 ? at + 1 : undefined,
      );
      made.push(strokeId);

      // the stroke is a shape now, so the layer it came from stops drawing one;
      // a layer with nothing left to paint goes with it
      const paints = node.fills?.length ? node.fills.some((paint) => paint.visible !== false) : !!node.fill;
      if (paints) this.update(id, { border: null });
      else this.remove([id]);
    }
    return made;
  }

  /**
   * "Outline shape" — turns a parametric shape into editable points.
   *
   * A polygon knows it has five sides; a vector only knows where its corners
   * are. Converting is one-way for that reason, and it is what you do when you
   * want to move one vertex of a star rather than all of them at once.
   */
  outlineShape(ids: string[]): string[] {
    const converted: string[] = [];
    for (const id of ids) {
      const node = this.snap[id];
      if (!node || node.type === 'vector' || !isPathType(node.type)) {
        // a rectangle and an ellipse can be outlined too — they are just boxes
        if (!node || (node.type !== 'rect' && node.type !== 'ellipse')) continue;
      }
      const paths = outlinePaths(node);
      if (!paths.length || paths[0].anchors.length < 2) continue;
      // The outline is the one already on screen, corners and arcs included: a
      // rounded rectangle keeps its corners as per-point radii and a donut
      // keeps both of its rings, so converting changes what the layer *knows*
      // about itself and nothing about what it looks like.
      this.update(id, {
        type: 'vector',
        paths: paths.map((sub) => ({
          closed: sub.closed,
          anchors: sub.anchors.map(cloneAnchor),
        })),
        anchors: paths.length === 1 ? paths[0].anchors.map(cloneAnchor) : undefined,
        closed: paths.length === 1 ? paths[0].closed : undefined,
        smooth: 0,
        radius: 0,
        radii: null,
        sides: undefined,
        innerRatio: undefined,
        arcStart: undefined,
        arcEnd: undefined,
        innerRadius: undefined,
      });
      converted.push(id);
    }
    return converted;
  }

  /**
   * Figma's scale tool.
   *
   * A resize changes a box; a scale changes everything inside it — type sizes,
   * corner radii, stroke weights, padding and gaps all move together, which is
   * the difference between scaling a card and stretching it.
   */
  scaleNodes(
    ids: string[],
    factor: number,
    origin?: { x: number; y: number },
    /**
     * The state the factor is measured against. A live drag passes the document
     * as it was when the gesture started, so every frame scales the original
     * rather than compounding on what the last frame produced.
     */
    baseline?: Doc,
  ): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const source = baseline ?? this.snap;
    const roots = ids.map((id) => source[id]).filter(Boolean) as SceneNode[];
    if (!roots.length) return;

    this.transact(() => {
      for (const root of roots) {
        const anchor = origin ?? { x: root.x, y: root.y };
        const node = this.nodes.get(root.id);
        if (node) {
          node.set('x', Math.round(anchor.x + (root.x - anchor.x) * factor));
          node.set('y', Math.round(anchor.y + (root.y - anchor.y) * factor));
        }
        for (const id of [root.id, ...descendants(root.id, source)]) {
          this.scaleOne(id, factor, id === root.id, source);
        }
      }
    });
    this.schedulePropagation();
  }

  /** Scales one node's own metrics. Position is the caller's business. */
  private scaleOne(id: string, factor: number, isRoot: boolean, from: Doc): void {
    const source = from[id];
    const node = this.nodes.get(id);
    if (!source || !node) return;

    node.set('w', Math.max(1, Math.round(source.w * factor)));
    node.set('h', Math.max(1, Math.round(source.h * factor)));
    node.set('wMode', 'fixed');
    node.set('hMode', 'fixed');
    if (!isRoot) {
      node.set('x', Math.round(source.x * factor));
      node.set('y', Math.round(source.y * factor));
    }
    if (source.radius) node.set('radius', source.radius * factor);
    if (source.radii) node.set('radii', source.radii.map((r) => r * factor));
    if (source.border) node.set('border', { ...source.border, width: source.border.width * factor });
    if (source.font) node.set('font', { ...source.font, size: source.font.size * factor });
    if (source.anchors?.length) {
      node.set('anchors', scaleAnchors(source.anchors, factor, factor).map(cloneAnchor));
    }
    if (source.paths?.length) {
      node.set(
        'paths',
        source.paths.map((sub) => ({
          closed: sub.closed,
          anchors: scaleAnchors(sub.anchors, factor, factor).map(cloneAnchor),
        })),
      );
    }
    if (source.fillSeeds?.length) {
      node.set('fillSeeds', source.fillSeeds.map(([x, y]) => [x * factor, y * factor]));
    }
    if (source.points?.length) {
      node.set('points', source.points.map(([x, y]) => [x * factor, y * factor]));
    }
    if (source.flex) {
      node.set('flex', {
        ...source.flex,
        gap: source.flex.gap * factor,
        crossGap: source.flex.crossGap === undefined ? undefined : source.flex.crossGap * factor,
        padding: source.flex.padding.map((p) => p * factor) as FlexSpec['padding'],
      });
    }
    if (source.effects?.length) {
      node.set(
        'effects',
        source.effects.map((effect) => ({
          ...effect,
          x: effect.x * factor,
          y: effect.y * factor,
          blur: effect.blur * factor,
          spread: effect.spread * factor,
        })),
      );
    }
  }

  // ── Ruler guides ───────────────────────────────────────────────────────
  //
  // Guides belong to the page rather than to the file: they are a drafting aid
  // for one board, they sync like everything else, and they never export.

  addRulerGuide(pageId: string, axis: 'x' | 'y', at: number): void {
    const page = this.snap[pageId];
    if (!page) return;
    this.update(pageId, {
      rulerGuides: [...(page.rulerGuides ?? []), { axis, at: Math.round(at) }],
    });
  }

  moveRulerGuide(pageId: string, index: number, at: number): void {
    const guides = [...(this.snap[pageId]?.rulerGuides ?? [])];
    if (!guides[index]) return;
    guides[index] = { ...guides[index], at: Math.round(at) };
    this.update(pageId, { rulerGuides: guides });
  }

  removeRulerGuide(pageId: string, index: number): void {
    const guides = [...(this.snap[pageId]?.rulerGuides ?? [])];
    if (!guides[index]) return;
    guides.splice(index, 1);
    this.update(pageId, { rulerGuides: guides });
  }

  /**
   * Figma's "Tidy up".
   *
   * Rows are read off the artwork rather than assumed: anything whose vertical
   * span overlaps sits on the same row, which is what lets one command handle a
   * row, a column and a grid without asking which you meant. Each row is then
   * spaced by its own typical gap, so tidying does not resize the arrangement —
   * it only makes it regular.
   */
  tidyUp(ids: string[]): void {
    const items = ids
      .map((id) => this.snap[id])
      .filter((node): node is SceneNode => !!node && !isInFlow(node, this.snap));
    if (items.length < 2) return;

    const originX = Math.min(...items.map((n) => n.x));
    const originY = Math.min(...items.map((n) => n.y));

    // group into rows by vertical overlap
    const rows: SceneNode[][] = [];
    for (const item of [...items].sort((a, b) => a.y - b.y)) {
      const row = rows.find((entry) =>
        entry.some((other) => item.y < other.y + other.h && other.y < item.y + item.h),
      );
      if (row) row.push(item);
      else rows.push([item]);
    }
    for (const row of rows) row.sort((a, b) => a.x - b.x);

    const gapX = typicalGap(rows.flatMap((row) => between(row, 'x')));
    const gapY = typicalGap(between(rows.map((row) => tallest(row)), 'y'));

    this.transact(() => {
      let y = originY;
      for (const row of rows) {
        let x = originX;
        for (const item of row) {
          const node = this.nodes.get(item.id);
          if (node) {
            node.set('x', Math.round(x));
            node.set('y', Math.round(y));
          }
          x += item.w + gapX;
        }
        y += Math.max(...row.map((item) => item.h)) + gapY;
      }
    });
  }

  /**
   * Lays a row out in a given order, and optionally at a given gap.
   *
   * This is the half of Figma's smart selection that writes: the detection is
   * `smartRow` in `arrange.ts`. Everything is placed from the first layer's
   * start, so the arrangement keeps its origin — reordering shuffles the layers
   * through the positions they already occupy rather than moving the row.
   *
   * With no `gap` the gaps stay as they are, in place rather than following
   * their layer: dragging the third layer to the front puts it where the first
   * one was, which is what makes the gesture a swap. With a `gap` every space
   * becomes that one, which is the spacing handle.
   */
  layRow(order: string[], axis: 'x' | 'y', gap?: number): void {
    const items = order.map((id) => this.snap[id]).filter((node): node is SceneNode => !!node);
    if (items.length < 2 || items.length !== order.length) return;
    const size = axis === 'x' ? 'w' : 'h';

    const placed = [...items].sort((a, b) => a[axis] - b[axis]);
    const origin = placed[0][axis];
    const gaps = placed
      .slice(1)
      .map((node, index) => node[axis] - (placed[index][axis] + placed[index][size]));

    this.transact(() => {
      let at = origin;
      items.forEach((item, index) => {
        this.nodes.get(item.id)?.set(axis, Math.round(at));
        at += item[size] + (gap ?? gaps[index] ?? 0);
      });
    });
  }

  /**
   * Figma's alignment row.
   *
   * One object aligns inside its parent; several align to their shared bounding
   * box. Nodes in a flex flow are skipped — their parent owns their position.
   */
  align(ids: string[], edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
    const items = ids.map((id) => this.snap[id]).filter((n) => n && !isInFlow(n, this.snap));
    if (!items.length) return;

    let box: { x: number; y: number; w: number; h: number };
    if (items.length === 1) {
      const parent = items[0].parent ? this.snap[items[0].parent] : null;
      if (!parent || parent.type === 'page') return; // nothing to align against
      box = { x: 0, y: 0, w: parent.w, h: parent.h };
    } else {
      const x = Math.min(...items.map((n) => n.x));
      const y = Math.min(...items.map((n) => n.y));
      box = {
        x,
        y,
        w: Math.max(...items.map((n) => n.x + n.w)) - x,
        h: Math.max(...items.map((n) => n.y + n.h)) - y,
      };
    }

    this.updateMany(
      items.map((n) => n.id),
      (n) => {
        switch (edge) {
          case 'left':
            return { x: Math.round(box.x) };
          case 'hcenter':
            return { x: Math.round(box.x + (box.w - n.w) / 2) };
          case 'right':
            return { x: Math.round(box.x + box.w - n.w) };
          case 'top':
            return { y: Math.round(box.y) };
          case 'vcenter':
            return { y: Math.round(box.y + (box.h - n.h) / 2) };
          default:
            return { y: Math.round(box.y + box.h - n.h) };
        }
      },
    );
  }

  /** Even gaps between three or more objects, along one axis. */
  distribute(ids: string[], axis: 'horizontal' | 'vertical'): void {
    const horizontal = axis === 'horizontal';
    const items = ids
      .map((id) => this.snap[id])
      .filter((n) => n && !isInFlow(n, this.snap))
      .sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    if (items.length < 3) return;

    const start = horizontal ? items[0].x : items[0].y;
    const last = items[items.length - 1];
    const end = horizontal ? last.x + last.w : last.y + last.h;
    const span = end - start;
    const used = items.reduce((total, n) => total + (horizontal ? n.w : n.h), 0);
    const gap = (span - used) / (items.length - 1);

    this.transact(() => {
      if (gap >= 0) {
        // enough room: equalise the gaps between edges
        let cursor = start;
        for (const item of items) {
          this.nodes.get(item.id)?.set(horizontal ? 'x' : 'y', Math.round(cursor));
          cursor += (horizontal ? item.w : item.h) + gap;
        }
        return;
      }

      // The objects overlap, so equal edge gaps would be negative and would
      // reorder them. Space the centres evenly instead — order is preserved
      // and the outermost two stay put, which is what you actually want.
      const firstCentre = start + (horizontal ? items[0].w : items[0].h) / 2;
      const lastCentre = end - (horizontal ? last.w : last.h) / 2;
      const step = (lastCentre - firstCentre) / (items.length - 1);
      items.forEach((item, index) => {
        const centre = firstCentre + step * index;
        const size = horizontal ? item.w : item.h;
        this.nodes.get(item.id)?.set(horizontal ? 'x' : 'y', Math.round(centre - size / 2));
      });
    });
  }

  /**
   * Serialises a selection for the clipboard.
   *
   * Positions are rebased on the selection's own top-left so a paste lands
   * predictably wherever it goes, rather than at the coordinates it was cut from.
   */
/**
   * Every layer on the page that looks like this one — Figma's ⌥⌘A.
   *
   * "Matching" is what the panel would show as identical: the same kind of
   * layer, painted the same way, and for text set the same way. Position and
   * size are deliberately not part of it — two buttons at opposite ends of a
   * page are still the same button, and that is the point of the command.
   */
  selectMatching(id: string, pageId: string): string[] {
    const source = this.snap[id];
    if (!source) return [];

    const paintOf = (node: SceneNode): string =>
      node.fills?.length
        ? node.fills.map((paint) => `${paint.value}@${paint.opacity ?? 1}`).join(',')
        : `${node.fill ?? ''}@${node.fillOpacity ?? 1}`;
    const strokeOf = (node: SceneNode): string =>
      node.border ? `${node.border.color}/${node.border.width}/${node.border.style}` : '';
    const typeOf = (node: SceneNode): string =>
      node.type === 'text' && node.font
        ? `${node.font.family}/${node.font.size}/${node.font.weight}/${node.font.color}`
        : '';
    const signature = (node: SceneNode): string =>
      [node.type, paintOf(node), strokeOf(node), typeOf(node), node.radius, node.opacity].join('|');

    const wanted = signature(source);
    const found: string[] = [];
    const walk = (nodeId: string): void => {
      const node = this.snap[nodeId];
      if (!node) return;
      if (node.type !== 'page' && signature(node) === wanted) found.push(nodeId);
      for (const child of node.children) walk(child);
    };
    walk(pageId);
    return found;
  }

  serialize(ids: string[]): string {
    const roots = ids.filter((id) => {
      const node = this.snap[id];
      return node && !ids.some((other) => other !== id && descendants(other, this.snap).includes(id));
    });
    if (!roots.length) return '';

    const originX = Math.min(...roots.map((id) => this.snap[id].x));
    const originY = Math.min(...roots.map((id) => this.snap[id].y));

    const pack = (id: string, isRoot: boolean): unknown => {
      const node = this.snap[id];
      return {
        ...node,
        id: undefined,
        parent: undefined,
        x: isRoot ? node.x - originX : node.x,
        y: isRoot ? node.y - originY : node.y,
        children: node.children.map((child) => pack(child, false)),
      };
    };

    return JSON.stringify({ paperlike: 1, nodes: roots.map((id) => pack(id, true)) });
  }

  /**
   * Inserts serialised nodes under `parentId` at an offset. Returns the new ids.
   * Unknown payloads are ignored rather than throwing — the clipboard holds all
   * sorts of things.
   */
  paste(payload: string, parentId: string, offset = { x: 0, y: 0 }): string[] {
    let parsed: { paperlike?: number; nodes?: Partial<SceneNode>[] };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return [];
    }
    if (parsed?.paperlike !== 1 || !Array.isArray(parsed.nodes)) return [];
    if (!this.nodes.has(parentId)) return [];

    const created: string[] = [];
    this.transact(() => {
      const insert = (raw: Partial<SceneNode> & { children?: unknown[] }, parent: string, isRoot: boolean): string => {
        const id = newId();
        const kids = (raw.children ?? []) as (Partial<SceneNode> & { children?: unknown[] })[];
        const node = makeNode(id, (raw.type ?? 'rect') as NodeType, parent, {
          ...(raw as Partial<SceneNode>),
          id,
          parent,
          children: [],
          x: (raw.x ?? 0) + (isRoot ? offset.x : 0),
          y: (raw.y ?? 0) + (isRoot ? offset.y : 0),
        });
        this.nodes.set(id, toY(node));
        const list = this.childrenOf(id);
        for (const child of kids) list?.push([insert(child, id, false)]);
        return id;
      };

      const siblings = this.childrenOf(parentId);
      for (const raw of parsed.nodes as (Partial<SceneNode> & { children?: unknown[] })[]) {
        const id = insert(raw, parentId, true);
        siblings?.push([id]);
        created.push(id);
      }
    });
    return created;
  }

  // ── Components ─────────────────────────────────────────────────────────

  // ── Prototyping ────────────────────────────────────────────────────────

  /** Adds an interaction to a layer and returns its id. */
  addInteraction(id: string, patch: Partial<Interaction> = {}): string | null {
    const node = this.snap[id];
    if (!node) return null;
    const interaction = newInteraction(patch);
    this.update(id, { interactions: [...(node.interactions ?? []), interaction] });
    return interaction.id;
  }

  updateInteraction(id: string, interactionId: string, patch: Partial<Interaction>): void {
    const node = this.snap[id];
    if (!node?.interactions) return;
    this.update(id, {
      interactions: node.interactions.map((entry) =>
        entry.id === interactionId ? { ...entry, ...patch } : entry,
      ),
    });
  }

  removeInteraction(id: string, interactionId: string): void {
    const node = this.snap[id];
    if (!node?.interactions) return;
    this.update(id, {
      interactions: node.interactions.filter((entry) => entry.id !== interactionId),
    });
  }

  /** Names a frame as a flow starting point, or clears it with null. */
  setFlowStart(id: string, name: string | null): void {
    if (!this.snap[id]) return;
    this.update(id, { flowStart: name });
  }

  /** Marks a node as a main component. Instances mirror it from then on. */
  createComponent(id: string): boolean {
    const node = this.snap[id];
    if (!node || node.type === 'page' || node.instanceOf) return false;
    this.update(id, { isComponent: true });
    return true;
  }

  /** Places a copy of a main component that keeps following it. */
  createInstance(mainId: string, parentId: string, at?: { x: number; y: number }): string | null {
    const main = this.snap[mainId];
    if (!main?.isComponent) return null;
    if (!this.nodes.has(parentId)) return null;

    let rootId = '';
    this.transact(() => {
      const copy = (sourceId: string, parent: string, isRoot: boolean): string => {
        const source = this.snap[sourceId];
        const id = newId();
        this.nodes.set(
          id,
          toY(
            makeNode(id, source.type, parent, {
              ...source,
              id,
              parent,
              children: [],
              isComponent: false,
              instanceOf: isRoot ? mainId : undefined,
              overridden: [],
              // an instance is not itself an import from the library; only the
              // main it follows carries that provenance
              libraryId: undefined,
              libraryVersion: undefined,
              x: isRoot ? (at?.x ?? source.x + 40) : source.x,
              y: isRoot ? (at?.y ?? source.y + 40) : source.y,
            }),
          ),
        );
        const kids = this.childrenOf(id);
        for (const child of source.children) kids?.push([copy(child, id, false)]);
        return id;
      };
      rootId = copy(mainId, parentId, true);
      // start from what the component publishes, so an instance is usable
      // before anyone touches its properties
      const defaults: Record<string, string> = {};
      for (const prop of main.props ?? []) defaults[prop.id] = prop.value;
      for (const prop of setOf(main, this.snap)?.props ?? []) {
        defaults[prop.id] = main.variantValues?.[prop.id] ?? prop.value;
      }
      if (Object.keys(defaults).length) this.nodes.get(rootId)?.set('propValues', defaults);
      this.childrenOf(parentId)?.push([rootId]);
    });
    return rootId;
  }

  /** Cuts the link, leaving an ordinary subtree behind. */
  /**
   * Figma's "Swap instance".
   *
   * The subtree is rebuilt from the new main rather than relabelled, because a
   * swap that kept the old component's layers would only look like a swap.
   * Placement and size come across: where a thing sits is the instance's own
   * business, not the component's.
   */
  swapInstance(id: string, mainId: string): string | null {
    const instance = this.snap[id];
    const main = this.snap[mainId];
    if (!instance?.instanceOf || !main?.isComponent || !instance.parent) return null;
    if (mainId === instance.instanceOf) return id;

    const parentId = instance.parent;
    const index = this.snap[parentId]?.children.indexOf(id) ?? -1;
    const box = { x: instance.x, y: instance.y, w: instance.w, h: instance.h };

    this.remove([id]);
    const next = this.createInstance(mainId, parentId, { x: box.x, y: box.y });
    if (!next) return null;

    this.transact(() => {
      const node = this.nodes.get(next);
      // a resized instance stays the size you made it
      if (node && instance.wMode === 'fixed') node.set('w', box.w);
      if (node && instance.hMode === 'fixed') node.set('h', box.h);
      // Property values survive a swap where the two components agree on a
      // property — switching from Hover to Default should not also clear the
      // label you typed. The new variant's own values win over the old ones.
      const carried = { ...(instance.propValues ?? {}), ...(main.variantValues ?? {}) };
      if (Object.keys(carried).length) node?.set('propValues', carried);
    });
    if (index >= 0) this.moveMany([next], parentId, index);
    return next;
  }

  // ── Component properties ────────────────────────────────────────────

  /** Publishes a property from a main component. */
  addComponentProp(mainId: string, prop: Omit<ComponentProp, 'id'>): string | null {
    const main = this.snap[mainId];
    if (!main?.isComponent && !main?.isComponentSet) return null;
    const id = newId();
    this.update(mainId, { props: [...(main.props ?? []), { ...prop, id }] });
    return id;
  }

  updateComponentProp(mainId: string, propId: string, patch: Partial<ComponentProp>): void {
    const props = this.snap[mainId]?.props;
    if (!props) return;
    this.update(mainId, {
      props: props.map((prop) => (prop.id === propId ? { ...prop, ...patch, id: propId } : prop)),
    });
  }

  /**
   * Retiring a property has to retire what followed it too, or a layer is left
   * bound to something that no longer exists and simply stops responding.
   */
  removeComponentProp(mainId: string, propId: string): void {
    const main = this.snap[mainId];
    if (!main?.props) return;
    this.transact(() => {
      this.nodes.get(mainId)?.set('props', main.props!.filter((prop) => prop.id !== propId));
      for (const id of [mainId, ...descendants(mainId, this.snap)]) {
        const node = this.snap[id];
        if (!node.bindings?.some((binding) => binding.prop === propId)) continue;
        this.nodes
          .get(id)
          ?.set('bindings', node.bindings.filter((binding) => binding.prop !== propId));
      }
    });
    this.schedulePropagation();
  }

  /** Points a layer at a property, or lets it go. */
  bindProp(layerId: string, binding: PropBinding | null): void {
    const node = this.snap[layerId];
    if (!node) return;
    const kept = (node.bindings ?? []).filter((entry) => entry.field !== binding?.field);
    this.update(layerId, { bindings: binding ? [...kept, binding] : [] });
  }

  /**
   * Sets one property on an instance.
   *
   * A variant property is not an override but a different component, so it is
   * answered by finding the sibling whose variant values match and swapping to
   * it. Everything else is a value the instance carries and propagation applies.
   */
  setPropValue(instanceId: string, propId: string, value: string): string | null {
    const instance = this.snap[instanceId];
    const main = instance?.instanceOf ? this.snap[instance.instanceOf] : null;
    if (!instance || !main) return null;

    const set = setOf(main, this.snap);
    if (set?.props?.some((prop) => prop.id === propId && prop.type === 'variant')) {
      const wanted = { ...(main.variantValues ?? {}), [propId]: value };
      const match = set.children
        .map((id) => this.snap[id])
        .find(
          (variant) =>
            variant?.isComponent &&
            Object.entries(wanted).every(([key, want]) => variant.variantValues?.[key] === want),
        );
      if (!match || match.id === main.id) return instanceId;
      return this.swapInstance(instanceId, match.id);
    }

    this.update(instanceId, { propValues: { ...(instance.propValues ?? {}), [propId]: value } });
    return instanceId;
  }

  /**
   * Figma's "Combine as variants": the selected main components become one
   * component set, and the property that tells them apart is seeded from their
   * names — which is the only thing that distinguishes them at this point.
   */
  combineAsVariants(ids: string[]): string | null {
    const mains = ids
      .map((id) => this.snap[id])
      .filter((node): node is SceneNode => !!node?.isComponent && !!node.parent);
    if (mains.length < 2) return null;
    const parentId = mains[0].parent!;

    const margin = 32;
    const minX = Math.min(...mains.map((n) => n.x));
    const minY = Math.min(...mains.map((n) => n.y));
    const maxX = Math.max(...mains.map((n) => n.x + n.w));
    const maxY = Math.max(...mains.map((n) => n.y + n.h));

    const propId = newId();
    const setId = this.create('frame', parentId, {
      name: nameFor('frame', this.snap),
      x: Math.round(minX - margin),
      y: Math.round(minY - margin),
      w: Math.round(maxX - minX + margin * 2),
      h: Math.round(maxY - minY + margin * 2),
      fill: null,
      clip: false,
      isComponentSet: true,
      props: [
        {
          id: propId,
          name: 'Property 1',
          type: 'variant',
          value: mains[0].name,
          options: mains.map((main) => main.name),
        },
      ],
    });

    this.transact(() => {
      const kids = this.childrenOf(setId);
      const box = this.snap[setId];
      if (!kids || !box) return;
      for (const main of mains) {
        const node = this.nodes.get(main.id);
        if (!node) continue;
        this.detach(main.id);
        node.set('parent', setId);
        node.set('x', Math.round(main.x - box.x));
        node.set('y', Math.round(main.y - box.y));
        node.set('variantValues', { [propId]: main.name });
        kids.push([main.id]);
      }
    });
    return setId;
  }

  detachInstance(id: string): void {
    const node = this.snap[id];
    if (!node?.instanceOf) return;
    this.transact(() => {
      this.nodes.get(id)?.set('instanceOf', undefined);
      for (const child of [id, ...descendants(id, this.snap)]) {
        this.nodes.get(child)?.set('overridden', []);
      }
    });
  }

  /** Throws away local edits so the instance matches its main again. */
  resetInstance(id: string): void {
    if (!this.snap[id]?.instanceOf) return;
    this.transact(() => {
      for (const child of [id, ...descendants(id, this.snap)]) {
        this.nodes.get(child)?.set('overridden', []);
      }
    });
    this.propagate();
  }

  private schedulePropagation(): void {
    if (this.propagating || this.propagationTimer) return;
    // coalesce: dragging a main fires dozens of updates a second
    this.propagationTimer = setTimeout(() => {
      this.propagationTimer = null;
      this.propagate();
    }, 90);
  }

  /**
   * Pushes each main component's shape onto its instances.
   *
   * Walks both trees in lockstep by index, copying every inherited property the
   * instance has not pinned locally, and adding or removing children so the
   * structure matches. Runs under a flag so the writes it makes are not mistaken
   * for user edits and recorded as overrides.
   */
  propagate(): void {
    this.syncVariables();
    this.syncStyles();
    const doc = this.snap;
    const instances = Object.values(doc).filter((n) => n.instanceOf && doc[n.instanceOf]);
    if (!instances.length) return;

    this.propagating = true;
    try {
      this.transact(() => {
        for (const instance of instances) {
          this.sync(instance.instanceOf!, instance.id);
          // properties are applied after the structure has caught up: `sync`
          // copies the main's own `visible` and `text` onto the instance, so
          // doing this first would only be undone
          this.applyProps(instance.instanceOf!, instance.id, instance.propValues ?? {});
        }
      });
    } finally {
      this.propagating = false;
    }
  }

  /**
   * Walks a main and its instance in step, letting each bound layer read the
   * value the instance chose.
   *
   * The bindings live on the *main* — an instance's copy of them is just a
   * copy — so the main is what is walked, and the instance is followed
   * positionally, which is the same correspondence `sync` maintains.
   */
  private applyProps(mainId: string, instanceId: string, values: Record<string, string>): void {
    const main = this.snap[mainId];
    const node = this.nodes.get(instanceId);
    if (!main || !node) return;

    for (const binding of main.bindings ?? []) {
      const value = values[binding.prop];
      if (value === undefined) continue;
      if (binding.field === 'visible') node.set('visible', value !== 'false');
      else if (binding.field === 'text') node.set('text', value);
      // an instance-swap property only accepts something that is a component
      else if (binding.field === 'instance' && this.snap[value]?.isComponent) {
        node.set('instanceOf', value);
      }
    }

    const kids = this.childrenOf(instanceId)?.toArray() ?? [];
    main.children.forEach((child, index) => {
      if (kids[index]) this.applyProps(child, kids[index], values);
    });
  }

  private sync(mainId: string, instanceId: string): void {
    const main = this.snap[mainId];
    const instance = this.snap[instanceId];
    const ymap = this.nodes.get(instanceId);
    if (!main || !instance || !ymap) return;

    const pinned = new Set(instance.overridden ?? []);
    for (const [key, value] of Object.entries(main)) {
      if (NOT_INHERITED.has(key) || pinned.has(key)) continue;
      if (JSON.stringify(instance[key as keyof SceneNode]) === JSON.stringify(value)) continue;
      ymap.set(key, value);
    }

    const kids = this.childrenOf(instanceId);
    if (!kids) return;
    const have = kids.toArray();

    // structure follows the main: trim extras, then add what is missing
    for (let i = have.length - 1; i >= main.children.length; i--) {
      const gone = have[i];
      for (const child of descendants(gone, this.snap)) this.nodes.delete(child);
      kids.delete(i, 1);
      this.nodes.delete(gone);
    }
    for (let i = have.length; i < main.children.length; i++) {
      const source = this.snap[main.children[i]];
      if (!source) continue;
      const clone = (sourceId: string, parent: string): string => {
        const from = this.snap[sourceId];
        const id = newId();
        this.nodes.set(id, toY(makeNode(id, from.type, parent, { ...from, id, parent, children: [], isComponent: false, overridden: [] })));
        const list = this.childrenOf(id);
        for (const c of from.children) list?.push([clone(c, id)]);
        return id;
      };
      kids.push([clone(source.id, instanceId)]);
    }

    const now = kids.toArray();
    for (let i = 0; i < main.children.length && i < now.length; i++) {
      this.sync(main.children[i], now[i]);
    }
  }

  /**
   * Closes the current undo step. `captureTimeout` coalesces the many small
   * writes inside one gesture, but it would also swallow a *following* gesture
   * that starts quickly — drawing a rect and immediately nudging it would undo
   * as one step and delete the rect. Every gesture calls this when it ends, so
   * one gesture is always one ⌘Z.
   */
  commit(): void {
    this.undoManager.stopCapturing();
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }
}
