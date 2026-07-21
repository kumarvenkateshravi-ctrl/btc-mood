import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MaFvgSignalView } from './useMaFvgSignal';
import { MaFvgSignalCard } from './MarketIntelligence';

const base: MaFvgSignalView = {
  latest: { side: 'buy', confidence: 0.42, barTime: 1_600_002_100, barsAgo: 2, freshness: 'active', price: 66210.5 },
  recent: [
    { side: 'buy', barTime: 1_600_002_100, barsAgo: 2 },
    { side: 'sell', barTime: 1_600_000_900, barsAgo: 6 },
  ],
  context: {
    mtf5m: { bias: 'bullish', regime: 'trending_up', confidence: 63 },
    smc: { trend: 'bullish', zone: 'discount', lastEvent: { type: 'CHoCH', direction: 'bullish' } },
  },
};

describe('MaFvgSignalCard', () => {
  it('shows the decision, timestamp, age, freshness, and read-only context', () => {
    const html = renderToStaticMarkup(<MaFvgSignalCard signal={base} />);
    expect(html).toContain('Moving Averages &amp; FVG');
    expect(html).toContain('>buy<');
    expect(html).toContain('2 bars ago');
    expect(html).toContain('Generated:');
    expect(html).toContain('Active');
    expect(html).toContain('not used to confirm the signal');
    expect(html).toContain('MTF 5m');
    expect(html).toContain('SMC Structure');
    expect(html).toContain('CHoCH');
  });

  it('renders a clean empty state when there is no signal', () => {
    const html = renderToStaticMarkup(<MaFvgSignalCard signal={{ latest: null, recent: [], context: { mtf5m: null, smc: null } }} />);
    expect(html).toContain('No active signal on 5m.');
    expect(html).not.toContain('bars ago');
  });

  it('marks a stale signal', () => {
    const stale: MaFvgSignalView = { ...base, latest: { ...base.latest!, barsAgo: 42, freshness: 'stale' } };
    const html = renderToStaticMarkup(<MaFvgSignalCard signal={stale} />);
    expect(html).toContain('Stale');
    expect(html).toContain('42 bars ago');
  });
});
