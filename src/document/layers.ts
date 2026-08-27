/**
 * The layers panel's model.
 *
 * Figma lists the front-most layer first: the panel reads top-to-bottom the way
 * the artwork stacks front-to-back. Document order is the opposite — a child
 * later in `children` paints over its siblings, as in the DOM — so every walk
 * here reverses, and so does the arithmetic that turns a drop into an index.
 * Keeping both in one file is what stops the two from drifting apart.
 */

import { descendants, type Doc, type SceneNode } from './types';

export interface LayerRow {
  id: string;
  node: SceneNode;
  /** nesting level; the page's own children sit at 0 */
  depth: number;
  hasChildren: boolean;
  open: boolean;
  /** hidden itself, or inside something hidden */
  hidden: boolean;
  /** locked itself, or inside something locked */
  locked: boolean;
}

/** Containers you can drop into. Everything else only takes a neighbour drop. */
export function isContainer(node: SceneNode | undefined): boolean {
  return node?.type === 'frame' || node?.type === 'page';
}

/**
 * The rows the panel shows, front-most first, descending only into open
 * containers. Hidden and locked are inherited on the way down, so a row can be
 * dimmed without walking back up the tree for every paint.
 */
export function flattenLayers(
  doc: Doc,
  pageId: string,
  expanded: Record<string, boolean>,
): LayerRow[] {
  const rows: LayerRow[] = [];

  const walk = (id: string, depth: number, hidden: boolean, locked: boolean): void => {
    const node = doc[id];
    if (!node) return;

    const rowHidden = hidden || !node.visible;
    const rowLocked = locked || node.locked;
    const hasChildren = node.children.length > 0;
    const open = hasChildren && !!expanded[id];

    rows.push({ id, node, depth, hasChildren, open, hidden: rowHidden, locked: rowLocked });
    if (!open) return;
    for (let i = node.children.length - 1; i >= 0; i--) {
      walk(node.children[i], depth + 1, rowHidden, rowLocked);
    }
  };

  const page = doc[pageId];
  if (!page) return rows;
  for (let i = page.children.length - 1; i >= 0; i--) walk(page.children[i], 0, false, false);
  return rows;
}

/** Where a dragged row would land relative to the row under the pointer. */
export type DropWhere = 'above' | 'below' | 'inside';

export interface DropTarget {
  id: string;
  where: DropWhere;
}

export interface Placement {
  parent: string;
  /** index into the parent's `children`, i.e. back-to-front */
  index: number;
}

/**
 * Turns a drop target into a parent and a child index. Because the list runs
 * front-first, dropping *above* a row means landing *after* it in the array.
 */
export function placementFor(doc: Doc, target: DropTarget): Placement | null {
  const over = doc[target.id];
  if (!over) return null;

  // Figma drops into a container at the top of its list, which is the front.
  if (target.where === 'inside') return { parent: target.id, index: over.children.length };

  const parentId = over.parent;
  const parent = parentId ? doc[parentId] : null;
  if (!parentId || !parent) return null;
  const index = parent.children.indexOf(target.id);
  if (index < 0) return null;
  return { parent: parentId, index: target.where === 'above' ? index + 1 : index };
}

/**
 * The nodes a drag actually moves: the selection minus anything that is already
 * riding along inside another dragged node, ordered back-to-front so inserting
 * them one after another preserves the stacking they had.
 */
export function movingNodes(ids: string[], rows: LayerRow[]): string[] {
  const set = new Set(ids);
  const kept = rows.filter((row) => set.has(row.id) && !hasSelectedAncestor(row.id, set, rows));
  // rows run front-first, so reversing gives the order an insert loop wants
  return kept.map((row) => row.id).reverse();
}

function hasSelectedAncestor(id: string, selected: Set<string>, rows: LayerRow[]): boolean {
  const byId = new Map(rows.map((row) => [row.id, row.node] as const));
  let parent = byId.get(id)?.parent ?? null;
  while (parent) {
    if (selected.has(parent)) return true;
    parent = byId.get(parent)?.parent ?? null;
  }
  return false;
}

/** True when dropping `ids` here would put a node inside itself. */
export function isLegalDrop(doc: Doc, ids: string[], parent: string): boolean {
  return !ids.some((id) => id === parent || descendants(id, doc).includes(parent));
}

/** The rows between two ids in the flattened list — shift-click's range. */
export function rangeBetween(rows: LayerRow[], from: string, to: string): string[] {
  const a = rows.findIndex((row) => row.id === from);
  const b = rows.findIndex((row) => row.id === to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).map((row) => row.id);
}
