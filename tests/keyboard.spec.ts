/**
 * The keys Figma's shortcut panel lists that this editor had not bound, and the
 * ones it bound to the wrong thing.
 *
 * They live in a file of their own rather than in `editor.spec.ts` because the
 * thing under test is the key handler itself — one place, one file — and because
 * a keyboard bug reads as a list of chords, which is easier to keep honest when
 * the list is not buried in four thousand lines about the canvas.
 */
import { test, expect } from '@playwright/test';
import { doc, makeNode, openEditor, removeNodes, select, selection } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const tool = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().tool);

test('A arms the Frame tool, the legacy Artboard key Figma still ships', async ({ page }) => {
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('rect');
  await page.keyboard.press('a');
  expect(await tool(page)).toBe('frame');

  // and the modified As still mean what they meant: ⌘A selects, ⇧A lays out
  await page.keyboard.press('v');
  const id = await makeNode(page, 'rect', { name: 'KB A', x: 700, y: 500, w: 60, h: 60, fill: '#4CC3F0' });
  await select(page, [id]);
  await page.keyboard.press('Alt+a');
  expect(await tool(page)).toBe('move');
  await removeNodes(page, [id]);
});

test('⌥⇧A takes auto layout off, which ⇧A only ever put on', async ({ page }) => {
  const frame = await makeNode(page, 'frame', {
    name: 'KB Layout', x: 700, y: 400, w: 300, h: 120, fill: '#FFFFFF', flex: null,
  });
  await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    store.create('rect', parent, { name: 'KB One', x: 0, y: 0, w: 60, h: 60, fill: '#4CC3F0' } as never);
    store.create('rect', parent, { name: 'KB Two', x: 0, y: 0, w: 60, h: 60, fill: '#F2637F' } as never);
    store.commit();
  }, frame);

  await select(page, [frame]);
  await page.keyboard.press('Shift+a');
  expect((await doc(page))[frame].flex).toBeTruthy();

  // and back off again, with the children left where the layout had put them
  await select(page, [frame]);
  await page.keyboard.press('Alt+Shift+a');
  const after = await doc(page);
  expect(after[frame].flex).toBeFalsy();
  const kids = Object.values(after).filter((n) => n.parent === frame);
  expect(kids.length).toBe(2);
  // side by side, not stacked back on the origin the flow had made meaningless
  expect(new Set(kids.map((n) => n.x)).size).toBe(2);

  await removeNodes(page, [frame]);
});

test('⇧X swaps the fill and the stroke, and ⌘X still cuts', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'KB Swap', x: 700, y: 500, w: 80, h: 80, fill: '#4CC3F0',
    border: { width: 4, color: '#F2637F', style: 'solid', position: 'inside' },
  } as never);
  await select(page, [id]);

  await page.keyboard.press('Shift+x');
  const swapped = (await doc(page))[id];
  expect(swapped.fill).toBe('#F2637F');
  expect(swapped.border!.color).toBe('#4CC3F0');
  // the stroke keeps everything about itself except its colour
  expect(swapped.border!.width).toBe(4);

  // twice puts it back, which is what makes the key safe to press
  await page.keyboard.press('Shift+x');
  const back = (await doc(page))[id];
  expect([back.fill, back.border!.color]).toEqual(['#4CC3F0', '#F2637F']);

  // a filled shape with no stroke gains one in the fill's colour: Figma's way
  // of outlining something you have just drawn
  const plain = await makeNode(page, 'rect', {
    name: 'KB Outline', x: 900, y: 500, w: 60, h: 60, fill: '#9B7BF0',
  });
  await select(page, [plain]);
  await page.keyboard.press('Shift+x');
  const outlined = (await doc(page))[plain];
  expect(outlined.border).toMatchObject({ color: '#9B7BF0', width: 1 });
  expect(outlined.fill).toBeNull();

  // and the layer is still there — ⇧X must not reach the unguarded ⌘X cut
  expect((await selection(page))[0]).toBe(plain);
  await removeNodes(page, [id, plain]);
});
