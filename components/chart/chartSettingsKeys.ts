/**
 * Keyboard shortcut descriptors for the chart settings popover.
 *
 * Kept in one place so the menu rows, the chart-level keydown handler, and
 * the tests can all reference the same canonical binding.
 */

export interface ChartSettingsShortcut {
  key: string;
  alt: boolean;
  label: string;
}

export const CHART_SETTINGS_SHORTCUTS: Record<
  'reset' | 'invert' | 'cycleMode' | 'log',
  ChartSettingsShortcut
> = {
  reset: { key: 'r', alt: true, label: 'Alt+R' },
  invert: { key: 'i', alt: true, label: 'Alt+I' },
  cycleMode: { key: 'p', alt: true, label: 'Alt+P' },
  log: { key: 'l', alt: true, label: 'Alt+L' },
};
