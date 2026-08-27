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
  await page.context().storageState({ path: STATE });
});
