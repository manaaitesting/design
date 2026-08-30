/**
 * The pen, and the keys that belong to the points rather than to the layer.
 *
 * These drive the tool the way a hand does — press, press, modifier, leave —
 * because the bugs here were all about what happens *between* clicks: a path
 * that existed only in React state until it was committed, and a ⌫ that fell
 * through the point editor into the editor's own layer delete.
 */
import { expect, test } from '@playwright/test';
import { doc, makeNode, openEditor, removeNodes, select, selection } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const armPen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().setTool('pen'));

const drawn = async (page: import('@playwright/test').Page) => {
  const id = (await selection(page))[0];
  return (await doc(page))[id];
};

test('leaving the pen finishes the path instead of throwing it away', async ({ page }) => {
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.mouse.click(620, 600);
  await page.mouse.click(620, 700);

  // picking up another tool is not a way of undrawing: in Figma the layer has
  // been on the document since the first segment
  await page.evaluate(() => window.paperlike!.ui.getState().setTool('move'));
  const path = await drawn(page);
  expect(path.type).toBe('vector');
  expect(path.anchors).toHaveLength(3);
  await removeNodes(page, [path.id]);

  // and Escape ends the path rather than undrawing it
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.mouse.click(640, 640);
  await page.keyboard.press('Escape');
  const stopped = await drawn(page);
  expect(stopped.type).toBe('vector');
  expect(stopped.anchors).toHaveLength(2);
  await removeNodes(page, [stopped.id]);

  // one point is not a path, and leaves nothing behind
  const before = Object.keys(await doc(page)).length;
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.keyboard.press('Escape');
  expect(Object.keys(await doc(page)).length).toBe(before);
});

test('⇧ holds the pen to 45° from the point before it', async ({ page }) => {
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.keyboard.down('Shift');
  // 120 across and 20 down is nowhere near a 45° step; held, it is flat
  await page.mouse.click(620, 620);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Enter');

  const path = await drawn(page);
  const [first, second] = path.anchors!;
  expect(second.y).toBe(first.y);
  // the same `constrain45` the line tool uses: the point swings onto the ray
  // and keeps the length of the pull, so 120 across and 20 down comes out flat
  // at the length of that diagonal
  expect(second.x - first.x).toBe(Math.round(Math.hypot(120, 20)));
  await removeNodes(page, [path.id]);
});

test('⌫ in point editing takes a point, and never the layer', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Pointy', x: 400, y: 500, w: 200, h: 100,
    anchors: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }],
  } as never);
  await select(page, [id]);
  await page.evaluate((node) => window.paperlike!.ui.getState().setVectorEdit(node), id);

  // edit mode opens with nothing selected, and ⌫ used to fall straight through
  // to the editor's own delete and take the whole layer
  await page.keyboard.press('Backspace');
  expect((await doc(page))[id]).toBeTruthy();

  // ⌘⌫ is Figma's delete-and-heal; it too belongs to the points
  await page.keyboard.press('Meta+Backspace');
  expect((await doc(page))[id]).toBeTruthy();
  expect((await doc(page))[id].anchors).toHaveLength(3);

  // with a point selected it does what it says, and the gap closes
  await page.evaluate(() => window.paperlike!.ui.getState().setAnchorSelection([1]));
  await page.keyboard.press('Backspace');
  expect((await doc(page))[id].anchors).toHaveLength(2);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});
