import { describe, it, expect } from 'vitest';
import { createOrderBlockEngine } from './orderBlocks';
import { computeVolatility } from './volatility';
import { resolveSmcConfig } from './types';
import type { Candle } from '@/lib/types';
import type { SmcEvent } from './types';
import type { StructureBreak } from './marketStructure';

/**
 * Bars 0..8 rising, with bar 3 dipping to the lowest low (the origin bar a
 * bullish OB should anchor to), then bars for touch + mitigation:
 *  i=9  dips into the band (touch, no close below bottom)
 *  i=10 closes below the band bottom (mitigation via low for 'highlow')
 */
function scene(): Candle[] {
  // Bar ranges stay under 2×ATR(≈1.6) ⇒ no high-volatility parsed-H/L swaps,
  // so the OB anchors to the raw extreme bar (bar 3).
  const rows: Array<[number, number, number, number]> = [
    // [open, high, low, close]
    [100, 101, 100, 100.5],       // 0
    [100.5, 101.5, 100, 101],     // 1
    [101, 102, 100.5, 101.5],     // 2
    [101.5, 101.8, 99.8, 100],    // 3  ← lowest low: OB origin (band 99.8..101.8)
    [100, 102, 99.9, 101.8],      // 4
    [101.8, 103, 101.5, 102.5],   // 5
    [102.5, 104, 102, 103.5],     // 6
    [103.5, 105, 103, 104.5],     // 7
    [104.5, 106, 104, 105.5],     // 8  ← break bar (bullish internal break fed here)
    [105.5, 105.8, 101.5, 104],   // 9  ← wick into band (low 101.5 ≤ top 101.8), closes above
    [104, 104.5, 99.5, 99.6],     // 10 ← low 99.5 < bottom 99.8 ⇒ mitigated (highlow)
  ];
  return rows.map(([o, h, l, c], i) => ({ time: i * 60, open: o, high: h, low: l, close: c, volume: 1 }));
}

const bullishBreak: StructureBreak = {
  scope: 'internal',
  direction: 'bullish',
  tag: 'BOS',
  pivot: { level: 102, barIndex: 0, barTime: 0 },
};

function run(candles: Candle[], stopAt?: number) {
  const cfg = resolveSmcConfig();
  const vol = computeVolatility(candles, cfg.obFilter);
  const events: SmcEvent[] = [];
  const eng = createOrderBlockEngine(candles, cfg, vol, events);
  const end = stopAt ?? candles.length;
  for (let i = 0; i < end; i++) {
    eng.onBar(i, i === 8 ? [bullishBreak] : []);
  }
  return { eng, events };
}

describe('createOrderBlockEngine', () => {
  it('anchors a bullish OB to the lowest parsed low between pivot and break bar', () => {
    const { eng, events } = run(scene(), 9);
    expect(eng.blocks.length).toBe(1);
    const ob = eng.blocks[0];
    expect(ob.direction).toBe('bullish');
    expect(ob.scope).toBe('internal');
    expect(ob.createdAtBar).toBe(3);
    expect(ob.top).toBeCloseTo(101.8);
    expect(ob.bottom).toBeCloseTo(99.8);
    expect(ob.state).toBe('active');
    expect(events.some((e) => e.type === 'OB_CREATED' && e.objectId === ob.id)).toBe(true);
  });

  it('flips to tested on a wick into the band, then mitigated on break below', () => {
    const { eng, events } = run(scene());
    const ob = eng.blocks[0];
    expect(ob.touches).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'OB_TESTED')).toBe(true);
    expect(ob.state).toBe('mitigated');
    expect(events.some((e) => e.type === 'OB_MITIGATED' && e.objectId === ob.id)).toBe(true);
  });

  it('close mitigation source ignores wicks', () => {
    const cfg = resolveSmcConfig({ obMitigation: 'close' });
    const candles = scene();
    // bar 10: wick 99.5 pierces bottom 99.8 but with close INSIDE the band the
    // 'close' mitigation source must NOT mitigate.
    candles[10] = { ...candles[10], close: 100 };
    const vol = computeVolatility(candles, cfg.obFilter);
    const events: SmcEvent[] = [];
    const eng = createOrderBlockEngine(candles, cfg, vol, events);
    for (let i = 0; i < candles.length; i++) eng.onBar(i, i === 8 ? [bullishBreak] : []);
    expect(eng.blocks[0].state).not.toBe('mitigated');
  });

  it('archives blocks older than maxAgeBars', () => {
    const cfg = resolveSmcConfig({ maxAgeBars: 20 });
    const base = scene().slice(0, 9);
    const candles: Candle[] = [
      ...base,
      ...Array.from({ length: 40 }, (_, k) => ({
        time: (9 + k) * 60, open: 106, high: 106.5, low: 105.5, close: 106, volume: 1,
      })),
    ];
    const vol = computeVolatility(candles, cfg.obFilter);
    const events: SmcEvent[] = [];
    const eng = createOrderBlockEngine(candles, cfg, vol, events);
    for (let i = 0; i < candles.length; i++) eng.onBar(i, i === 8 ? [bullishBreak] : []);
    expect(eng.blocks[0].state).toBe('archived');
  });
});
