import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeFullTradeDecision, computeTradeDecision } from './decisionEngine';
import type { TradeDecisionResult } from './decisionTypes';
import { mkBoard, mkFullIntel, mkMarket } from './testFixtures';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];
// Forming bar appended — the engine must slice it off (closed-bar discipline).
const withForming = (mids: number[]): Candle[] => bars([...mids, mids[mids.length - 1]]);

const readyMarket = () => mkMarket({
  headline: { bias: 'bullish', calibration: 'prior' },
  risk: { level: 'low' },
  quality: { level: 'good' },
  outlook: { invalidation: { invalidated: false, condition: null } },
});

// NOTE (Arch v2): riskTier === 'none' no longer implies action === 'no_trade'
// (extreme_risk can cap tier to none while direction/action stand) — the
// invariant is now one-directional.
const invariants = (d: TradeDecisionResult) => {
  expect(d.setup === null).toBe(d.action === 'no_trade');
  if (d.action === 'no_trade') expect(d.riskTier).toBe('none');
  expect(d.gate.passed).toBe(d.action !== 'no_trade');
};

describe('M9 orchestrator — computeTradeDecision (Arch v2: Board is the sole direction authority)', () => {
  it('executionTf is echoed verbatim from board.executionTimeframe', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '15m' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '15m': withForming(LONG) });
    expect(d.executionTf).toBe('15m');
  });

  it('board no_trade: setup null, tier none, direction still echoed as board.bias', () => {
    const board = mkBoard({ direction: 'no_trade', bias: 'bearish', conviction: 40, executionTimeframe: '1d' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) });
    expect(d.action).toBe('no_trade');
    expect(d.gate).toEqual({
      passed: false, blockedBy: 'board_no_trade',
      reason: 'board conviction 40% is below the 55% minimum',
    });
    expect(d.direction).toBe('bearish');
    expect(d.diagnostics).toEqual({
      schemaVersions: { market: 1 }, atr: null, swingHigh: null, swingLow: null, rawRR: null, smcApplied: false,
    });
    invariants(d);
  });

  it('happy path long: canonical setup, tier from ladder, priors signal present', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) });
    expect(d.action).toBe('long');
    expect(d.direction).toBe('bullish');
    expect(d.executionTf).toBe('1d');
    expect(d.setup?.entry.zone).toEqual([105, 105.5]);
    expect(d.setup?.stop.price).toBe(103);
    expect(d.setup?.rr).toBe(2.56);
    expect(d.riskTier).toBe('half');
    expect(d.calibration).toBe('prior');
    expect(d.signals.some((s) => s.code === 'DECISION_MODEL_PRIORS')).toBe(true);
    expect(d.diagnostics).toMatchObject({ atr: 2, swingHigh: 111, swingLow: 105, rawRR: null, smcApplied: false });
    invariants(d);
  });

  it('extreme market risk caps tier to none but does NOT flip the board-decided action (Arch v2 core guarantee)', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const market = mkMarket({
      headline: { bias: 'bullish', calibration: 'empirical' },
      risk: { level: 'extreme' },
      quality: { level: 'excellent' },
      outlook: { invalidation: { invalidated: false, condition: null } },
    });
    const d = computeTradeDecision(board, mkFullIntel(market), { '1d': withForming(LONG) });
    expect(d.action).toBe('long');
    expect(d.setup).not.toBeNull();
    expect(d.riskTier).toBe('none');
    expect(d.signals.some((s) => s.code === 'TIER_CAPPED_RISK')).toBe(true);
  });

  it('insufficient data: missing or short execution-TF candles', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const intel = mkFullIntel(readyMarket());
    expect(computeTradeDecision(board, intel, {}).gate.blockedBy).toBe('insufficient_data');
    const short = computeTradeDecision(board, intel, { '1d': withForming(LONG.slice(0, 19)) });
    expect(short.gate.blockedBy).toBe('insufficient_data');
    invariants(short);
  });

  it('SMC re-gate: stop extension dropping RR below minRR blocks with rr_too_low', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const smc = {
      objects: {
        orderBlocks: [], fvgs: [], structureLevels: [], zones: [],
        liquidityPools: [{
          id: 'p', kind: 'liquidityPool' as const, scope: 'swing' as const, direction: 'bearish' as const,
          top: 101.5, bottom: 101.5, createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
          state: 'active' as const, touches: 0, strength: 50, quality: 50, confidence: 50,
        }],
      },
    };
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) }, smc);
    expect(d.action).toBe('no_trade');
    expect(d.gate.blockedBy).toBe('rr_too_low');
    expect(d.diagnostics.rawRR).toBe(1.46);
    expect(d.diagnostics.smcApplied).toBe(true);
    expect(d.confluence.some((n) => n.code === 'STOP_EXTENDED_LIQUIDITY')).toBe(true);
    invariants(d);
  });

  it('deterministic and closed-bar: forming-bar mutation changes nothing', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const intel = mkFullIntel(readyMarket());
    const a = computeTradeDecision(board, intel, { '1d': withForming(LONG) });
    const b = computeTradeDecision(board, intel, { '1d': withForming(LONG) });
    expect(a).toEqual(b);
    const mutated = withForming(LONG);
    mutated[mutated.length - 1] = { ...mutated[mutated.length - 1], close: 999, high: 1000, low: 1 };
    expect(computeTradeDecision(board, intel, { '1d': mutated })).toEqual(a);
  });
});

describe('M9 — computeFullTradeDecision', () => {
  it('runs the Board + the whole M0-M8 stack and holds the structural invariants on real engine output', () => {
    // 5m-keyed: intel (M6-M8) is now computed on 5m candles only (Arch v2
    // follow-up) so this exercises a non-trivial stack, not the empty-input path.
    const { decision, intel, board } = computeFullTradeDecision({ '5m': withForming(LONG) });
    expect(intel.result.schemaVersion).toBe(1);
    expect(board.schemaVersion).toBe(1);
    expect(board.executionTimeframe).toBe('5m');
    expect(decision.calibration).toBe(intel.result.headline.calibration);
    expect(decision.executionTf).toBe(board.executionTimeframe);
    invariants(decision);
    const again = computeFullTradeDecision({ '5m': withForming(LONG) });
    expect(again.decision).toEqual(decision);
  });

  it('intel (M6-M8) is scoped to 5m only — a non-5m-only stack does not change it', () => {
    const fiveMOnly = computeFullTradeDecision({ '5m': withForming(LONG) });
    const withOtherTfsToo = computeFullTradeDecision({ '5m': withForming(LONG), '1d': withForming(LONG) });
    expect(withOtherTfsToo.intel).toEqual(fiveMOnly.intel);
  });
});
