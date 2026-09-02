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
  // A sync server binds a fixed port, so this one cannot come up beside the one
  // `pnpm dev` is already running. SKIP_WEB_SERVER=1 runs the projects that
  // need no browser against whatever is already up.
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        // dev, not start: the tests drive `window.paperlike`, which only exists
        // in development, and `pnpm dev` brings up the sync server alongside Next.
        command: 'concurrently -n web,sync -c cyan,magenta "next dev -p 3111" "pnpm dev:sync"',
        url: 'http://localhost:3111/signin',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    // no browser, no dev server: pure functions, checked directly
    { name: 'geometry', testMatch: /geometry\.spec\.ts/ },
    // the exporters, likewise — they are functions from a document to a string
    { name: 'export', testMatch: /export\.spec\.ts/ },
    // the timeline's model and its compiler: a document in, a stylesheet out
    { name: 'motion', testMatch: /motion\.spec\.ts/ },
    // no browser either: the shared library, against a scratch database
    { name: 'library', testMatch: /library\.spec\.ts/ },
    // no browser either: this one drives the sync server
    { name: 'sync', testMatch: /snapshots\.spec\.ts/ },
    // no browser to drive, but it spawns one: the MCP server renders headlessly
    { name: 'mcp', testMatch: /mcp\.spec\.ts/ },
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'editor',
      testMatch: /(editor|features|variables|motion-ui|tabs|share|dashboard|shaders|file-menu)\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 950 },
        storageState: 'tests/.auth/state.json',
      },
    },
  ],
});
