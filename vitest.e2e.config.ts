import { defineConfig } from 'vitest/config';

// Browser tests against the built application (run `npm run build` first).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
