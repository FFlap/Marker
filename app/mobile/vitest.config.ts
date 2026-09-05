import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['tests/convex/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
