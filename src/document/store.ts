import * as Y from 'yjs';
import { DEFAULT_FLEX, makeNode, nameFor } from './defaults';
import { applyConstraints } from './constraints';
import { newInteraction } from './prototype';
import {
  descendants,
  instanceRoot,
  isCanvasRoot,
  isInFlow,
  setOf,
  ROOT_ID,
  type Align,
  type Axis,
  type ComponentProp,
  type Doc,
  type FlexSpec,
  type Interaction,
  type NodeType,
  type NumericField,
  type Paint,
  type PropBinding,
  type SceneNode,
  type StyleKind,
  type StyleSlot,
} from './types';
import { newId } from '../lib/id';

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

/** Which kind of style a slot wears, and which slot a kind lands in. */
const KIND_OF: Record<StyleSlot, StyleKind> = {
  fill: 'paint',
  stroke: 'paint',
  text: 'text',
  effect: 'effect',
};

const SLOT_OF: Record<StyleKind, StyleSlot> = {
  paint: 'fill',
  text: 'text',
  effect: 'effect',
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

export interface Token {
  id: string;
  name: string;
  type: 'color' | 'number' | 'text';
  value: string;
}

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
  readonly styles: Y.Map<Style>;
  readonly comments: Y.Map<Comment>;
  readonly undoManager: Y.UndoManager;

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
    this.styles = ydoc.getMap<Style>('styles');
    this.comments = ydoc.getMap<Comment>('comments');
    // comments are conversation, not document history — undo must not eat them
    this.undoManager = new Y.UndoManager([this.nodes, this.pages, this.tokens, this.styles], {
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
  private transact<T>(fn: () => T): T {
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
        if (resolved !== null) ymap.set(field, field === 'opacity' ? resolved / 100 : resolved);
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
        for (const [field, tokenId] of Object.entries(node.vars) as [NumericField, string][]) {
          const token = this.tokens.get(tokenId);
          const value = token ? numberOf(token.value) : null;
          if (value === null) continue;
          const next = field === 'opacity' ? value / 100 : value;
          if (node[field] !== next) ymap.set(field, next);
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
      let at = Math.max(0, index - before);

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
        target.insert(Math.min(at, target.length), [id]);
        at++;
      }
    });
  }

  /** `]` bring to front · `[` send to back — z-order is document order. */
  reorder(ids: string[], where: 'front' | 'back'): void {
    this.transact(() => {
      for (const id of ids) {
        const parentId = this.snap[id]?.parent;
        if (!parentId) continue;
        const siblings = this.childrenOf(parentId);
        if (!siblings) continue;
        const index = siblings.toArray().indexOf(id);
        if (index < 0) continue;
        siblings.delete(index, 1);
        siblings.insert(where === 'front' ? siblings.length : 0, [id]);
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
