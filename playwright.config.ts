import { defineConfig, devices } from '@playwright/test';

/**
 * These tests exist because everything in this app was verified by hand, and
 * hand-verification does not survive the next change. They drive the real
 * canvas — pointer sequences, not unit-tested internals — because the bugs that
 * actually bit here (a hug-sized leaf collapsing to 0×0, snapping fighting the
 * duplicate modifier) only show up end to end.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // one shared document, so tests must not race each other
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3111',
    trace: 'retain-on-failure',
  },
  webServer: {
    // dev, not start: the tests drive `window.paperlike`, which only exists in
    // development, and `pnpm dev` brings up the sync server alongside Next.
    command: 'concurrently -n web,sync -c cyan,magenta "next dev -p 3111" "pnpm dev:sync"',
    url: 'http://localhost:3111/signin',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    // no browser, no dev server: this one drives the sync server directly
    { name: 'sync', testMatch: /snapshots\.spec\.ts/ },
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'editor',
      testMatch: /editor\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 950 },
        storageState: 'tests/.auth/state.json',
      },
    },
  ],
});
