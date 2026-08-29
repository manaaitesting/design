import { expect, test, type Page } from '@playwright/test';

/**
 * Sharing by link.
 *
 * Inviting by email cannot reach someone without an account, which is most of
 * the people a design needs to be seen by. So the test that matters is the one
 * a unit test cannot do: open the file in a browser that has never signed in,
 * and check both directions — that the link lets them in when it is on, and
 * that it does not when it is off. The second half is the one worth having.
 */

const SCRATCH = 'testfile00';

/** The card for one file on the dashboard. */
function card(page: Page, name: string) {
  return page.locator('div', { has: page.locator(`input[value="${name}"]`) }).last();
}

async function setLink(page: Page, value: string): Promise<void> {
  await page.goto('/files');
  const open = async () => {
    const scope = card(page, 'Playwright Scratch');
    const share = scope.getByRole('button', { name: 'Share' });
    if (await share.isVisible()) await share.click();
    return scope.getByLabel('Who can open the link');
  };
  await (await open()).selectOption(value);

  // Reload before believing it. The select is controlled, so it shows the value
  // the moment it is clicked whether or not the server has heard — and a test
  // that trusts that would go on to open the file under the *old* sharing.
  await page.reload();
  await expect(await open()).toHaveValue(value);
}

test.afterEach(async ({ page }) => {
  // a file left publicly readable would leak into every test after this one
  await setLink(page, '');
});

test('a link visitor with no account can open a view-shared file', async ({ page, browser }) => {
  await setLink(page, 'viewer');

  // a context with no cookies at all — not signed in, never has been
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visit = await stranger.newPage();
    await visit.goto(`/f/${SCRATCH}`);

    // they are on the canvas, not on the sign-in page
    await expect(visit).toHaveURL(new RegExp(`/f/${SCRATCH}$`));
    await expect(visit.locator('[data-canvas-root]')).toBeVisible();
    // and they can see that they may look but not touch
    await expect(visit.getByText('View only')).toBeVisible();
  } finally {
    await stranger.close();
  }
});

test('the same link is a sign-in wall when link sharing is off', async ({ page, browser }) => {
  await setLink(page, '');

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visit = await stranger.newPage();
    await visit.goto(`/f/${SCRATCH}`);
    // knowing the room id is not authorisation
    await expect(visit).toHaveURL(/\/signin/);
    await expect(visit.locator('[data-canvas-root]')).toHaveCount(0);
  } finally {
    await stranger.close();
  }
});

test('an edit link gives a stranger the tools, a view link does not', async ({ page, browser }) => {
  await setLink(page, 'editor');

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visit = await stranger.newPage();
    await visit.goto(`/f/${SCRATCH}`);
    await visit.waitForFunction((room) => window.paperlike?.room === room, SCRATCH, {
      timeout: 20_000,
    });
    // the session exists before the document arrives, and a write into a
    // document that has not synced yet lands nowhere
    await visit.waitForFunction(() => !!window.paperlike!.doc().root);

    await expect(visit.getByText('View only')).toHaveCount(0);
    // the tool rail is the editor's; a viewer never sees it
    await expect(visit.locator('.fig-rail')).toBeVisible();

    // and the write actually lands, which is the sync server's half of the
    // check — the role is inside the signature it verifies
    const id = await visit.evaluate(() =>
      window.paperlike!.store.create('rect', 'root', { name: 'By a stranger', w: 10, h: 10 }),
    );
    await expect
      .poll(() => visit.evaluate((node) => !!window.paperlike!.doc()[node], id))
      .toBe(true);
    await visit.evaluate((node) => window.paperlike!.store.remove([node]), id);
  } finally {
    await stranger.close();
  }
});

test('a membership outranks a stingier link', async ({ page }) => {
  // Ada owns the scratch file. A view-only link must not demote its owner.
  await setLink(page, 'viewer');
  await page.goto(`/f/${SCRATCH}`);
  await page.waitForFunction((room) => window.paperlike?.room === room, SCRATCH, {
    timeout: 20_000,
  });
  await expect(page.getByText('View only')).toHaveCount(0);
});
