import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';
// Tokens + base styles (OKLCH tiers, .elev-*, .num tabular numerals). The
// `html, body { background: var(--base) }` rule makes the preview dark by
// default — matching the app, which has no theme class (dark is :root).
import '../app/globals.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // a11y panel surfaces axe findings live; 'todo' reports without failing.
    a11y: { test: 'todo' },
  },
  // Every story sits on the app surface with ink text + breathing room.
  decorators: [
    (Story) => (
      <div className="text-ink" style={{ padding: 24, minWidth: 320, maxWidth: 760 }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
