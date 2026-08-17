import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeMaFvg } from './index';
import { computeMaFvgSignals, freshnessOf, SIGNAL_FRESHNESS } from './signals';

// A wavy 5m series so strength crosses VWAP/MA#4 a few times → real signals.
const bars: Candle[] = Array.from({ length: 260 }, (_, i) => {
  const close = 100 + 12 * Math.sin(i / 7) + i * 0.03;
  const o = 100 + 12 * Math.sin((i - 1) / 7) + (i - 1) * 0.03;
  return {
    time: 1_600_000_000 + i * 300, open: o,
    high: Math.max(o, close) + 1, low: Math.min(o, close) - 1,
    close, volume: 1000 + (i % 5) * 120,
  };
});

describe('computeMaFvgSignals — parity with the composite', () => {
  it('produces exactly the composite\'s marker signals (single source of truth)', () => {
    const events = computeMaFvgSignals(bars, { showSignals: true } as never);
    const composite = computeMaFvg(bars, { showSignals: true } as never);
    // Rebuild {index, side} from the composite markers and from the events.
    const fromMarkers = (composite.markers ?? [])
      .filter((m) => m.text === 'BUY' || m.text === 'SELL' || m.text === '𝗕𝗨𝗬' || m.text === '𝗦𝗘𝗟𝗟')
      .map((m) => ({ index: m.index, side: (m.text === 'BUY' || m.text === '𝗕𝗨𝗬') ? 'buy' : 'sell', confidence: m.value }));
    const fromEvents = events.map((e) => ({ index: e.index, side: e.side, confidence: e.confidence }));
    expect(fromEvents).toEqual(fromMarkers);
    expect(fromEvents.length).toBeGreaterThan(0); // the fixture actually produces signals
  });

  it('config (cooldown) flows through identically to both', () => {
    const a = computeMaFvgSignals(bars, { showSignals: true, signalCooldownBars: 30 } as never).map((e) => e.index);
    const b = (composite => (composite.markers ?? [])
      .filter((m) => m.text === 'BUY' || m.text === 'SELL' || m.text === '𝗕𝗨𝗬' || m.text === '𝗦𝗘𝗟𝗟').map((m) => m.index))(computeMaFvg(bars, { showSignals: true, signalCooldownBars: 30 } as never));
    expect(a).toEqual(b);
  });
});

describe('freshnessOf', () => {
  it('classifies by bars-ago at the tier boundaries', () => {
    expect(freshnessOf(0)).toBe('active');
    expect(freshnessOf(SIGNAL_FRESHNESS.activeMaxBars)).toBe('active');     // 5
    expect(freshnessOf(SIGNAL_FRESHNESS.activeMaxBars + 1)).toBe('aging');  // 6
    expect(freshnessOf(SIGNAL_FRESHNESS.agingMaxBars)).toBe('aging');       // 20
    expect(freshnessOf(SIGNAL_FRESHNESS.agingMaxBars + 1)).toBe('stale');   // 21
    expect(freshnessOf(42)).toBe('stale');
  });
});

