import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const STATE = 'tests/.auth/state.json';

/** Signs in once with the seeded account and reuses the session everywhere. */
setup('authenticate', async ({ page }) => {
  fs.mkdirSync('tests/.auth', { recursive: true });

  await page.goto('/signin');
  await page.getByLabel('Email').fill('ada@example.com');
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
