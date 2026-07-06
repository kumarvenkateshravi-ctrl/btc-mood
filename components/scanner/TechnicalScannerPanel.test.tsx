import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TechnicalScannerPanel from './TechnicalScannerPanel';
import { createStrategy, setStrategyEnabled, archiveStrategy, getStrategy, __resetScannerStoreForTest } from '@/lib/scanner/scannerStore';
import type { Condition } from '@/lib/scanner/types';

const cond: Condition = { left: { source: 'rsi', output: 'rsi' }, op: 'gt', right: 55, tf: '15m' };

beforeEach(() => __resetScannerStoreForTest());

describe('TechnicalScannerPanel', () => {
  it('list view: empty state + New Strategy entry point', () => {
    const html = renderToStaticMarkup(<TechnicalScannerPanel />);
    expect(html).toContain('Technical Scanner');
    expect(html).toContain('+ New Strategy');
    expect(html).toMatch(/No strategies yet/);
  });

  it('lists saved strategies with Live / On-chart toggles, version and controls', () => {
    const { strategy } = createStrategy({ name: 'Momentum Breakout', direction: 'long', tree: { logic: 'AND', children: [cond] } });
    setStrategyEnabled(strategy!.id, true);
    const html = renderToStaticMarkup(<TechnicalScannerPanel />);
    expect(html).toContain('Momentum Breakout');
    expect(html).toContain('v1 · long');
    expect(html).toContain('Live');
    expect(html).toContain('On chart');
    expect(html).toContain('Edit');
    expect(html).toContain('Archive');
  });

  it('archived strategies disappear from the list (but are never deleted)', () => {
    const { strategy } = createStrategy({ name: 'Old', direction: 'long', tree: { logic: 'AND', children: [cond] } });

    archiveStrategy(strategy!.id);
    const html = renderToStaticMarkup(<TechnicalScannerPanel />);
    expect(html).not.toContain('Old');
    expect(getStrategy(strategy!.id)?.archived).toBe(true);
  });
});
