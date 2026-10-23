import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    // Bound CPU-heavy Convex emulation so large-batch tests keep reliable deadlines.
    maxWorkers: 2,
    include: ['tests/convex/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
