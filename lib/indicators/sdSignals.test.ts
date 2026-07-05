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
  it('renders the zone bands + per-bar signals (complete-setup shape)', () => {
    const bars = synth();
    const res = computeSdSignals(bars, { id: 'sd_signals' });
    expect(res.signals.length).toBe(bars.length);
    // Default D+4H draws zone band plots (the host for the entry/SL/TP lines).
    expect(res.plots.length).toBeGreaterThan(0);
    expect(res.plots.every((p) => p.type === 'band')).toBe(true);
    expect(Array.isArray(res.levels)).toBe(true);
  });

  it('showSignals=false clears the arrows; showSupply=false blanks supply band data', () => {
    const bars = synth();
    const off = computeSdSignals(bars, { id: 'sd_signals', settings: { inputs: { showSignals: false, showSupply: false } } } as never);
    expect(off.signals.every((s) => s === 'neutral')).toBe(true);
    const supplyPlot = off.plots.find((p) => p.id.includes(' Su'));
    expect(supplyPlot).toBeTruthy();
    expect(supplyPlot!.data.every((d) => d === null)).toBe(true); // hidden but host kept
  });

  it('caches on the closed-bar signature so repeated intrabar calls are O(1)', () => {
    const bars = synth();
    const a = computeSdSignalEvents(bars, { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' });
    const b = computeSdSignalEvents(bars, { id: 'sd_signals' }, { symbol: 'BTCUSDT', timeframe: '1h' });
    expect(b).toBe(a); // same reference → cache hit, no recompute
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
