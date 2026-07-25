import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { TradeAction } from './decisionTypes';
import { advanceTracker, barsAgoOf, DECISION_FRESHNESS, decisionFreshnessOf } from './freshness';

const bars = (n: number, startTime = 0, stepSec = 300): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: startTime + i * stepSec, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe('decisionFreshnessOf', () => {
  it('classifies by bars-ago at the tier boundaries', () => {
    expect(decisionFreshnessOf(0)).toBe('active');
    expect(decisionFreshnessOf(DECISION_FRESHNESS.activeMaxBars)).toBe('active');
    expect(decisionFreshnessOf(DECISION_FRESHNESS.activeMaxBars + 1)).toBe('aging');
    expect(decisionFreshnessOf(DECISION_FRESHNESS.agingMaxBars)).toBe('aging');
    expect(decisionFreshnessOf(DECISION_FRESHNESS.agingMaxBars + 1)).toBe('stale');
  });
});

describe('advanceTracker', () => {
  it('first observation: starts a tracker with empty history', () => {
    const t = advanceTracker(null, 'long', 1000);
    expect(t).toEqual({ action: 'long', since: 1000, history: [] });
  });

  it('same action again: returns the SAME reference (no new entry, safe as a state update)', () => {
    const t1 = advanceTracker(null, 'long', 1000);
    const t2 = advanceTracker(t1, 'long', 1300);
    expect(t2).toBe(t1);
  });

  it('action changes: records the previous action into history, resets since to the new bar', () => {
    const t1 = advanceTracker(null, 'long', 1000);
    const t2 = advanceTracker(t1, 'no_trade', 1300);
    expect(t2).toEqual({ action: 'no_trade', since: 1300, history: [{ action: 'long', barTime: 1000 }] });
  });

  it('history is capped at 5 entries, most-recent-first', () => {
    let t: ReturnType<typeof advanceTracker> | null = null;
    const actions: TradeAction[] = ['long', 'short', 'long', 'short', 'long', 'short', 'long'];
    let time = 0;
    for (const a of actions) { t = advanceTracker(t, a, time); time += 300; }
    expect(t!.history).toHaveLength(5);
    expect(t!.history[0]).toEqual({ action: 'short', barTime: 1500 }); // the most recent prior action
  });
});

describe('barsAgoOf', () => {
  it('0 when sinceTime is the last closed bar', () => {
    const arr = bars(10, 0, 300); // times 0..2700; last closed index = 8 (time 2400)
    expect(barsAgoOf(arr, 2400)).toBe(0);
  });

  it('counts closed bars strictly after sinceTime', () => {
    const arr = bars(10, 0, 300);
    expect(barsAgoOf(arr, 1800)).toBe(2); // bars at 2100(idx7), 2400(idx8) are after 1800
  });

  it('empty/too-short array → 0, never negative', () => {
    expect(barsAgoOf([], 0)).toBe(0);
    expect(barsAgoOf(bars(1), 0)).toBe(0);
  });
});
