import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      thresholds: {
        lines: 20,
        functions: 10,
        branches: 40,
        statements: 20,
      },
    },
  },
});
