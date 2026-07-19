import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import type { HierarchyResult, OverallMarketState, TimeframeEntry } from './timeframe/timeframeTypes';
import { computeMarketIntelligenceBoard, deriveTradeContext } from './marketIntelligence';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

const entry = (timeframe: Timeframe, role: TimeframeEntry['role'], authority: number): TimeframeEntry => ({
  timeframe, bias: 'bullish', confidence: authority, regime: 'trending_up', regimeClarity: 60, role, authority, agreesWithHTF: true,
});
const hier = (overallMarketState: OverallMarketState, controller: Timeframe, conflict: number, entries: TimeframeEntry[]): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'bullish', alignment: 80, conflict, controller, controllerAuthority: 80,
  overallMarketState, transition: false,
  perTimeframe: Object.fromEntries(entries.map((e) => [e.timeframe, e])), contributors: [], signals: [], warnings: [],
});

describe('computeMarketIntelligenceBoard', () => {
  it('produces a hierarchy + per-TF selected bundle from real candles', () => {
    const board = computeMarketIntelligenceBoard({ '1d': series(260, 100, 0.6), '4h': series(260, 100, 0.5), '1h': series(260, 100, 0.4) }, '1h');
    expect(board.hierarchy.schemaVersion).toBe(1);
    expect(board.snapshots).toHaveLength(3);
    expect(board.selected?.timeframe).toBe('1h');
    expect(board.selected?.categories).toHaveLength(6);
    expect(board.selected?.confidence.confidence).toBeGreaterThanOrEqual(0);
  });
  it('selected is null when the selected TF has no candles', () => {
    const board = computeMarketIntelligenceBoard({ '1d': series(260, 100, 0.6) }, '5m');
    expect(board.selected).toBeNull();
    expect(board.snapshots).toHaveLength(1);
  });
});

describe('deriveTradeContext', () => {
  it('maps overallMarketState → opportunity/action (bullish pullback example)', () => {
    const tc = deriveTradeContext(hier('bullish_pullback', '1d', 10, [entry('1d', 'context', 80), entry('15m', 'trigger', 70)]), 75);
    expect(tc.opportunity).toBe('Trend Pullback');
    expect(tc.action).toBe('Wait For Continuation');
    expect(tc.controller).toBe('1d');
    expect(tc.executionTf).toBe('15m');   // highest-authority trigger tier
    expect(tc.risk).toBe('Low');          // conf 75, conflict 10
  });
  it('risk table + reversal floor', () => {
    const es = [entry('1d', 'context', 40), entry('5m', 'trigger', 40)];
    expect(deriveTradeContext(hier('bullish_continuation', '1d', 10, es), 50).risk).toBe('Medium');
    expect(deriveTradeContext(hier('bullish_continuation', '1d', 60, es), 80).risk).toBe('Medium'); // high conflict blocks Low
    expect(deriveTradeContext(hier('bearish_continuation', '1d', 10, es), 30).risk).toBe('High');
    expect(deriveTradeContext(hier('reversal_risk', '1d', 10, es), 90).risk).toBe('Medium'); // floored up from Low
  });
});
