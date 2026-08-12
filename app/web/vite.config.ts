import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tanstack')) return 'router';
          if (id.includes('convex')) return 'convex';
          if (id.includes('@radix-ui')) return 'ui';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    css: true,
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
});
