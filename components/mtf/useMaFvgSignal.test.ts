import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '@/lib/types';
import type { SmcSnapshot } from '@/lib/smc/types';
import type { TimeframeEntry } from '@/lib/mtf/timeframe/timeframeTypes';
import { hier } from '@/lib/mtf/market/testFixtures';
import { mkFullIntel, mkMarket } from '@/lib/mtf/decision/testFixtures';
import { computeMaFvgSignals, freshnessOf } from '@/lib/indicators/maFvg/signals';
import { buildMaFvgSignalView } from './useMaFvgSignal';

const wavy: Candle[] = Array.from({ length: 260 }, (_, i) => {
  const close = 100 + 12 * Math.sin(i / 7) + i * 0.03;
  const o = 100 + 12 * Math.sin((i - 1) / 7) + (i - 1) * 0.03;
  return { time: 1_600_000_000 + i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 120 };
});

const tfe = (o: Partial<TimeframeEntry> = {}): TimeframeEntry => ({
  timeframe: '5m', bias: 'bullish', confidence: 63, regime: 'trending_up', regimeClarity: 60, role: 'trigger', authority: 61, agreesWithHTF: true, ...o,
});

const full = mkFullIntel(mkMarket(), hier({ perTimeframe: { '5m': tfe() } }));

const smc5 = {
  state: { swingTrend: 1, zone: 'discount' },
  events: [{ id: 'e', type: 'CHoCH', barIndex: 5, time: 1_600_001_000, direction: 'bullish' }],
} as unknown as SmcSnapshot;

const byTf: Partial<Record<Timeframe, Candle[]>> = { '5m': wavy };
const smcByTf: Partial<Record<Timeframe, SmcSnapshot>> = { '5m': smc5 };

describe('buildMaFvgSignalView', () => {
  it('surfaces the latest 5m signal with matching timestamp, age and freshness', () => {
    const events = computeMaFvgSignals(wavy);
    const last = events[events.length - 1];
    const view = buildMaFvgSignalView(byTf, full, smcByTf);

    expect(view.latest).not.toBeNull();
    expect(view.latest!.side).toBe(last.side);
    expect(view.latest!.confidence).toBe(last.confidence);
    expect(view.latest!.barTime).toBe(wavy[last.index].time);
    expect(view.latest!.price).toBe(wavy[last.index].close);
    // barsAgo = last-closed index (n-2) minus the signal index.
    expect(view.latest!.barsAgo).toBe(wavy.length - 2 - last.index);
    expect(view.latest!.freshness).toBe(freshnessOf(view.latest!.barsAgo));
  });

  it('gives up to 3 recent signals, most-recent first', () => {
    const view = buildMaFvgSignalView(byTf, full, smcByTf);
    expect(view.recent.length).toBeGreaterThan(0);
    expect(view.recent.length).toBeLessThanOrEqual(3);
    // Ordered newest → oldest by age.
    for (let i = 1; i < view.recent.length; i++) {
      expect(view.recent[i].barsAgo).toBeGreaterThanOrEqual(view.recent[i - 1].barsAgo);
    }
  });

  it('surfaces read-only context (5m MTF + SMC) without touching the decision', () => {
    const view = buildMaFvgSignalView(byTf, full, smcByTf);
    expect(view.context.mtf5m).toEqual({ bias: 'bullish', regime: 'trending_up', confidence: 63 });
    expect(view.context.smc).toEqual({ trend: 'bullish', zone: 'discount', lastEvent: { type: 'CHoCH', direction: 'bullish' } });
  });


  it('handles missing 5m data / missing layers gracefully', () => {
    const empty = buildMaFvgSignalView({}, mkFullIntel(mkMarket(), hier()), {});
    expect(empty.latest).toBeNull();
    expect(empty.recent).toEqual([]);
    expect(empty.context).toEqual({ mtf5m: null, smc: null });
  });
});
