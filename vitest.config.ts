import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Browser tests need the built UI; they run with `npm run test:e2e`.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
