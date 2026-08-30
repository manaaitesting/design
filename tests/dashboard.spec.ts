import { expect, test, type Page } from '@playwright/test';

/**
 * The dashboard: search, sort and folders.
 *
 * The failure this guards against is not a broken button — it is a file list
 * that becomes unusable somewhere around forty files, which nothing notices
 * until it has already happened. So the tests are about *finding* a file: by
 * name, by folder, and by putting it somewhere and looking there.
 */

/** The card for one file. */
function card(page: Page, name: string) {
  return page
    .locator('div', { has: page.getByLabel('File name').and(page.locator(`[value="${name}"]`)) })
    .last();
}

/**
 * The file names on screen.
 *
 * By label rather than by `name`, because the new-folder field answers to that
 * too — counting it would make an empty result look like one file.
 */
const names = (page: Page) => page.getByLabel('File name');

test.beforeEach(async ({ page }) => {
  await page.goto('/files');
});

/**
 * Folders are real rows, so a run that fails halfway leaves one behind and the
 * next person to open the dashboard finds it. Sweeping here rather than at the
 * end of the test is what makes that true even when the test does not finish.
 */
test.afterEach(async ({ page }) => {
  await page.goto('/files');
  for (;;) {
    const chip = page.getByRole('link', { name: /^Test folder / }).first();
    if (!(await chip.count())) break;
    await chip.click();
    await page.getByRole('button', { name: 'Delete folder' }).click();
    await expect(page).toHaveURL(/\/files$/);
  }
});

test('search narrows the list, and the URL says so', async ({ page }) => {
  const all = await names(page).count();
  expect(all).toBeGreaterThan(1);

  await page.getByLabel('Search files').fill('Vinyl');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL(/\?q=Vinyl/);
  await expect(names(page)).toHaveCount(1);
  await expect(names(page).first()).toHaveValue('Vinyl Sundays');
  // the count says what it is showing, and out of how many
  await expect(page.getByText(`1 file of ${all}`)).toBeVisible();
});

test('a search that matches nothing offers the way back', async ({ page }) => {
  await page.getByLabel('Search files').fill('zzzz-no-such-file');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Nothing here')).toBeVisible();
  await page.getByRole('link', { name: /Clear the search/ }).click();
  await expect(page).toHaveURL(/\/files$/);
});

test('sorting by name actually reorders', async ({ page }) => {
  await page.getByLabel('Sort files').selectOption('name');
  await page.getByRole('button', { name: 'Search' }).click();

  const listed = await names(page).evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  expect(listed).toEqual([...listed].sort((a, b) => a.localeCompare(b)));
});

test('the new-file button says it is working while the file is being made', async ({ page }) => {
  // New file writes a row and then navigates into the editor, which is long
  // enough to click through twice and get two files. Never answering the
  // action is how the test gets to stand in the moment in between.
  await page.route('**/files', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise(() => {});
  });

  await page.getByRole('button', { name: 'New file' }).click();
  await expect(page.getByRole('button', { name: 'Working…' })).toBeDisabled();
});

test('a file filed into a folder is found there and nowhere else', async ({ page }) => {
  const folder = `Test folder ${Date.now()}`;
  await page.getByLabel('New folder name').fill(folder);
  await page.getByRole('button', { name: 'Create the folder' }).click();
  await expect(page.getByRole('link', { name: new RegExp(folder) })).toBeVisible();

  await card(page, 'Playwright Scratch').getByLabel('Folder').selectOption({ label: folder });
  await expect
    .poll(async () => {
      await page.reload();
      return card(page, 'Playwright Scratch').getByLabel('Folder').inputValue();
    })
    .not.toBe('');

  // inside the folder: exactly the one file
  await page.getByRole('link', { name: new RegExp(folder) }).click();
  await expect(names(page)).toHaveCount(1);
  await expect(names(page).first()).toHaveValue('Playwright Scratch');

  // deleting the folder must not delete what was in it
  await page.getByRole('button', { name: 'Delete folder' }).click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.getByRole('link', { name: new RegExp(folder) })).toHaveCount(0);
  await expect(card(page, 'Playwright Scratch')).toBeVisible();
});
