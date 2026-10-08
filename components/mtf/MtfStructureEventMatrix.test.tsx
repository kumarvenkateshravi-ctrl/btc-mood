import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Timeframe } from '@/lib/types';
import type { MarketStructureSnapshot, TrendWord } from '@/lib/mtf/structureEngine';
import MtfStructureEventMatrix from './MtfStructureEventMatrix';

function snapshot(timeframe: Timeframe, trend: TrendWord, eventLabel: string, barsAgo: number): MarketStructureSnapshot {
  return {
    metadata: {
      engine: 'marketStructure', snapshotVersion: '1.1', symbol: 'BTCUSDT', timeframe,
      lastClosedBarTime: 1_700_000_000, createdAt: 1_700_000_000, computationTimeMs: 1,
      config: { structureWindowBars: 20, timelineLength: 7 },
    },
    structure: {
      state: 'ready',
      data: { trend, sequence: trend === 'bullish' ? ['HH', 'HL'] : ['LH', 'LL'], confidence: 82, ageBars: 3, qualityWord: 'Strong' },
    },
    liquidity: { state: 'warming_up', data: null },
    fvg: { state: 'warming_up', data: null },
    orderBlocks: { state: 'warming_up', data: null },
    structureBreaks: { state: 'warming_up', data: null },
    premiumDiscount: { state: 'ready', data: { zone: trend === 'bullish' ? 'discount' : 'premium', description: '' } },
    timeline: {
      state: 'ready',
      data: { items: [{ eventId: `${timeframe}-event`, eventType: 'BOS', barIndex: 10, timestamp: 1_700_000_000, direction: trend === 'neutral' ? 'bullish' : trend, label: eventLabel, barsAgo }] },
    },
    phase: { state: 'warming_up', data: null },
    quality: {
      state: 'ready',
      data: { classification: 'Strong', confidence: 82, summary: '', trend, liquidityBias: 'mixed', recentBreaks: eventLabel },
    },
    narratives: [],
  };
}

describe('MtfStructureEventMatrix', () => {
  it('shows execution/context alignment and the latest confirmed event for every timeframe', () => {
    const snapshots: Partial<Record<Timeframe, MarketStructureSnapshot>> = {
      '5m': snapshot('5m', 'bearish', 'Bearish BOS', 0),
      '15m': snapshot('15m', 'bearish', 'Bearish CHoCH', 2),
      '30m': snapshot('30m', 'bearish', 'Buy-side Liquidity Sweep', 1),
      '1h': snapshot('1h', 'bearish', 'Bearish BOS', 3),
      '4h': snapshot('4h', 'bearish', 'Bearish CHoCH', 1),
      '1d': snapshot('1d', 'bullish', 'Bullish BOS', 4),
    };
    const html = renderToStaticMarkup(
      <MtfStructureEventMatrix snapshots={snapshots} timeframes={['5m', '15m', '30m', '1h', '4h', '1d']} selectedTf="5m" onSelectTf={() => undefined} />,
    );

    expect(html).toContain('SMC Structure by Timeframe');
    expect(html).toContain('Bearish structure aligned');
    expect(html).toContain('Bearish CHoCH');
    expect(html).toContain('latest close');
    expect(html).toContain('2 bars ago');
    expect(html).toContain('Show 1H market structure details');
  });
});
