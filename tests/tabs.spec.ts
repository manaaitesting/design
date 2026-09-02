import { expect, test, type Page } from '@playwright/test';

/**
 * The file tabs.
 *
 * These are navigation, which means the failures that matter are not visual:
 * closing the tab you are standing on has to land you somewhere real, a tab for
 * a file you cannot open must never appear, and coming back to a file has to
 * put you where you left it. So the suite drives the strip the way a person
 * does — clicks, crosses, keys — and asserts on the URL each time.
 */

const SCRATCH = 'testfile00';
const DEMO = 'demofile0';

const tab = (page: Page, name: string) =>
  page.locator('.fig-filetab[data-tab-id]', { hasText: name });
const tabs = (page: Page) => page.locator('.fig-filetab[data-tab-id]');

/**
 * Waits for the editor of a particular file to be the one on screen.
 *
 * Switching tabs is a client-side navigation, so `window.paperlike` is still
 * the file you *left* for as long as the new one is being fetched. Waiting on
 * the handle merely existing would let a test drive the outgoing document.
 */
const ready = (page: Page, file: string) =>
  page.waitForFunction((room) => window.paperlike?.room === room, file, { timeout: 20_000 });

/**
 * The strip persists per browser, so each test starts from an empty one.
 *
 * Cleared once, on the way in, rather than on every navigation — a hook that
 * ran on each page load would wipe the very tab the previous step had opened,
 * and the strip would look broken when it was the test that was.
 */
async function open(page: Page, file: string): Promise<void> {
  await page.goto('/files');
  await page.evaluate(() => {
    try {
      localStorage.removeItem('paperlike:tabs');
      localStorage.removeItem('paperlike:views');
    } catch {
      // a private window has no storage; the strip falls back to one tab
    }
  });
  await page.goto(`/f/${file}`);
  await ready(page, file);
}

test('a visited file joins the strip, and stays in it', async ({ page }) => {
  await open(page, SCRATCH);
  // the Dashboard tab is pinned, always first, and carries no cross
  const pinned = page.locator('.fig-filetab-pinned');
  await expect(pinned).toHaveText('Dashboard');
  await expect(pinned.locator('.fig-filetab-close')).toHaveCount(0);

  await expect(tabs(page)).toHaveCount(1);
  await expect(tab(page, 'Playwright Scratch')).toHaveAttribute('data-on', 'true');

  // arriving by URL rather than by tab still opens a tab — that is what makes
  // the strip a record of where you have been rather than of what you clicked
  await page.goto(`/f/${DEMO}`);
  await ready(page, DEMO);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tab(page, 'Vinyl Sundays')).toHaveAttribute('data-on', 'true');
  await expect(tab(page, 'Playwright Scratch')).toHaveAttribute('data-on', 'false');
});

test('clicking a tab switches file without losing the strip', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  await expect(tabs(page)).toHaveCount(2);

  await tab(page, 'Playwright Scratch').click();
  await expect(page).toHaveURL(new RegExp(`/f/${SCRATCH}$`));
  await expect(tab(page, 'Playwright Scratch')).toHaveAttribute('data-on', 'true');
  await expect(tabs(page)).toHaveCount(2);
});

test('the cross closes one tab and hands over to its neighbour', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  await expect(tabs(page)).toHaveCount(2);

  // close the one you are standing on: the other must take over, or you are
  // left looking at a document with no tab
  await tab(page, 'Vinyl Sundays').getByRole('button', { name: /^Close/ }).click();
  await expect(page).toHaveURL(new RegExp(`/f/${SCRATCH}$`));
  await expect(tabs(page)).toHaveCount(1);
  await expect(tab(page, 'Playwright Scratch')).toHaveAttribute('data-on', 'true');

  // and closing the last one goes back to the file browser rather than nowhere
  await tab(page, 'Playwright Scratch').getByRole('button', { name: /^Close/ }).click();
  await expect(page).toHaveURL(/\/files$/);
});

