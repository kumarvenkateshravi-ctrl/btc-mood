import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from './types';
import {
  __getReplayActionJournalForTest,
  __resetReplaySessionForTest,
  configureReplaySession,
  getReplaySessionStateForTest,
  rebuildReplaySessionAt,
  replayClose,
  replayOpenWithRisk,
  replayReconcileBar,
  replaySetOverlay,
  setPendingLevels,
  setReplayActionContext,
  startReplaySession,
} from './replaySession';
import { __getStateForTest, __resetForTest } from './paperStore';
import { captureReplayDataset, clearReplayDataset } from './replay/replayDataset';

const candle = (index: number): Candle => {
  const close = 100 + index * 0.02;
  return { time: index * 300, open: close - 0.1, high: close + 0.4, low: close - 0.4, close, volume: 10 };
};

const bars = Array.from({ length: 805 }, (_, index) => candle(index));
const config = { currency: 'USD' as const, startBalance: 10_000, commissionRate: 0.0005, leverage: 1 as const, riskPct: 1 };

function stableSession() {
  const session = getReplaySessionStateForTest();
  return {
    ...session,
    position: session.position ? { ...session.position } : null,
    trades: session.trades.map((trade) => ({ ...trade })),
    behaviors: session.behaviors.map((behavior) => ({ ...behavior })),
    openBehavior: session.openBehavior ? { ...session.openBehavior } : null,
  };
}

function start() {
  captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: { '5m': bars } });
  startReplaySession('BTCUSDT', { startIndex: 1, executionTf: '5m' });
  setReplayActionContext(1, bars[1].time);
  configureReplaySession(config);
  setPendingLevels(90, 130);
  expect(replayOpenWithRisk('buy', bars[1].close, bars[1].time).ok).toBe(true);
}

function reconcileThrough(target: number) {
  for (let index = 2; index <= target; index++) {
    setReplayActionContext(index, bars[index].time);
    replayReconcileBar(bars[index]);
  }
}

describe('deterministic backward replay', () => {
  beforeEach(() => {
    __resetReplaySessionForTest();
    __resetForTest();
    clearReplayDataset();
  });

  it('journals only accepted state-changing replay actions', () => {
    start();
    const accepted = __getReplayActionJournalForTest();
    expect(accepted.map((action) => action.kind)).toEqual(['configure', 'pending', 'risk-open']);

    expect(replayOpenWithRisk('sell', bars[1].close, bars[1].time).blocked).toBe('position-open');
    expect(__getReplayActionJournalForTest()).toEqual(accepted);
  });

  it('rebuilds candle 500 to exactly its original state after playback reaches 800', () => {
    start();
    reconcileThrough(500);
    const at500 = stableSession();
    reconcileThrough(800);

    rebuildReplaySessionAt(500);

    expect(stableSession()).toEqual(at500);
  });

  it('restores an open position and removes trades/actions created after the target', () => {
    start();
    reconcileThrough(500);
    const positionAt500 = stableSession().position;
    setReplayActionContext(700, bars[700].time);
    replayClose(bars[700].close, bars[700].time);
    expect(getReplaySessionStateForTest().trades).toHaveLength(1);

    rebuildReplaySessionAt(500);

    expect(stableSession().position).toEqual(positionAt500);
    expect(getReplaySessionStateForTest().trades).toEqual([]);
    expect(__getReplayActionJournalForTest().every((action) => action.barIndex <= 500)).toBe(true);
  });

  it('branches deterministically when a new action is accepted after rewind', () => {
    start();
    reconcileThrough(500);
    setReplayActionContext(700, bars[700].time);
    replayClose(bars[700].close, bars[700].time);
    rebuildReplaySessionAt(500);
    setReplayActionContext(500, bars[500].time);
    replaySetOverlay('tp', 140);

    const actions = __getReplayActionJournalForTest();
    expect(actions.some((action) => action.barIndex === 700)).toBe(false);
    expect(actions.at(-1)).toMatchObject({ kind: 'overlay', barIndex: 500, field: 'tp', value: 140 });
  });

  it('gives identical scripts identical state and deterministic position/trade IDs', () => {
    const run = () => {
      start();
      reconcileThrough(20);
      setReplayActionContext(20, bars[20].time);
      replayClose(bars[20].close, bars[20].time);
      return stableSession();
    };

    const first = run();
    __resetReplaySessionForTest();
    clearReplayDataset();
    const second = run();

    expect(second).toEqual(first);
    expect(second.trades[0]?.id).toMatch(/^t_rsClose_action_/);
  });

  it('does not let a newly placed TP/SL consume the current bar retroactively', () => {
    const current: Candle = { time: 300, open: 100, high: 120, low: 80, close: 100, volume: 10 };
    const next: Candle = { time: 600, open: 100, high: 121, low: 99, close: 120, volume: 10 };
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: { '5m': [bars[0], current, next] } });
    startReplaySession('BTCUSDT', { startIndex: 1, executionTf: '5m' });
    setReplayActionContext(1, current.time);
    configureReplaySession(config);
    setPendingLevels(90, 110);
    expect(replayOpenWithRisk('buy', current.close, current.time).ok).toBe(true);

    expect(getReplaySessionStateForTest().position).not.toBeNull();
    setReplayActionContext(2, next.time);
    replayReconcileBar(next);
    expect(getReplaySessionStateForTest().trades).toHaveLength(1);
  });

  it('never mutates the live paper account and reconstructs only the captured snapshot', () => {
    const liveBefore = structuredClone(__getStateForTest());
    start();
    reconcileThrough(800);
    rebuildReplaySessionAt(500);

    expect(__getStateForTest()).toEqual(liveBefore);
  });

  it('keeps execution state unchanged when another snapshot timeframe is viewed', () => {
    const visual = bars.map((bar, index) => ({ ...bar, time: index * 900, close: 500 + index }));
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: { '5m': bars, '15m': visual } });
    startReplaySession('BTCUSDT', { startIndex: 1, executionTf: '5m' });
    setReplayActionContext(1, bars[1].time);
    configureReplaySession(config);
    setPendingLevels(90, 130);
    replayOpenWithRisk('buy', bars[1].close, bars[1].time);
    reconcileThrough(500);
    const executionState = stableSession();

    // Rebuild obtains only the frozen 5m execution series, never visual bars.
    expect(rebuildReplaySessionAt(500)).toBe(true);
    expect(stableSession()).toEqual(executionState);
  });

  it('contains no random or wall-clock replay ID generation', () => {
    const source = readFileSync('lib/replaySession.ts', 'utf8');
    expect(source).not.toMatch(/Math\\.random|Date\\.now/);
  });
});
