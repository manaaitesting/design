/**
 * The left panel: the pages list, and what a drag inside the layers tree can
 * reach.
 */
import { expect, test } from '@playwright/test';
import { doc, makeNode, openEditor, removeNodes, select } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const addPage = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((label) => {
    const id = window.paperlike!.store.addPage(label);
    window.paperlike!.store.commit();
    return id;
  }, name);

const pageOrder = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-page-id]')).map(
      (el) => el.textContent ?? '',
    ),
  );

test('the pages magnifier filters the list, and Escape puts it back', async ({ page }) => {
  // the suite shares one document, so the list starts at whatever earlier tests
  // left in it — what matters is what the filter does to that number
  const alpha = await addPage(page, 'PanelHandoff');
  const beta = await addPage(page, 'PanelExplorations');
  const all = await page.locator('[data-page-id]').count();

  await page.getByTitle('Search pages').click();

  const field = page.getByRole('textbox', { name: 'Search pages' });
  await field.fill('panelhand');
  await expect(page.locator('[data-page-id]')).toHaveCount(1);
  await expect(page.locator(`[data-page-id="${alpha}"]`)).toBeVisible();

  // and a name that is nobody's shows an empty list rather than everything
  await field.fill('zzz');
  await expect(page.locator('[data-page-id]')).toHaveCount(0);

  await field.press('Escape');
  await expect(page.locator('[data-page-id]')).toHaveCount(all);

  await page.evaluate(
    ([a, b]) => {
      window.paperlike!.store.removePage(a);
      window.paperlike!.store.removePage(b);
      window.paperlike!.store.commit();
    },
    [alpha, beta] as const,
  );
});

test('a page can be dragged to another place in the list', async ({ page }) => {
  // The list is a fixed-height scroller, so the two rows a drag is tested with
  // have to be the two at the top — the ones that are always in view.
  const rows = page.locator('[data-page-id]');
  const before = await pageOrder(page);
  expect(before.length).toBeGreaterThan(1);

  const first = (await rows.nth(0).boundingBox())!;
  const second = (await rows.nth(1).boundingBox())!;

  await page.mouse.move(first.x + 40, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + 40, second.y + second.height - 2, { steps: 10 });
  // the line says where it will land before the release does it
  await expect(rows.nth(1)).toHaveAttribute('data-drop', 'below');
  await page.mouse.up();

  const after = await pageOrder(page);
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);

  // and back, so the shared document is left as it was found
  const back = (await rows.nth(1).boundingBox())!;
  const top = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(back.x + 40, back.y + back.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 40, top.y + 2, { steps: 10 });
  await page.mouse.up();
  expect(await pageOrder(page)).toEqual(before);
});

test('a layer dragged to the edge scrolls the list under it', async ({ page }) => {
  // enough rows that the list is a scroller: a drop target that was off-screen
  // when the press started used to be unreachable, because you cannot scroll
  // with the pointer already down
  const made = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const page1 = window.paperlike!.ui.getState().page;
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push(store.create('rect', page1, { name: `Scroller ${i}`, x: 20, y: 20 + i * 4, w: 20, h: 20 } as never));
    }
    store.commit();
    return ids;
  });

  const list = page.locator('[data-layers-list]');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-layers-list]')!.scrollTop = 9999;
  });
  const parked = await list.evaluate((el) => el.scrollTop);
  expect(parked).toBeGreaterThan(0);

  // not the very last row: Next's dev overlay sits in the bottom-left corner
  // and would take the press instead of the panel
  const listBox = (await list.boundingBox())!;
  const rows = page.locator('[data-layer-id]');
  const count = await rows.count();
  let row = rows.nth(count - 1);
  for (let i = count - 1; i >= 0; i--) {
    const candidate = rows.nth(i);
    const at = await candidate.boundingBox();
    if (at && at.y + at.height < listBox.y + listBox.height - 90) {
      row = candidate;
      break;
    }
  }
  const box = (await row.boundingBox())!;

  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  // held just inside the top edge, the list walks itself up under the pointer
  await page.mouse.move(box.x + 40, listBox.y + 8, { steps: 6 });
  await expect
    .poll(async () => list.evaluate((el) => el.scrollTop), { timeout: 4000 })
    .toBeLessThan(parked);
  await page.mouse.up();

  await removeNodes(page, made);
});
