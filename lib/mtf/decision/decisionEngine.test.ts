import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { TimeframeEntry } from '../timeframe/timeframeTypes';
import { hier } from '../market/testFixtures';
import { computeFullTradeDecision, computeTradeDecision } from './decisionEngine';
import type { TradeDecisionResult } from './decisionTypes';
import { mkFullIntel, mkMarket } from './testFixtures';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];
// Forming bar appended — the engine must slice it off (closed-bar discipline).
const withForming = (mids: number[]): Candle[] => bars([...mids, mids[mids.length - 1]]);

const tfe = (o: Partial<TimeframeEntry> & Pick<TimeframeEntry, 'timeframe' | 'role' | 'authority'>): TimeframeEntry => ({
  bias: 'bullish', confidence: 60, regime: 'trending_up', regimeClarity: 60, agreesWithHTF: true, ...o,
});

const readyMarket = () => mkMarket({
  readiness: { state: 'ready', reason: 'ok' },
  headline: { bias: 'bullish', calibration: 'prior' },
  risk: { level: 'low' },
  quality: { level: 'good' },
  outlook: { invalidation: { invalidated: false, condition: null } },
});

const invariants = (d: TradeDecisionResult) => {
  expect(d.setup === null).toBe(d.action === 'no_trade');
  expect(d.riskTier === 'none').toBe(d.action === 'no_trade');
  expect(d.gate.passed).toBe(d.action !== 'no_trade');
};

describe('M9 orchestrator — computeTradeDecision', () => {
  it('executionTf: highest-authority trigger wins; no triggers → lowest weight; empty → controller', () => {
    const withTriggers = mkFullIntel(readyMarket(), hier({
      controller: '1d',
      perTimeframe: {
        '15m': tfe({ timeframe: '15m', role: 'trigger', authority: 65 }),
        '5m': tfe({ timeframe: '5m', role: 'trigger', authority: 61 }),
      },
    }));
    expect(computeTradeDecision(withTriggers, { '15m': withForming(LONG) }).executionTf).toBe('15m');

    const noTriggers = mkFullIntel(readyMarket(), hier({
      controller: '1d',
      perTimeframe: {
        '4h': tfe({ timeframe: '4h', role: 'context', authority: 60 }),
        '1h': tfe({ timeframe: '1h', role: 'context', authority: 55 }),
      },
    }));
    expect(computeTradeDecision(noTriggers, { '1h': withForming(LONG) }).executionTf).toBe('1h');

    expect(computeTradeDecision(mkFullIntel(readyMarket(), hier()), {}).executionTf).toBe('1d');
  });

  it('environment-blocked: setup null, tier none, direction still echoed', () => {
    const intel = mkFullIntel(mkMarket({
      readiness: { state: 'wait', reason: 'awaiting confirmation' },
      headline: { bias: 'bearish' },
    }));
    const d = computeTradeDecision(intel, { '1d': withForming(LONG) });
    expect(d.action).toBe('no_trade');
    expect(d.gate).toEqual({ passed: false, blockedBy: 'environment_wait', reason: 'awaiting confirmation' });
    expect(d.direction).toBe('bearish');
    expect(d.diagnostics).toEqual({
      schemaVersions: { market: 1 }, atr: null, swingHigh: null, swingLow: null, rawRR: null, smcApplied: false,
    });
    invariants(d);
  });

  it('happy path long: canonical setup, tier from ladder, priors signal present', () => {
    const d = computeTradeDecision(mkFullIntel(readyMarket()), { '1d': withForming(LONG) });
    expect(d.action).toBe('long');
    expect(d.direction).toBe('bullish');
    expect(d.executionTf).toBe('1d');
    expect(d.setup?.entry.zone).toEqual([105, 105.5]);
    expect(d.setup?.stop.price).toBe(103);
    expect(d.setup?.rr).toBe(2.56);
    expect(d.riskTier).toBe('half');   // good quality + low risk → half; cap not involved
    expect(d.calibration).toBe('prior');
    expect(d.signals.some((s) => s.code === 'DECISION_MODEL_PRIORS')).toBe(true);
    expect(d.diagnostics).toMatchObject({ atr: 2, swingHigh: 111, swingLow: 105, rawRR: null, smcApplied: false });
    invariants(d);
  });

  it('insufficient data: missing or short execution-TF candles', () => {
    const intel = mkFullIntel(readyMarket());
    expect(computeTradeDecision(intel, {}).gate.blockedBy).toBe('insufficient_data');
    const short = computeTradeDecision(intel, { '1d': withForming(LONG.slice(0, 19)) });
    expect(short.gate.blockedBy).toBe('insufficient_data');
    invariants(short);
  });

  it('SMC re-gate: stop extension dropping RR below minRR blocks with rr_too_low', () => {
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
    const d = computeTradeDecision(mkFullIntel(readyMarket()), { '1d': withForming(LONG) }, smc);
    expect(d.action).toBe('no_trade');
    expect(d.gate.blockedBy).toBe('rr_too_low');
    expect(d.diagnostics.rawRR).toBe(1.46);
    expect(d.diagnostics.smcApplied).toBe(true);
    expect(d.confluence.some((n) => n.code === 'STOP_EXTENDED_LIQUIDITY')).toBe(true);
    invariants(d);
  });

  it('deterministic and closed-bar: forming-bar mutation changes nothing', () => {
    const intel = mkFullIntel(readyMarket());
    const a = computeTradeDecision(intel, { '1d': withForming(LONG) });
    const b = computeTradeDecision(intel, { '1d': withForming(LONG) });
    expect(a).toEqual(b);
    const mutated = withForming(LONG);
    mutated[mutated.length - 1] = { ...mutated[mutated.length - 1], close: 999, high: 1000, low: 1 };
    expect(computeTradeDecision(intel, { '1d': mutated })).toEqual(a);
  });
});

describe('M9 — computeFullTradeDecision', () => {
  it('runs the whole stack and holds the structural invariants on real engine output', () => {
    const { decision, intel } = computeFullTradeDecision({ '15m': withForming(LONG) });
    expect(intel.result.schemaVersion).toBe(1);
    expect(decision.calibration).toBe(intel.result.headline.calibration);
    invariants(decision);
    const again = computeFullTradeDecision({ '15m': withForming(LONG) });
    expect(again.decision).toEqual(decision);
  });
});
