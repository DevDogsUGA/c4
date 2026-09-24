import { defineWorkspace } from 'vitest/config';

// Two projects: the Worker code runs under @cloudflare/vitest-pool-workers
// (real D1/miniflare), and the Apps Script code runs under plain Node with
// shimmed GAS globals. `vitest run` from apps/registry picks both up.
export default defineWorkspace(['./vitest.config.ts', './apps-script/vitest.config.ts']);
