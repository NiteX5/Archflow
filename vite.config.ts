import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI is served by the Archflow service in production. In development,
// `npm run dev:web` proxies the API to a service started with `archflow serve`.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Local tool served from disk: one bundle is fine.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4870' },
  },
});
