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
      /** the file this handle belongs to — see SessionProvider */
      room: string;
      store: {
        create(type: string, parent: string, props?: Partial<SceneNode>): string;
        update(id: string, patch: Partial<SceneNode>): void;
        remove(ids: string[]): void;
        duplicate(ids: string[], offset?: number): string[];
        serialize(ids: string[]): string;
        paste(payload: string, parent: string, offset?: { x: number; y: number }): string[];
        createComponent(id: string): boolean;
        addInteraction(id: string, patch?: Record<string, unknown>): string | null;
        updateInteraction(id: string, interactionId: string, patch: Record<string, unknown>): void;
        setFlowStart(id: string, name: string | null): void;
        ensureMotion(frame: string, patch?: Record<string, unknown>): unknown;
        setMotion(frame: string, patch: Record<string, unknown>): void;
        clearMotion(frame: string): void;
        setKeyframe(
          frame: string,
          node: string,
          property: string,
          at: number,
          value: number | string,
          patch?: Record<string, unknown>,
        ): string | null;
        updateKeyframe(frame: string, trackId: string, keyId: string, patch: Record<string, unknown>): void;
        updateKeyframes(frame: string, refs: { track: string; key: string }[], patch: Record<string, unknown>): void;
        removeKeyframe(frame: string, trackId: string, keyId: string): void;
        removeKeyframes(frame: string, refs: { track: string; key: string }[]): void;
        addKeyframes(
          frame: string,
          entries: { node: string; property: string; at: number; key: Record<string, unknown> }[],
        ): { track: string; key: string }[];
        removeTrack(frame: string, trackId: string): void;
        createInstance(main: string, parent: string, at?: { x: number; y: number }): string | null;
        detachInstance(id: string): void;
        attachToPath(textId: string, sourceId: string): boolean;
        detachFromPath(textId: string): void;
        rasterize(id: string, src: string): string | null;
        resetInstance(id: string): void;
        pushToMain(instanceId: string): boolean;
        restoreComponent(instanceId: string): string | null;
        addComponentProp(main: string, prop: Record<string, unknown>): string | null;
        removeComponentProp(main: string, propId: string): void;
        bindProp(layer: string, binding: Record<string, unknown> | null): void;
        setPropValue(instance: string, propId: string, value: string): string | null;
        combineAsVariants(ids: string[]): string | null;
        swapInstance(id: string, mainId: string): string | null;
        commit(): void;
        addToken(token: { name: string; type: string; value: string; collection?: string }): string;
        addStyle(style: { name: string; kind: string; value: unknown }): string;
        updateStyle(id: string, patch: Record<string, unknown>): void;
        removeStyle(id: string): void;
        listStyles(kind?: string): { id: string; name: string; kind: string }[];
        applyStyle(ids: string[], styleId: string, slot?: string): void;
        detachStyle(ids: string[], slot: string): void;
        createStyleFrom(id: string, slot: string, name: string): string | null;
        removeToken(id: string): void;
        listTokens(): { id: string; name: string }[];
        listFonts(): { id: string; name: string }[];
        addFont(font: { name: string; src: string; weight: number }): string;
        removeFont(id: string): void;
        updateToken(id: string, patch: Record<string, unknown>): void;
        bindVariable(ids: string[], field: string, tokenId: string | null): void;
        booleanGroup(ids: string[], op: string): string | null;
        setBooleanOp(id: string, op: string): void;
        toggleMask(ids: string[]): void;
        setAnchors(id: string, anchors: { x: number; y: number }[]): void;
        outlineShape(ids: string[]): string[];
        outlineStroke(ids: string[]): string[];
        flatten(ids: string[]): string | null;
        importComponent(payload: string, parent: string, library: { id: string; version: number }, at?: { x: number; y: number }): string | null;
        updateFromLibrary(mainId: string, payload: string, version: number): boolean;
        setPaths(id: string, paths: { anchors: { x: number; y: number }[]; closed: boolean }[]): void;
        scaleNodes(ids: string[], factor: number, origin?: { x: number; y: number }): void;
        addRulerGuide(page: string, axis: 'x' | 'y', at: number): void;
        removeRulerGuide(page: string, index: number): void;
        removeMode(collection: string, mode: string): void;
        addCollection(name: string): string;
        addMode(collection: string, name?: string): string | null;
        setTokenValue(tokenId: string, modeId: string, value: string): void;
        setNodeMode(id: string, collection: string, mode: string | null): void;
        listCollections(): { id: string; name: string; modes: { id: string; name: string }[]; defaultMode: string }[];
        ydoc: {
          getMap(name: string): {
            set(k: string, v: unknown): void;
            delete(k: string): void;
            entries(): Iterable<[string, unknown]>;
          };
        };
        listComments(page?: string): {
          id: string;
          body: string;
          resolved: boolean;
          anchor?: { node: string; u: number; v: number };
          mentions?: string[];
          reactions?: Record<string, string[]>;
          replies: { body: string }[];
        }[];
        addComment(comment: Record<string, unknown>): string;
        removeComment(id: string): void;
        listPages(): string[];
        addPage(name?: string): string;
        wrapInSection(ids: string[]): string | null;
        movePage(id: string, to: number): void;
        duplicatePage(id: string): string | null;
        removePage(id: string): void;
        moveToPage(ids: string[], pageId: string): string[];
        undo(): void;
        redo(): void;
      };
      doc(): Doc;
      ui: { getState(): UIState };
      easingCss(spec: {
        easing: string;
        duration: number;
        bezier?: [number, number, number, number];
        spring?: { stiffness: number; damping: number; mass: number };
      }): string;
      evaluate(condition: string, vars: Record<string, string>): boolean;
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

    // A run killed mid-write — a crashed sync server, a timed-out page — can
    // leave a node behind whose parent went with the fixture. Nothing reaches
    // it again, but `nodeNamed` still finds it, and the test then waits on an
    // element that will never render. Sweep whatever the page cannot reach.
    const reachable = new Set<string>(['root']);
    const walk = (id: string) => {
      for (const child of window.paperlike!.doc()[id]?.children ?? []) {
        reachable.add(child);
        walk(child);
      }
    };
    walk('root');
    const orphans = Object.keys(window.paperlike!.doc()).filter((id) => !reachable.has(id));
    if (orphans.length) store.remove(orphans);
    // tokens and styles are not nodes, so removing the layers does not clear
    // them — and a suite that leaves them behind accumulates duplicates run
    // after run, until a locator that names one of them matches several
    for (const [id] of store.ydoc.getMap('tokens').entries()) store.removeToken(id);
    for (const [id] of store.ydoc.getMap('styles').entries()) store.removeStyle(id);

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
