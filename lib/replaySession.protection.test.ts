import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from './types';
import {
  __getReplayActionJournalForTest,
  __resetReplaySessionForTest,
  configureReplaySession,
  getReplaySessionStateForTest,
  rebuildReplaySessionAt,
  replayOpenWithRisk,
  replayReconcileBar,
  replayUpdateProtection,
  setPendingLevels,
  setReplayActionContext,
  startReplaySession,
} from './replaySession';
import { __getStateForTest, __resetForTest } from './paperStore';
import { captureReplayDataset, clearReplayDataset } from './replay/replayDataset';

const config = { currency: 'USD' as const, startBalance: 10_000, commissionRate: 0.0005, leverage: 1 as const, riskPct: 1 };
const bars: Candle[] = [
  { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time: 300, open: 100, high: 120, low: 80, close: 100, volume: 1 },
  { time: 600, open: 100, high: 105, low: 104, close: 105, volume: 1 },
  { time: 900, open: 105, high: 106, low: 105, close: 106, volume: 1 },
  { time: 1200, open: 106, high: 106, low: 94, close: 95, volume: 1 },
];

function start() {
  captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: { '5m': bars } });
  startReplaySession('BTCUSDT', { startIndex: 1, executionTf: '5m' });
  setReplayActionContext(1, bars[1].time);
  configureReplaySession(config);
  setPendingLevels(90, 130);
  expect(replayOpenWithRisk('buy', bars[1].close, bars[1].time).ok).toBe(true);
}

describe('replay atomic protection updates', () => {
  beforeEach(() => {
    __resetReplaySessionForTest();
    __resetForTest();
    clearReplayDataset();
  });

  it('rejects invalid protection atomically without journaling or changing the replay position', () => {
    start();
    const before = getReplaySessionStateForTest().position;
    const actions = __getReplayActionJournalForTest();

    expect(replayUpdateProtection({ sl: 101, tp: 99 })).toMatchObject({ ok: false });
    expect(getReplaySessionStateForTest().position).toEqual(before);
    expect(__getReplayActionJournalForTest()).toEqual(actions);
  });

  it('journals accepted protection and trailing changes, then reconstructs them exactly after rewind', () => {
    start();
    replayReconcileBar(bars[2]);
    setReplayActionContext(2, bars[2].time);
    expect(replayUpdateProtection({ sl: 95, tp: 125, trailingSl: true })).toEqual({ ok: true });
    setReplayActionContext(3, bars[3].time);
    replayReconcileBar(bars[3]);
    const atThree = getReplaySessionStateForTest();

    replayReconcileBar(bars[4]);
    expect(rebuildReplaySessionAt(3)).toBe(true);

    expect(getReplaySessionStateForTest()).toEqual(atThree);
    expect(__getReplayActionJournalForTest().at(-1)).toMatchObject({ kind: 'protection', sl: 95, tp: 125, trailingSl: true });
  });

  it('does not let a same-cut trailing/protection update consume movement already used by that candle', () => {
    start();
    replayReconcileBar(bars[2]);
    setReplayActionContext(2, bars[2].time);
    expect(replayUpdateProtection({ sl: 95, trailingSl: true })).toEqual({ ok: true });

    // The high of bar 2 was already consumed. The new trail begins at entry,
    // rather than retroactively moving to 99.9 from that earlier high of 105.
    expect(getReplaySessionStateForTest().position).toMatchObject({ sl: 95, trailingBest: 100.1 });
    replayReconcileBar(bars[3]);
    const afterNewMovement = getReplaySessionStateForTest().position;
    expect(afterNewMovement).toMatchObject({ trailingBest: 106 });
    expect(afterNewMovement!.sl).toBeGreaterThan(95);

    expect(rebuildReplaySessionAt(3)).toBe(true);
    expect(getReplaySessionStateForTest().position).toEqual(afterNewMovement);
  });

  it('keeps live paper state isolated from replay protection updates', () => {
    const liveBefore = structuredClone(__getStateForTest());
    start();
    replayUpdateProtection({ sl: 95, tp: 125, trailingSl: true });

    expect(__getStateForTest()).toEqual(liveBefore);
  });
});
