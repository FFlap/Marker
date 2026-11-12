import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    maxWorkers: 1,
    include: ['tests/benchmarks/**/*.bench.ts'],
    testTimeout: 120_000,
  },
});
