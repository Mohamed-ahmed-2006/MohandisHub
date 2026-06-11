import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
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
