// lib/indicators/sdSignals.test.ts
import { describe, it, expect } from 'vitest';
import { computeSdSignals, computeSdSignalEvents } from './sdSignals';
import type { Candle } from '../types';

function synth(): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 220; i++) {
    const day = Math.floor(i / 24);
    const drift = day < 3 ? 0.4 : day === 3 && i % 24 < 6 ? -1.2 : 0.8;
    const o = price;
    price = Math.max(1, price + drift);
    const h = Math.max(o, price) + 1;
    const l = Math.min(o, price) - 1;
    bars.push({ time: 1_600_000_000 + i * 3600, open: o, high: h, low: l, close: price, volume: 1000 + (i % 24) * 10 } as Candle);
  }
  return bars;
}

describe('computeSdSignals glue', () => {
  it('returns an IndicatorResult with the framework shape', () => {
    const bars = synth();
    const res = computeSdSignals(bars, { id: 'sd_signals' });
    expect(Array.isArray(res.signals)).toBe(true);
    expect(res.signals.length).toBe(bars.length);
    expect(Array.isArray(res.markers)).toBe(true);
  });

  it('emits SdSignal contract objects; triggered ones have concrete levels', () => {
    const events = computeSdSignalEvents(synth(), { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' });
    for (const e of events) {
      expect(['buy', 'sell']).toContain(e.side);
      if (e.triggeredIndex != null) {
        expect(Number.isNaN(e.stopLoss)).toBe(false);
        expect(Number.isNaN(e.takeProfit1)).toBe(false);
        expect(e.confidence).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