test('⌥⌘→ walks the strip instead of nudging a layer', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  // `ready` and not just the tab count: until the handle belongs to this file,
  // reading the document below samples the one we just left, and the node id it
  // picks up is then looked for in a file that never had it
  await ready(page, DEMO);
  await expect(tabs(page)).toHaveCount(2);

  // a selection makes the canvas's own Arrow binding live, which is exactly the
  // case the capture-phase listener exists for
  await page.evaluate(() => {
    const doc = window.paperlike!.doc();
    const first = Object.values(doc).find((node) => node.parent === 'root');
    if (first) window.paperlike!.ui.getState().select([first.id]);
  });
  const before = await page.evaluate(() => {
    const doc = window.paperlike!.doc();
    const id = window.paperlike!.ui.getState().selection[0] as string | undefined;
    return id ? { id, x: doc[id].x } : null;
  });

  await page.keyboard.press('Alt+Meta+ArrowRight');
  await expect(page).toHaveURL(new RegExp(`/f/${SCRATCH}$`));

  if (before) {
    await page.goto(`/f/${DEMO}`);
    await ready(page, DEMO);
    // Polled rather than read once. `ready` says the handle belongs to this
    // file, which is not the same as the file having arrived: the document is
    // filled in over the socket, so a single read here can land on an empty one
    // and report the layer missing rather than unmoved. The assertion is the
    // same — if the nudge had gone through, the value would settle on the wrong
    // number and this would still fail.
    await expect
      .poll(
        () => page.evaluate((id) => window.paperlike!.doc()[id]?.x ?? null, before.id),
        { message: 'switching tabs must not have moved the selected layer' },
      )
      .toBe(before.x);
  }

  // and it wraps, as ⌃⇥ does everywhere else
  await page.goto(`/f/${SCRATCH}`);
  await ready(page, SCRATCH);
  await page.keyboard.press('Alt+Meta+ArrowRight');
  await expect(page).toHaveURL(new RegExp(`/f/${DEMO}$`));
});

test('⇧⌘T puts back the tab you just closed', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  await ready(page, DEMO);
  await expect(tabs(page)).toHaveCount(2);

  await tab(page, 'Vinyl Sundays').getByRole('button', { name: /^Close/ }).click();
  await expect(tabs(page)).toHaveCount(1);

  await page.keyboard.press('Shift+Meta+KeyT');
  await expect(page).toHaveURL(new RegExp(`/f/${DEMO}$`));
  await expect(tabs(page)).toHaveCount(2);
});

test('the menu closes others, the rest, and all of them', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  await ready(page, DEMO);
  await expect(tabs(page)).toHaveCount(2);

  await tab(page, 'Vinyl Sundays').click({ button: 'right' });
  // Rename is the owner's to do, and both seeded files are Ada's
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Close others' }).click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/f/${DEMO}$`));

  await tab(page, 'Vinyl Sundays').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close all' }).click();
  await expect(page).toHaveURL(/\/files$/);
});

/**
 * The tab menu is the same menu as the canvas's.
 *
 * It used to be a second implementation drawn at raw pointer coordinates, so a
 * right-click near the right edge — where the tab you just opened lives — hung
 * its rows off the window, and Escape fell through to the canvas's own chain
 * and cleared the selection instead of closing it.
 */
test('the tab menu stays on screen at the edge, and Escape closes it and nothing else', async ({ page }) => {
  await open(page, DEMO);
  const picked = await page.evaluate(() => {
    const nodes = window.paperlike!.doc();
    const id = Object.keys(nodes).find((key) => nodes[key].parent) ?? null;
    if (id) window.paperlike!.ui.getState().select([id]);
    return id;
  });
  expect(picked).toBeTruthy();

  // narrow enough that the tab is inside a menu's width of the right edge,
  // which is where every tab ends up once a few files are open
  await page.setViewportSize({ width: 380, height: 800 });
  const strip = (await tab(page, 'Vinyl Sundays').boundingBox())!;
  await page.mouse.click(strip.x + strip.width - 4, strip.y + strip.height / 2, { button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(380);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // the canvas's own Escape chain used to run instead, and take the selection
  expect(await page.evaluate(() => window.paperlike!.ui.getState().selection)).toEqual([picked]);
});

test('⌘\\ takes the strip away with the rest of the chrome', async ({ page }) => {
  await open(page, SCRATCH);
  await expect(page.locator('.fig-topbar')).toBeVisible();

  await page.keyboard.press('Meta+Backslash');
  await expect(page.locator('.fig-topbar')).toHaveCount(0);

  await page.keyboard.press('Meta+Backslash');
  await expect(page.locator('.fig-topbar')).toBeVisible();
});

test('a file reopens where you left it', async ({ page }) => {
  await open(page, SCRATCH);
  await page.goto(`/f/${DEMO}`);
  await expect(tabs(page)).toHaveCount(2);

  await tab(page, 'Playwright Scratch').click();
  await ready(page, SCRATCH);
  await page.evaluate(() =>
    window.paperlike!.ui.getState().setViewport({ x: -321, y: -654, zoom: 1.75 }),
  );

  // the switch away is what writes the memory, so it has to be a tab click
  // rather than a reload — a hard navigation never runs the cleanup
  await tab(page, 'Vinyl Sundays').click();
  await ready(page, DEMO);

  await tab(page, 'Playwright Scratch').click();
  await ready(page, SCRATCH);
  await expect
    .poll(() => page.evaluate(() => window.paperlike!.ui.getState().viewport))
    .toEqual({ x: -321, y: -654, zoom: 1.75 });
});
