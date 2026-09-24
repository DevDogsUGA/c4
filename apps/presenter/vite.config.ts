import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Serve the dev fixture set at the site root so `?dir=/` loads a full
// tournament without the file picker — e.g. http://localhost:5173/?dir=/
// (manifest.json, summary.json and the match records come from fixtures/).
// At the event, the real match-engine output directory is loaded the same
// way (copy it into fixtures/, or use the folder picker).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: 'fixtures',
});
