import { describe, it, expect } from 'vitest';
import { verifyReplayIntegrity } from './verify';
import { TF_SECONDS } from './replaySlice';
import type { Candle, Timeframe } from '@/lib/types';

function series(tf: Timeframe, t0: number, count: number): Candle[] {
  const step = TF_SECONDS[tf];
  return Array.from({ length: count }, (_, i) => {
    const drift = Math.sin(i / 9) * 4;
    const p = 100 + i * 0.1 + drift;
    return { time: t0 + i * step, open: p, high: p + 1, low: p - 1, close: p + 0.4, volume: 10 + (i % 7) };
  });
}

const T0 = 1_700_000_000 - (1_700_000_000 % 86400);

describe('verifyReplayIntegrity', () => {
  it('reports 100% integrity for pure engines on clean data', () => {
    const candlesByTf: Partial<Record<Timeframe, Candle[]>> = {
      '15m': series('15m', T0, 400),
      '1h': series('1h', T0, 120),
      '1d': series('1d', T0, 5),
    };
    const report = verifyReplayIntegrity({
      candles: candlesByTf['15m']!,
      playIndex: 250,
      evalTf: '15m',
      candlesByTf,
    });
    expect(report.checks.length).toBe(5);
    for (const c of report.checks) expect(c.ok, c.name).toBe(true);
    expect(report.integrity).toBe(100);
  });

  it('is safe on tiny input', () => {
    const report = verifyReplayIntegrity({ candles: series('15m', T0, 3), playIndex: 1, evalTf: '15m', candlesByTf: {} });
    expect(report.checks.length).toBeGreaterThan(0);
  });
});
