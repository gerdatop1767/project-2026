/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { seoPrerender } from './seo/prerender';

export default defineConfig({
  plugins: [react(), seoPrerender()],
  resolve: {
    // Resolve workspace packages to their TypeScript source.
    conditions: ['@zybrilka/source', ...defaultClientConditions],
  },
  server: {
    // Same-origin API in development, mirroring production (/api → api service).
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    target: ['es2022', 'safari15'],
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
