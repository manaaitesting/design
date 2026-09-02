/**
 * Prototyping: what the canvas says about a flow, and what the player does with
 * it.
 *
 * These are about the two halves disagreeing. An interaction Present honours
 * but the canvas does not draw is a flow you can only read by opening the
 * panel; a board Present can open but the destination menu will not offer is a
 * board that has fallen out of the prototype without saying so.
 */
import { expect, test } from '@playwright/test';
import { doc, makeNode, nodeNamed, openEditor, removeNodes, select } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const openTab = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().setInspectorTab('prototype'));

test('a board inside a section is still a destination, a flow and a target', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const inner = await makeNode(page, 'frame', {
    name: 'Sectioned', x: 760, y: 0, w: 300, h: 200, fill: '#FFF7E6', flex: null,
  });
  const section = await page.evaluate((id) => {
    const made = window.paperlike!.store.wrapInSection([id]);
    window.paperlike!.store.commit();
    return made;
  }, inner);
  expect(section).toBeTruthy();
  expect((await doc(page))[inner].parent).toBe(section);

  // the destination menu offers it
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await select(page, [button]);
  await openTab(page);
  await page.locator('button[title="Add interactions"]').click();
  await page.locator('.fig-interaction-summary').click();
  await page.locator('.fig-interaction button', { hasText: 'Pick a frame' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Sectioned' }).click();
  expect((await doc(page))[button].interactions![0].destination).toBe(inner);

  // and it can start a flow, which is the other thing a section used to cost it
  await select(page, [inner]);
  await expect(page.locator('.fig-flow-badge')).toBeVisible();

  await page.evaluate((id) => {
    const store = window.paperlike!.store;
    store.update(id, { interactions: [] });
    store.commit();
  }, button);
  await removeNodes(page, [section!]);
  void board;
});

test('an overlay draws a connection too, and says it is not a navigation', async ({ page }) => {
  const second = await makeNode(page, 'frame', {
    name: 'Overlay Target', x: 700, y: 0, w: 300, h: 200, fill: '#FFF7E6', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await select(page, [button]);
  await openTab(page);

  await page.evaluate(
    ([id, dest]) => {
      window.paperlike!.store.addInteraction(id, { action: 'open-overlay', destination: dest });
      window.paperlike!.store.commit();
    },
    [button, second] as const,
  );

  // it used to draw nothing at all: only `navigate` got a line, though Present
  // honours the overlay perfectly well
  const link = page.locator('g[data-connection="open-overlay"] path[marker-end]');
  await expect(link).toHaveCount(1);
  // dashed, because an overlay is a layer over where you are rather than a move
  await expect(link).toHaveAttribute('stroke-dasharray', '5 3');

  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [second]);
});

test('the presentation scales to the window, fills it, or shows it actual size', async ({ page }) => {
  // a frame far smaller than the window: fitting it used to be capped at 1:1,
  // so it sat in the middle of a large display as a small rectangle
  const small = await makeNode(page, 'frame', {
    name: 'Phone', x: 700, y: 0, w: 320, h: 240, fill: '#FFFFFF', flex: null,
  });
  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), small);

  const width = async () => (await page.locator('.fig-present-frame').boundingBox())!.width;
  const fit = await width();
  expect(fit).toBeGreaterThan(320);

  await page.keyboard.press('Shift+Digit0');
  expect(Math.round(await width())).toBe(320);

  await page.keyboard.press('Shift+Digit2');
  expect(await width()).toBeGreaterThan(fit);

  await page.keyboard.press('Shift+Digit1');
  expect(Math.round(await width())).toBe(Math.round(fit));

  // and the choice is on the bar as well as on the keys
  await expect(page.getByLabel('Scaling')).toHaveValue('fit');

  await page.keyboard.press('Escape');
  await removeNodes(page, [small]);
});
