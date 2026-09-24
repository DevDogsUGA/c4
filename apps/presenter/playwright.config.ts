import { defineConfig, devices } from '@playwright/test';

// A dedicated port, distinct from vite's dev default (5173) so this suite
// doesn't collide with a `pnpm dev` already running. Deliberately NOT
// picked dynamically (e.g. by binding port 0): playwright.config.ts is
// loaded independently by the main process and by each worker process, so
// a value computed at module-load time (e.g. an OS-assigned free port)
// would disagree between the webServer's process and the test's baseURL.
const port = 5183;
const baseURL = `http://127.0.0.1:${port}`;

// Smoke-tests the presenter as a real host would run it: a chromium-only
// end-to-end pass that drives the rehearsal tournament fixture
// (`fixtures/`, served at `?dir=/` because vite's publicDir points there)
// from the first slide to the last, via the same keyboard input a host
// uses. See e2e/show.spec.ts for the driving logic.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
