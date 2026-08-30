import { isInFlow, type Doc, type SceneNode } from './types';

/**
 * Reading a selection as a row or a column.
 *
 * Figma calls this smart selection: pick three or more layers that sit in a
 * line and it offers to reorder them and to respace them, without asking you to
 * put them in an auto layout first. Whether they *are* a line is read off the
 * artwork, exactly as `store.tidyUp` reads rows — layers that overlap across
 * the line are on it, layers that overlap along it are not in a sequence at all.
 *
 * The detection lives here rather than in `selection.ts`, which is about what a
 * click picks, or in the store, which is about what a command does. This is a
 * question about an arrangement, and both of the others ask it.
 */

export interface SmartRow {
  /** the axis the layers read along */
  axis: 'x' | 'y';
  /** the selection in the order it reads, front to back along that axis */
  ids: string[];
}

export function smartRow(doc: Doc, ids: string[]): SmartRow | null {
  const items = ids
    .map((id) => doc[id])
    .filter((node): node is SceneNode => !!node && !isInFlow(node, doc));
  // two layers are a pair, not a sequence: there is no middle to reorder into
  // and only one gap, which the measure tool already tells you about
  if (items.length < 3 || items.length !== ids.length) return null;
  // one parent, or the coordinates are not comparable and the layers are not
  // one arrangement in any case
  const parent = items[0].parent;
  if (!items.every((node) => node.parent === parent)) return null;
  // a flowed row is the auto layout's business, and it already has handles
  if (parent && doc[parent]?.flex) return null;

  const along = (axis: 'x' | 'y'): string[] | null => {
    const size = axis === 'x' ? 'w' : 'h';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'h' : 'w';
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
    // nothing may overlap its neighbour along the line, or there is no order
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][axis] < sorted[i - 1][axis] + sorted[i - 1][size]) return null;
    }
    // and they must all cross one band, or they are a scatter rather than a row
    const low = Math.max(...sorted.map((node) => node[cross]));
    const high = Math.min(...sorted.map((node) => node[cross] + node[crossSize]));
    if (high <= low) return null;
    return sorted.map((node) => node.id);
  };

  // The two are mutually exclusive: a row's members do not overlap across x, so
  // they cannot all share a band of it. No tie to break.
  const row = along('x');
  if (row) return { axis: 'x', ids: row };
  const column = along('y');
  return column ? { axis: 'y', ids: column } : null;
}

/** The gap before each layer after the first, in document order along the axis. */
export function gapsOf(doc: Doc, row: SmartRow): number[] {
  const size = row.axis === 'x' ? 'w' : 'h';
  return row.ids.slice(1).map((id, index) => {
    const before = doc[row.ids[index]];
    return doc[id][row.axis] - (before[row.axis] + before[size]);
  });
}
