// @vitest-environment happy-dom
//
// Structural tests for the ChartSettingsPopover. The existing test
// convention in this repo is `renderToStaticMarkup` from `react-dom/server`.
// We use it to assert the rendered DOM tree; interactive behavior (clicks,
// keydown) is covered by the existing keyboard shortcut handler in
// ChartPanel (which is unit-tested through the hook's own tests).

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartSettingsPopover } from './ChartSettingsPopover';
import { DEFAULT_CHART_SETTINGS, type ChartSettingsState } from './useChartSettings';

const noop = () => {};
const settings: ChartSettingsState = { ...DEFAULT_CHART_SETTINGS };

const html = (open: boolean) =>
  renderToStaticMarkup(
    <ChartSettingsPopover
      open={open}
      onClose={noop}
      settings={settings}
      onPatch={noop}
      onReset={noop}
    />,
  );

describe('ChartSettingsPopover — render-time structure', () => {
  it('returns null (no markup) when closed', () => {
    expect(html(false)).toBe('');
  });

  it('renders a role="menu" element with the expected id when open', () => {
    const out = html(true);
    expect(out).toContain('id="chart-settings-popover"');
    expect(out).toContain('role="menu"');
  });

  it('renders all 5 group headers', () => {
    const out = html(true);
    for (const label of ['Scale', 'Mode', 'Axis', 'Display', 'Reset']) {
      expect(out).toContain(label);
    }
  });

  it('renders the working menu items with shortcut chips', () => {
    const out = html(true);
    expect(out).toContain('Auto (fit data)');
    expect(out).toContain('Alt+R');
    expect(out).toContain('Invert scale');
    expect(out).toContain('Alt+I');
    expect(out).toContain('Logarithmic');
    expect(out).toContain('Alt+L');
    expect(out).toContain('Move scale to left');
    expect(out).toContain('Crosshair snap');
    expect(out).toContain('Show countdown');
    expect(out).toContain('Reset price scale');
  });

  it('renders "Indexed to 100" as a disabled button', () => {
    const out = html(true);
    expect(out).toContain('Indexed to 100');
    // The button is rendered with the `disabled` attribute.
    expect(out).toMatch(/<button[^>]*disabled[^>]*>\s*<span[^>]*>\s*Indexed to 100\s*<\/span>/);
  });

  it('renders the "Plus button" and "More settings…" disabled footer items', () => {
    const out = html(true);
    expect(out).toContain('Plus button');
    expect(out).toContain('More settings…');
    // Each is a disabled button.
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[^<]*Plus button/);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[^<]*More settings/);
  });

  it('uses dark MDS tokens for the container', () => {
    const out = html(true);
    expect(out).toContain('border-line-strong');
    expect(out).toContain('bg-surface-1');
    expect(out).toContain('shadow-2xl');
  });

  it('renders aria-label for accessibility', () => {
    const out = html(true);
    expect(out).toContain('aria-label="Chart settings"');
  });
});
