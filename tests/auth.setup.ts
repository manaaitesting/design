import { test as setup, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const STATE = 'tests/.auth/state.json';

/**
 * Signs in once as the suite's own account and reuses the session everywhere.
 *
 * The seed runs first, when the database is here to run it against: it is what
 * guarantees the test account exists and its fixture files are on its
 * dashboard and out of its trash, whatever the last run — or the last person
 * — left them as. The account is nobody's but the suite's, so nothing here
 * touches a file a person is working in.
 */
setup('authenticate', async ({ page }) => {
  fs.mkdirSync('tests/.auth', { recursive: true });
  if (fs.existsSync('.data/paperlike.db')) execFileSync('node', ['scripts/seed.mjs'], { stdio: 'ignore' });

  await page.goto('/signin');
  await page.getByLabel('Email').fill('playwright@example.com');
  await page.getByLabel('Password').fill('paperlike-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/files/);

  // Written through a temp file and renamed into place, rather than handing the
  // path to `storageState`. That truncates and rewrites, so a second run
  // reading the file mid-write gets "Unexpected end of JSON input" and every
  // test in it fails before it starts — rare, but this repo really does get two
  // Playwright runs at once. A rename is atomic, so a reader sees the whole old
  // file or the whole new one.
  const state = await page.context().storageState();
  const temp = `${STATE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, STATE);
});
