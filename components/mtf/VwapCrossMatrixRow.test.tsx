import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PriceWeeklyVwapCross, PriceWeeklyVwapCrossByTimeframe } from '@/lib/mtf/vwapCrossover';
import VwapCrossMatrixRow, { vwapCrossLabel } from './VwapCrossMatrixRow';

const cross = (overrides: Partial<PriceWeeklyVwapCross>): PriceWeeklyVwapCross => ({
  price: 101,
  weekly: 100,
  relationship: 'above',
  spreadPct: 1,
  lastCross: 'none',
  lastCrossTime: null,
  barsSinceCross: null,
  ...overrides,
});

describe('VwapCrossMatrixRow', () => {
  it('renders compact Bull and Bear price/Weekly VWAP states for every timeframe without arrows', () => {
    const crosses: PriceWeeklyVwapCrossByTimeframe = {
      '5m': cross({ lastCross: 'bullish', lastCrossTime: 1, barsSinceCross: 0 }),
      '15m': cross({ relationship: 'below', lastCross: 'bearish', lastCrossTime: 1, barsSinceCross: 3 }),
      '30m': cross({}),
      '1h': null,
      '4h': null,
      '1d': null,
    };

    const html = renderToStaticMarkup(<table><tbody><VwapCrossMatrixRow crosses={crosses} /></tbody></table>);

    expect(html).toContain('Price / Weekly · closed bars');
    expect(html).toContain('5M: price crossed above Weekly VWAP on the latest closed bar.');
    expect(html).toContain('15M: price crossed below Weekly VWAP 3 bars ago.');
    expect(html).toContain('Latest close');
    expect(html).toContain('3 bars ago');
    expect(html).toContain('text-bull-bright');
    expect(html).toContain('text-bear-bright');
    expect(html).not.toContain('↑');
    expect(html).not.toContain('↓');
  });

  it('uses the current price relationship even when an older cross points the other way', () => {
    expect(vwapCrossLabel(cross({ relationship: 'below', lastCross: 'bullish' }))).toBe('Bear');
    expect(vwapCrossLabel(cross({ relationship: 'above', lastCross: 'bearish' }))).toBe('Bull');
  });

  it('uses precise labels for equal and waiting states', () => {
    expect(vwapCrossLabel(cross({ lastCross: 'none' }))).toBe('Bull');
    expect(vwapCrossLabel(cross({ relationship: 'equal' }))).toBe('None');
    expect(vwapCrossLabel(null)).toBe('Waiting');
  });
});
