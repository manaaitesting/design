import { childOfContainer, isArtboard, topLevelOf, type Doc, type SceneNode } from './types';

/**
 * Figma's selection model.
 *
 * The rules are subtle enough that they belong in one place rather than being
 * spread through pointer handlers:
 *
 *   click          → the ancestor at the level you are currently in
 *   double-click   → exactly one level deeper, never straight to the leaf
 *   ⌘-click        → the deepest node under the pointer
 *   Enter          → into the first child · Escape → out to the parent
 *   Tab            → the next sibling at the same level
 *
 * Locked layers, and everything inside them, are untouchable.
 */

export function isLocked(id: string, doc: Doc): boolean {
  let current: SceneNode | undefined = doc[id];
  while (current) {
    if (current.locked) return true;
    current = current.parent ? doc[current.parent] : undefined;
  }
  return false;
}

/** Every selectable node under the pointer, deepest first. */
export function hitStack(clientX: number, clientY: number, doc: Doc): string[] {
  const ids: string[] = [];
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const id = (element as HTMLElement).dataset?.nodeId;
    if (!id || !doc[id] || ids.includes(id)) continue;
    if (isLocked(id, doc)) continue;
    ids.push(id);
  }
  return ids;
}

/** The topmost node under the pointer *including* locked ones, for feedback. */
export function lockedUnder(clientX: number, clientY: number, doc: Doc): string | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const id = (element as HTMLElement).dataset?.nodeId;
    if (id && doc[id] && isLocked(id, doc)) return id;
  }
  return null;
}

export type ClickMode = 'normal' | 'deep';

/**
 * Figma's top-level frames are transparent to the pointer: a click on anything
 * inside one lands on the frame's direct child under the cursor, and only a
 * click on the frame's own background — or on its label — takes the frame.
 * Nested frames and boolean groups still trap the click, so getting inside
 * them is a double-click, as it is in Figma.
 */
export function passesThrough(id: string, doc: Doc): boolean {
  const node = doc[id];
  return !!node && node.type === 'frame' && isArtboard(node, doc);
}

/**
 * What a plain click should select.
 * Returns null when the pointer is over nothing selectable.
 */
export function resolveClick(
  stack: string[],
  doc: Doc,
  entered: string | null,
  mode: ClickMode,
  /** what is selected now — a press on it keeps it rather than starting again */
  selection: string[] = [],
): { id: string; entered: string | null } | null {
  const deepest = stack[0];
  if (!deepest) return null;

  if (mode === 'deep') {
    const parent = doc[deepest]?.parent ?? null;
    return { id: deepest, entered: parent && doc[parent]?.type !== 'page' ? parent : null };
  }

  // A layer you have already selected stays selected when you press it. Without
  // this, picking a buried layer — in the panel, or by drilling in — and then
  // reaching for it on the canvas hands you its artboard instead, and the drag
  // moves the whole board. Deepest first, so pressing a selected child of a
  // selected frame takes the child.
  // A selected top-level frame is the exception: Figma hands a press on its
  // content to the child, which is why a frame is dragged by its label.
  const held = stack.find(
    (id) => selection.includes(id) && !(id !== deepest && passesThrough(id, doc)),
  );
  if (held) {
    const parent = doc[held]?.parent ?? null;
    return { id: held, entered: parent && doc[parent]?.type !== 'page' ? parent : entered };
  }

  if (entered && doc[entered]) {
    const sibling = childOfContainer(deepest, entered, doc);
    // still inside the container we drilled into — stay at this level
    if (sibling) return { id: sibling, entered };
  }

  // outside it (or never drilled in) — back out to the artboard level, and
  // through a top-level frame to the child under the pointer
  const top = topLevelOf(deepest, doc);
  if (top !== deepest && passesThrough(top, doc)) {
    const child = childOfContainer(deepest, top, doc);
    if (child) return { id: child, entered: null };
  }
  return { id: top, entered: null };
}

/**
 * One level deeper from the current selection, the way Figma's double-click
 * works: each press descends a single step rather than jumping to the leaf.
 */
export function resolveDoubleClick(
  stack: string[],
  doc: Doc,
  selection: string[],
): { id: string; entered: string | null } | null {
  const deepest = stack[0];
  if (!deepest) return null;

  const current = selection.length === 1 ? selection[0] : null;
  if (current && current !== deepest) {
    const next = childOfContainer(deepest, current, doc);
    if (next) return { id: next, entered: current };
  }

  // nothing useful selected — start at the artboard, then step in once
  const top = topLevelOf(deepest, doc);
  if (top !== deepest) {
    const next = childOfContainer(deepest, top, doc);
    if (next) return { id: next, entered: top };
  }
  return { id: top, entered: null };
}

/** Enter — the first selectable child. */
export function firstChild(id: string, doc: Doc): string | null {
  for (const child of doc[id]?.children ?? []) {
    if (doc[child]?.visible && !isLocked(child, doc)) return child;
  }
  return null;
}

/** Escape — the parent, unless that would leave the page. */
export function parentOf(id: string, doc: Doc): string | null {
  const parent = doc[id]?.parent;
  if (!parent || doc[parent]?.type === 'page') return null;
  return parent;
}

/** Tab — the next sibling, wrapping around. */
export function siblingOf(id: string, doc: Doc, step: 1 | -1): string | null {
  const node = doc[id];
  const parent = node?.parent ? doc[node.parent] : null;
  const siblings = (parent?.children ?? []).filter((child) => !isLocked(child, doc));
  if (siblings.length < 2) return null;
  const index = siblings.indexOf(id);
  if (index < 0) return null;
  return siblings[(index + step + siblings.length) % siblings.length];
}

/**
 * ⇧⌘A — everything selectable at this level that is not selected now.
 *
 * "This level" rather than "the page", so it inverts inside a frame you have
 * drilled into, which is where the command is actually useful.
 */
export function inverseOf(selection: string[], doc: Doc, level: string): string[] {
  return (doc[level]?.children ?? []).filter(
    (id) => !selection.includes(id) && doc[id]?.visible && !isLocked(id, doc),
  );
}

/** Marquee — everything at `level` whose box intersects the rectangle. */
export function nodesInBox(
  box: { x: number; y: number; w: number; h: number },
  doc: Doc,
  level: string,
  rectOf: (id: string) => { x: number; y: number; w: number; h: number } | null,
): string[] {
  return (doc[level]?.children ?? []).filter((id) => {
    if (isLocked(id, doc) || !doc[id]?.visible) return false;
    const rect = rectOf(id);
    if (!rect) return false;
    return (
      rect.x < box.x + box.w &&
      rect.x + rect.w > box.x &&
      rect.y < box.y + box.h &&
      rect.y + rect.h > box.y
    );
  });
}
