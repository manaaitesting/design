/**
 * Dev Mode: the handoff panel, and the flag that is supposed to reach it.
 *
 * "Ready for dev" was a leaf flag with no reach — it could only be set on the
 * selected layer, its canvas badge was drawn only for layers the overlay was
 * already measuring for some other reason, and nothing anywhere listed it. A
 * flag nobody can find does not answer the question it exists to answer.
 */
import { expect, test } from '@playwright/test';
import { doc, makeNode, openEditor, removeNodes, select, selection } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('a layer marked ready wears its badge without being selected, and is listed', async ({ page }) => {
  const id = await makeNode(page, 'frame', {
    name: 'Handoff Board', x: 700, y: 400, w: 200, h: 140, fill: '#FFFFFF', flex: null,
  });
  await select(page, [id]);
  await page.evaluate(() => window.paperlike!.ui.getState().setInspectorTab('inspect'));
  await page.getByTitle('Ready for development').click();

  const badge = page.locator('.fig-status[data-status="ready"]');
  await expect(badge).toBeVisible();

  // the point of a flag is that it is there when you are looking at something
  // else — it used to disappear the moment the layer was deselected
  await select(page, []);
  await expect(badge).toBeVisible();

  // and Dev Mode lists it, which is how a developer finds work without being
  // told which frame to open
  const row = page.locator(`[data-ready="${id}"]`);
  await expect(row).toHaveText('Handoff Board');
  await row.click();
  expect(await selection(page)).toEqual([id]);

  await removeNodes(page, [id]);
});

test('the right-click menu marks a layer ready, and unmarks it', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'Marked', x: 700, y: 600, w: 80, h: 80, fill: '#4CC3F0' });
  await select(page, [id]);

  const open = async () => {
    await page.locator(`[data-node-id="${id}"]`).click({ button: 'right' });
    return page.locator('.ctx');
  };
  await (await open()).getByRole('menuitem', { name: 'Mark as ready for dev' }).click();
  expect((await doc(page))[id].devStatus).toBe('ready');

  // the row says which way it will go, as the rest of this menu does
  await (await open()).getByRole('menuitem', { name: 'Mark as draft' }).click();
  expect((await doc(page))[id].devStatus).toBe('none');

  await removeNodes(page, [id]);
});

test('Dev Mode measures a flowed layer rather than reading coordinates it does not have', async ({ page }) => {
  const frame = await makeNode(page, 'frame', {
    name: 'Flow Parent', x: 700, y: 300, w: 300, h: 120, fill: '#FFFFFF', flex: null,
  });
  const [first, second] = await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    const a = store.create('rect', parent, { name: 'Flow A', x: 0, y: 0, w: 60, h: 60, fill: '#4CC3F0' });
    const b = store.create('rect', parent, { name: 'Flow B', x: 0, y: 0, w: 60, h: 60, fill: '#F2637F' });
    store.update(parent, {
      flex: {
        mode: 'flex',
        direction: 'row',
        wrap: false,
        gap: 20,
        padding: [10, 10, 10, 10],
        align: 'start',
        justify: 'start',
      },
    } as never);
    store.commit();
    return [a, b];
  }, frame);

  await select(page, [second]);
  await page.evaluate(() => window.paperlike!.ui.getState().setInspectorTab('inspect'));

  // the second child sits past the first and the gap; its stored x is 0, which
  // is the number this panel used to print
  const stored = (await doc(page))[second].x;
  expect(stored).toBe(0);
  const spacing = await page.locator('.fig-inspect-grid span', { hasText: '↑' }).first().innerText();
  expect(spacing).toMatch(/← 90/);

  // and the first child, which the flow puts at the padding, reads as such
  await select(page, [first]);
  expect(await page.locator('.fig-inspect-grid span', { hasText: '↑' }).first().innerText()).toMatch(/← 10/);

  await removeNodes(page, [frame]);
});
