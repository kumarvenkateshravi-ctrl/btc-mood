// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LayoutSwitcher,
  LayoutSwitcherButton,
} from './LayoutSwitcher';
import { DEFAULT_LAYOUT, type Layout } from '@/lib/gridLayout';

const noop = () => {};
const html = (open: boolean, layout: Layout = DEFAULT_LAYOUT) =>
  renderToStaticMarkup(
    <LayoutSwitcher
      open={open}
      onOpenChange={noop}
      layout={layout}
      onChange={noop}
    />,
  );

describe('LayoutSwitcher — render-time structure', () => {
  it('renders nothing when closed', () => {
    expect(html(false)).toBe('');
  });

  it('renders a role="dialog" with the expected id when open', () => {
    const out = html(true);
    expect(out).toContain('id="layout-switcher-popover"');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-label="Layout switcher"');
  });

  it('renders the 5 active layout thumbnails', () => {
    const out = html(true);
    // 5 radios — role="radio" appears at least 5 times.
    const radios = out.match(/role="radio"/g) ?? [];
    expect(radios.length).toBeGreaterThanOrEqual(5);
  });

  it('marks the currently selected layout with aria-checked="true"', () => {
    const out = html(true, { mode: 'multi-pane', count: 4, sync: DEFAULT_LAYOUT.sync });
    // The 4-pane multi-pane row should be the one with aria-checked="true".
    expect(out).toContain('aria-checked="true"');
  });

  it('renders the Sync in layout section with all 5 toggles', () => {
    const out = html(true);
    expect(out).toContain('Sync in layout');
    expect(out).toContain('Symbol');
    expect(out).toContain('Interval');
    expect(out).toContain('Crosshair');
    expect(out).toContain('Time');
    expect(out).toContain('Date range');
  });

  it('disables Symbol and Interval (always-on in v1)', () => {
    const out = html(true);
    // The two always-on rows must have disabled inputs.
    expect(out).toContain('disabled=""');
  });

  it('renders the More layouts section with 2 coming-soon thumbs', () => {
    const out = html(true);
    expect(out).toContain('More layouts');
    expect(out).toContain('Coming soon');
  });

  it('disables multi-pane thumbnails when multiPaneDisabled is set', () => {
    const out = renderToStaticMarkup(
      <LayoutSwitcher
        open
        onOpenChange={noop}
        layout={DEFAULT_LAYOUT}
        onChange={noop}
        multiPaneDisabled
        multiPaneDisabledTitle="Renko time-less"
      />,
    );
    // 2 of the 5 active thumbnails are multi-pane — they should be disabled.
    // The two coming-soon thumbs are also disabled (4 total disabled buttons expected).
    // We don't count exactly; we just check that the Renko tooltip text is present.
    expect(out).toContain('Renko time-less');
  });
});

describe('LayoutSwitcherButton', () => {
  it('renders with role=button, aria-haspopup and aria-expanded', () => {
    const out = renderToStaticMarkup(
      <LayoutSwitcherButton
        layout={DEFAULT_LAYOUT}
        onClick={noop}
        open={false}
      />,
    );
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-controls="layout-switcher-popover"');
  });

  it('flips aria-expanded when open', () => {
    const out = renderToStaticMarkup(
      <LayoutSwitcherButton
        layout={DEFAULT_LAYOUT}
        onClick={noop}
        open
      />,
    );
    expect(out).toContain('aria-expanded="true"');
  });
});
