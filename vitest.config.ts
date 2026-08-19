import { defineConfig } from 'vitest/config'
import path from 'path'
import react from '@vitejs/plugin-react'

// Kept separate from vite.config.ts so the Figma/Tailwind build plugins do not
// load under the test runner. jsdom gives components a DOM; setup.ts wires up
// jest-dom matchers.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/app/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    },
  },
})
