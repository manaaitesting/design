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

/**
 * The socket behind the session, reached through the development handle.
 *
 * Driving it directly is the only way to stand at the hour boundary without
 * waiting an hour for it: a token the sync server refuses is a token the sync
 * server refuses, whether it went stale or was never valid.
 */
type Sync = { params: { token: string }; wsconnected: boolean; connect(): void; disconnect(): void };

const DEAD_TOKEN = `nobody.${SCRATCH}.editor.1.notasignature`;

const socket = (page: Page) =>
  page.evaluate(() => {
    const sync = (window.paperlike as unknown as { provider: Sync }).provider;
    return { connected: sync.wsconnected, token: sync.params.token };
  });

/** Reconnects carrying a credential the sync server will close 4401 on. */
async function reconnectWithADeadToken(page: Page): Promise<void> {
  await page.evaluate((dead) => {
    const sync = (window.paperlike as unknown as { provider: Sync }).provider;
    sync.disconnect();
    sync.params.token = dead;
    sync.connect();
  }, DEAD_TOKEN);
}

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

test('signing in at the wall opens the file that sent you there', async ({ page, browser }) => {
  await setLink(page, '');

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visit = await stranger.newPage();
    await visit.goto(`/f/${SCRATCH}`);
    await expect(visit).toHaveURL(new RegExp(`/signin\\?next=%2Ff%2F${SCRATCH}$`));
    // the page says why it appeared, rather than the generic welcome
    await expect(visit.getByText('Sign in to open this file.')).toBeVisible();
    // and the commonest case — a link sent to someone with no account yet —
    // keeps the file across the hop to sign-up
    await expect(visit.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/signup?next=%2Ff%2F${SCRATCH}`,
    );

    await visit.getByLabel('Email').fill('ada@example.com');
    await visit.getByLabel('Password').fill('paperlike-demo');
    await visit.getByRole('button', { name: 'Sign in' }).click();

    await expect(visit).toHaveURL(new RegExp(`/f/${SCRATCH}$`));
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

test('a session the sync server refuses mints a fresh token instead of retrying the dead one', async ({
  page,
}) => {
  await page.goto(`/f/${SCRATCH}`);
  await page.waitForFunction((room) => window.paperlike?.room === room, SCRATCH, {
    timeout: 20_000,
  });

  await reconnectWithADeadToken(page);

  // 4401 is terminal to y-websocket, so without a renewal this tab is offline
  // for good — and says nothing about it
  await expect.poll(async () => (await socket(page)).connected, { timeout: 20_000 }).toBe(true);
  expect((await socket(page)).token).not.toBe(DEAD_TOKEN);
  await expect(page.getByText('Your session has expired')).toHaveCount(0);
});

test('a session whose access has gone says so rather than reconnecting into a file it cannot have', async ({
  page,
  browser,
}) => {
  await setLink(page, 'editor');

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visit = await stranger.newPage();
    await visit.goto(`/f/${SCRATCH}`);
    await visit.waitForFunction((room) => window.paperlike?.room === room, SCRATCH, {
      timeout: 20_000,
    });

    // the owner takes the link back while the tab is still open
    await setLink(page, '');
    await reconnectWithADeadToken(visit);

    await expect(visit.getByText('Your session has expired')).toBeVisible();
    expect((await socket(visit)).connected).toBe(false);
  } finally {
    await stranger.close();
  }
});
