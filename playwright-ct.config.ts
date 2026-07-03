import { defineConfig, devices } from '@playwright/experimental-ct-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';

/**
 * Playwright Component Testing config for the Chart module.
 * Mounts <Chart> in isolation with mock props — no dev server or Binance.
 *
 * Uses @tailwindcss/vite (not @tailwindcss/postcss) because the Playwright
 * CT bundled Vite is incompatible with the PostCSS plugin's load hook.
 */
export default defineConfig({
  testDir: './components/chart',
  outputDir: './test-results/ct',
  fullyParallel: false,
  retries: 0,
  use: {
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
    ctViteConfig: {
      plugins: [tailwindcss() as any],
      css: {
        // Suppress the project's postcss.config.mjs (the @tailwindcss/postcss
        // plugin conflicts with the bundled Vite). The Vite plugin handles it.
        postcss: {},
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
      },
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
