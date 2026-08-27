import * as Y from 'yjs';
import { makeNode, nameFor } from './defaults';
import { applyConstraints } from './constraints';
import { newInteraction } from './prototype';
import {
  descendants,
  instanceRoot,
  isInFlow,
  ROOT_ID,
  type Doc,
  type Interaction,
  type NodeType,
  type SceneNode,
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

export class DocStore {
  readonly ydoc: Y.Doc;
  readonly nodes: Y.Map<YNode>;
  /** page ids, in tab order */
  readonly pages: Y.Array<string>;
  readonly tokens: Y.Map<Token>;
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
    this.comments = ydoc.getMap<Comment>('comments');
    // comments are conversation, not document history — undo must not eat them
    this.undoManager = new Y.UndoManager([this.nodes, this.pages, this.tokens], {
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
  }

  removeToken(id: string): void {
    this.transact(() => this.tokens.delete(id));
  }

  // ── Comments ───────────────────────────────────────────────────────────

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
        if (id === ROOT_ID || !this.nodes.has(id)) continue;
        for (const child of descendants(id, this.snap)) this.nodes.delete(child);
        this.detach(id);
        this.nodes.delete(id);
      }
    });
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
      this.childrenOf(parentId)?.push([rootId]);
    });
    return rootId;
  }

  /** Cuts the link, leaving an ordinary subtree behind. */
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
    const doc = this.snap;
    const instances = Object.values(doc).filter((n) => n.instanceOf && doc[n.instanceOf]);
    if (!instances.length) return;

    this.propagating = true;
    try {
      this.transact(() => {
        for (const instance of instances) {
          this.sync(instance.instanceOf!, instance.id);
        }
      });
    } finally {
      this.propagating = false;
    }
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
