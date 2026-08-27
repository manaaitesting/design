import type { Page } from '@playwright/test';
import type { Doc, SceneNode } from '../src/document/types';
import type { UIState } from '../src/state/ui';

/**
 * The editor exposes a development-only handle on `window.paperlike`. Reaching
 * for it keeps assertions about the *document* separate from assertions about
 * the DOM, so a test can state what it means: "this node moved", not "this
 * pixel changed".
 */
declare global {
  interface Window {
    paperlike?: {
      store: {
        create(type: string, parent: string, props?: Partial<SceneNode>): string;
        update(id: string, patch: Partial<SceneNode>): void;
        remove(ids: string[]): void;
        serialize(ids: string[]): string;
        paste(payload: string, parent: string, offset?: { x: number; y: number }): string[];
        createComponent(id: string): boolean;
        addInteraction(id: string, patch?: Record<string, unknown>): string | null;
        updateInteraction(id: string, interactionId: string, patch: Record<string, unknown>): void;
        setFlowStart(id: string, name: string | null): void;
        createInstance(main: string, parent: string, at?: { x: number; y: number }): string | null;
        detachInstance(id: string): void;
        commit(): void;
        addToken(token: { name: string; type: string; value: string }): string;
        removeToken(id: string): void;
        listTokens(): { id: string; name: string }[];
        ydoc: { getMap(name: string): { set(k: string, v: unknown): void; entries(): Iterable<[string, unknown]> } };
        undo(): void;
        redo(): void;
      };
      doc(): Doc;
      ui: { getState(): UIState };
    };
  }
}

export const FILE = '/f/testfile00';

/** Selects nodes through the UI store, the same path a click takes. */
export function select(page: Page, ids: string[]): Promise<void> {
  return page.evaluate((list) => window.paperlike!.ui.getState().select(list), ids);
}

export function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => window.paperlike!.ui.getState().selection);
}

export async function openEditor(page: Page): Promise<void> {
  await page.goto(FILE);
  await page.waitForFunction(() => !!window.paperlike, null, { timeout: 20_000 });
  await page.waitForFunction(() => !!window.paperlike!.doc().root);
  await resetDoc(page);
  // A fixed viewport, so a fixture's world coordinates map to predictable
  // screen pixels and a synthetic drag lands where the test meant it to.
  await page.evaluate(() => window.paperlike!.ui.getState().setViewport({ x: 120, y: 100, zoom: 1 }));
}

/**
 * Clears the scratch page and rebuilds a known scene: one artboard holding a
 * cover image area and a caption. Tests assert against *this*, never against
 * the demo document — a suite that edits real content is one failure away from
 * destroying it.
 */
export async function resetDoc(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.paperlike!.store;
    const doc = window.paperlike!.doc();
    const top = doc.root?.children ?? [];
    if (top.length) store.remove([...top]);
    // tokens are not nodes, so removing the layers does not clear them — and a
    // suite that leaves them behind accumulates duplicates run after run
    for (const [id] of store.ydoc.getMap('tokens').entries()) store.removeToken(id);

    const board = store.create('frame', 'root', {
      name: 'Fixture Board', x: 0, y: 0, w: 600, h: 400, fill: '#FFFFFF', flex: null,
    });
    store.create('rect', board, {
      name: 'Cover', x: 40, y: 40, w: 240, h: 240, fill: '#4CC3F0',
    });
    store.create('text', board, {
      name: 'Caption', x: 40, y: 310, w: 240, h: 40, text: 'Fixture', fill: '#111111',
    });
    store.commit();
  });
  await page.waitForFunction(
    () => Object.values(window.paperlike!.doc()).some((n) => n.name === 'Fixture Board'),
  );
}

export function doc(page: Page) {
  return page.evaluate(() => window.paperlike!.doc());
}

export async function nodeNamed(page: Page, name: string): Promise<SceneNode | undefined> {
  return page.evaluate((n) => Object.values(window.paperlike!.doc()).find((x) => x.name === n), name);
}

/**
 * Creates a node and returns its id, so tests can build their own fixtures.
 * Closes the undo step afterwards: the editor does that at the end of every
 * gesture, and without it a fixture would merge into the edit under test.
 */
export function makeNode(page: Page, type: string, props: Partial<SceneNode>): Promise<string> {
  return page.evaluate(
    ([t, p]) => {
      const id = window.paperlike!.store.create(t as string, 'root', p as Partial<SceneNode>);
      window.paperlike!.store.commit();
      return id;
    },
    [type, props] as const,
  );
}

export function removeNodes(page: Page, ids: string[]): Promise<void> {
  return page.evaluate((list) => window.paperlike!.store.remove(list), ids);
}

/** A realistic drag: press, several moves, release. One move never snaps. */
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
  modifiers: string[] = [],
): Promise<void> {
  for (const key of modifiers) await page.keyboard.down(key as 'Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(from.x + (by.x * step) / 8, from.y + (by.y * step) / 8);
  }
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key as 'Alt');
}
