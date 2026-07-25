import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/types';
import type { SmcSnapshot } from '@/lib/smc/types';
import { computeTradeDecision } from '@/lib/mtf/decision/decisionEngine';
import { mkBoard, mkFullIntel, mkMarket } from '@/lib/mtf/decision/testFixtures';
import { decideWithSmc } from './useTradeDecision';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107, 107];

const readyIntel = () => mkFullIntel(mkMarket({
  readiness: { state: 'ready', reason: 'ok' },
  headline: { bias: 'bullish', calibration: 'prior' },
  risk: { level: 'low' },
  quality: { level: 'good' },
  outlook: { invalidation: { invalidated: false, condition: null } },
}));

// Fixed to '1d' so the fixture's candle key ('1d') matches board.executionTimeframe.
const board = () => mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });

// Pool just beyond the canonical stop — known bounded effect (stop 103 → 102.3).
const smcSnapshot = {
  objects: {
    orderBlocks: [], fvgs: [], structureLevels: [], zones: [],
    liquidityPools: [{
      id: 'p', kind: 'liquidityPool' as const, scope: 'swing' as const, direction: 'bearish' as const,
      top: 102.5, bottom: 102.5, createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
      state: 'active' as const, touches: 0, strength: 50, quality: 50, confidence: 50,
    }],
  },
} as unknown as SmcSnapshot;

describe('Phase 1c decideWithSmc', () => {
  it('smc disabled ⇒ identical to the engine called without smc', () => {
    const b = board();
    const intel = readyIntel();
    const candles = { '1d': bars(LONG) } as const;
    expect(decideWithSmc(b, intel, candles, { '1d': smcSnapshot }, false))
      .toEqual(computeTradeDecision(b, intel, candles));
  });

  it('smc enabled ⇒ the Board execution timeframe snapshot is applied', () => {
    const b = board(); // executionTimeframe fixed to '1d' by the fixture
    const intel = readyIntel();
    const candles = { '1d': bars(LONG) } as const;
    const d = decideWithSmc(b, intel, candles, { '1d': smcSnapshot }, true);
    expect(d.diagnostics.smcApplied).toBe(true);
    expect(d.setup?.stop.price).toBe(102.3);
    // Snapshot under a NON-execution TF must be ignored.
    const ignored = decideWithSmc(b, intel, candles, { '15m': smcSnapshot }, true);
    expect(ignored.diagnostics.smcApplied).toBe(false);
  });
});
