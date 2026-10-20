import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI is served by the Archflow service in production. In development,
// `npm run dev` starts the service on ARCHFLOW_PORT (default 4870) and this
// dev server, which proxies API calls to it.
const servicePort = process.env.ARCHFLOW_PORT ?? '4870';
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
    // Only "/api/..." goes to the service: a bare "/api" prefix would also catch
    // the UI's own module "/api.ts".
    proxy: { '/api/': `http://127.0.0.1:${servicePort}` },
  },
});
