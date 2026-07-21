import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-access-secret-for-vitest-only-0001',
      JWT_REFRESH_SECRET: 'test-refresh-secret-for-vitest-only-0002',
    },
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      thresholds: {
        lines: 16,
        functions: 9,
        branches: 7,
        statements: 15,
      },
    },
  },
});
