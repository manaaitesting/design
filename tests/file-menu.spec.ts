import { expect, test, type Page } from '@playwright/test';
import { makeNode, nodeNamed, openEditor } from './helpers';

/**
 * The file menu — the caret beside the file name in the left panel.
 *
 * What matters here is not that a menu opens but that its rows do what they
 * say to the file *row*: a rename shows up in the header, starring changes the
 * row's label, and a restored version puts a deleted layer back. Each test
 * puts back what it changed, because the scratch file is shared.
 */

const NAME = 'Playwright Scratch';

const head = (page: Page) => page.locator('.fig-file-head');
const menu = (page: Page) => page.getByRole('menu');

async function openMenu(page: Page): Promise<void> {
  await head(page).getByRole('button', { name: 'File menu' }).click();
  await expect(menu(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the header shows the file, its folder, and the sidebar toggle', async ({ page }) => {
  await expect(head(page).locator('.fig-file-name')).toHaveText(NAME);
  // the scratch file lives in no folder, which Figma calls Drafts
  await expect(head(page).locator('.fig-file-project')).toHaveText('Drafts');
  await head(page).getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(head(page)).toHaveCount(0);
  // the collapsed island carries the same menu
  await page.getByRole('button', { name: 'File menu' }).click();
  await expect(menu(page).getByRole('menuitem', { name: 'Show version history' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Expand UI/ }).click();
  await expect(head(page)).toBeVisible();
});

test('the menu has Figma’s rows, in Figma’s order', async ({ page }) => {
  await openMenu(page);
  const labels = await menu(page).getByRole('menuitem').allTextContents();
  // a row's text carries its shortcut, or the submenu arrow, after the label
  expect(labels.map((label) => label.replace(/(⇧⌘E|›)$/, '').trim())).toEqual([
    'Show version history',
    'Publish library...',
    'Export...',
    'Copy link to current page',
    'Add to sidebar',
    'Create branch...',
    'File color profile',
    'Duplicate',
    'Rename',
    'Move file...',
    'Move to trash',
  ]);
  // nothing to publish on an empty page, and no branches here at all
  await expect(menu(page).getByRole('menuitem', { name: 'Publish library...' })).toBeDisabled();
  await expect(menu(page).getByRole('menuitem', { name: 'Create branch...' })).toBeDisabled();
  // Escape closes it, as it does every menu
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
});

test('Export... opens the export dialog', async ({ page }) => {
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Export...' }).click();
  await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();
  await expect(await page.evaluate(() => window.paperlike!.ui.getState().exportOpen)).toBe(true);
  await page.keyboard.press('Escape');
});

test('the colour profile is a checked choice, stored on the file', async ({ page }) => {
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'File color profile' }).hover();
  const p3 = page.getByRole('menuitem', { name: 'Display P3' });
  await expect(p3).toBeVisible();
  await p3.click();
  await expect(page.locator('.fig-shell')).toHaveAttribute('data-color-profile', 'p3');
  // and it is what the submenu now reports
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'File color profile' }).hover();
  await expect(page.getByRole('menuitem', { name: 'Display P3' }).locator('.ctx-check')).toHaveText('✓');
  await page.getByRole('menuitem', { name: 'sRGB' }).click();
  await expect(page.locator('.fig-shell')).toHaveAttribute('data-color-profile', 'srgb');
});

test('Add to sidebar stars the file, and the row says so', async ({ page }) => {
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Add to sidebar' }).click();
  await openMenu(page);
  await expect(menu(page).getByRole('menuitem', { name: 'Remove from sidebar' })).toBeVisible();
  await menu(page).getByRole('menuitem', { name: 'Remove from sidebar' }).click();
  await openMenu(page);
  await expect(menu(page).getByRole('menuitem', { name: 'Add to sidebar' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Rename edits the name in place', async ({ page }) => {
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
  const field = head(page).getByLabel('File name');
  await expect(field).toBeFocused();
  await field.fill(`${NAME} renamed`);
  await field.press('Enter');
  await expect(head(page).locator('.fig-file-name')).toHaveText(`${NAME} renamed`);

  // and back, so the next test finds the file it expects
  await head(page).locator('.fig-file-name').dblclick();
  await head(page).getByLabel('File name').fill(NAME);
  await head(page).getByLabel('File name').press('Enter');
  await expect(head(page).locator('.fig-file-name')).toHaveText(NAME);
});

test('Move file... offers Drafts and the folders, and Move to trash asks first', async ({ page }) => {
  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Move file...' }).click();
  const move = page.getByRole('dialog', { name: 'Move file' });
  await expect(move).toBeVisible();
  await expect(move.getByRole('radio', { name: /Drafts/ })).toHaveAttribute('aria-checked', 'true');
  // nothing changed, so there is nothing to move
  await expect(move.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
  await move.getByRole('button', { name: 'Cancel' }).click();
  await expect(move).toHaveCount(0);

  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Move to trash' }).click();
  const trash = page.getByRole('dialog', { name: 'Move to trash' });
  await expect(trash).toBeVisible();
  await expect(trash.getByText(NAME)).toBeVisible();
  await trash.getByRole('button', { name: 'Cancel' }).click();
  await expect(trash).toHaveCount(0);
  // still here
  await expect(page).toHaveURL(/\/f\/testfile00/);
});

test('version history saves a named version and restores it', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'Keepsake', x: 40, y: 40, w: 80, h: 80 });
  expect(id).toBeTruthy();
  const label = `pw ${Date.now()}`;

  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Show version history' }).click();
  const sheet = page.getByRole('dialog', { name: 'Version history' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Version name').fill(label);
  await sheet.getByRole('button', { name: 'Save version' }).click();
  const row = sheet.getByRole('listitem').filter({ hasText: label });
  await expect(row).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();

  // lose the layer, then ask for it back
  await page.evaluate((nodeId) => window.paperlike!.store.remove([nodeId]), id);
  expect(await nodeNamed(page, 'Keepsake')).toBeUndefined();

  await openMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Show version history' }).click();
  await sheet.getByRole('listitem').filter({ hasText: label }).getByRole('button', { name: 'Restore' }).click();
  // the fixture's artboard comes back too, so the count is "everything on the page"
  await expect(sheet.getByRole('status')).toContainText(/Restored \d+ top-level layers?/);
  const back = await nodeNamed(page, 'Keepsake');
  expect(back).toBeTruthy();
  expect(back?.x).toBe(40);
  expect(back?.y).toBe(40);
  await sheet.getByRole('button', { name: 'Close' }).click();
});
