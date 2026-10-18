import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Names this build, so a browser left open from an older one can tell and reload. The server reads it from dist. */
const BUILD_ID = process.env.RENDER_GIT_COMMIT || Date.now().toString(36);

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    { name: 'build-id', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: BUILD_ID }); } },
  ],
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev') },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
    },
  },
  // The unit data is its own lazily loaded chunk of about 600 kB.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
