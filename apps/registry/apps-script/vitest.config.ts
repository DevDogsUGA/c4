import { defineConfig } from 'vitest/config';

// Plain Node project: Code.gs is loaded and evaluated as text (it's not a
// module Node can `require()` by extension), with small shims standing in
// for Apps Script's Utilities/FormApp/etc. globals. No Workers runtime
// needed here — see ../vitest.config.ts for the Worker-side tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
