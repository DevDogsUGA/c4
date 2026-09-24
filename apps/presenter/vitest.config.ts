import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.ts: none of the tested modules
// (records/show/standings/bracket/replay) touch React or Tailwind, and
// loading vite.config.ts's plugins here pulls in @vitejs/plugin-react,
// which the currently-installed vite@5.4.21 can't satisfy (it needs
// vite@^8 per its package.json peerDependency) -- see the presenter
// rewrite report for details.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
