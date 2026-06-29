import type { StorybookConfig } from '@storybook/nextjs-vite';

// MDS component catalog. Vite-based framework (Storybook runs its own Vite,
// independent of the app's Turbopack). Tailwind v4 is processed via the
// project's postcss.config.mjs, which Vite auto-loads when globals.css is
// imported in preview.ts.
const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
};

export default config;
