import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /COAT/).
export default defineConfig({
  base: './',
  // The bundled opening dataset (~1.2 MB raw, ~170 kB gzipped) is the bulk of the JS.
  build: { chunkSizeWarningLimit: 1600 },
});
