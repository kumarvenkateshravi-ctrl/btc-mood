import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from './types';
import {
  __getReplayActionJournalForTest,
  __resetReplaySessionForTest,
  configureReplaySession,
  getReplaySessionStateForTest,
  rebuildReplaySessionAt,
  replayOpenWithRisk,
  replayPartialClose,
  replayReconcileBar,
  replayUpdateProtection,
  setPendingLevels,
  sessionBalance,
  setReplayActionContext,
  startReplaySession,
} from './replaySession';
import { __getStateForTest, __resetForTest } from './paperStore';
import { captureReplayDataset, clearReplayDataset } from './replay/replayDataset';
import { marginFor } from './paper';

const BTC = 'BTCUSDT';
const config = { currency: 'USD' as const, startBalance: 10_000, commissionRate: 0.001, leverage: 1 as const, riskPct: 1 };
const bars: Candle[] = [
  { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time: 300, open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time: 600, open: 100, high: 110, low: 100, close: 109, volume: 1 },
  { time: 900, open: 109, high: 115, low: 108, close: 114, volume: 1 },
  { time: 1200, open: 114, high: 114, low: 90, close: 91, volume: 1 },
  { time: 1500, open: 91, high: 92, low: 85, close: 86, volume: 1 },
];

function start(side: 'buy' | 'sell' = 'buy') {
  captureReplayDataset({ symbol: BTC, executionTf: '5m', candlesByTf: { '5m': bars } });
  startReplaySession(BTC, { startIndex: 1, executionTf: '5m' });
  setReplayActionContext(1, bars[1].time);
  configureReplaySession(config);
  setPendingLevels(side === 'buy' ? 90 : 110, side === 'buy' ? 130 : 70);
  expect(replayOpenWithRisk(side, bars[1].close, bars[1].time).ok).toBe(true);
}

describe('replay partial close lifecycle', () => {
  beforeEach(() => {
    __resetReplaySessionForTest();
    __resetForTest();
    clearReplayDataset();
  });

  it('closes 25% of a long with configured commission while preserving quantity, TP/SL, and trailing state', () => {
    start('buy');
    expect(replayUpdateProtection({ sl: 90, tp: 130, trailingSl: true })).toEqual({ ok: true });

    expect(replayPartialClose(0.25, 110, 301)).toEqual({ ok: true });
    const session = getReplaySessionStateForTest();
    expect(session.position).toMatchObject({
      side: 'long', units: 7.5, sl: 90, tp: 130, trailingSl: true, trailingBest: 100.1,
    });
    expect(session.trades).toHaveLength(1);
    expect(session.trades[0]).toMatchObject({ units: 2.5, direction: 'long', exitPrice: 109.9 });
    expect(session.trades[0].fee).toBeCloseTo(0.27475);
    expect(session.trades[0].realizedPnl).toBeCloseTo(24.22525);
    expect(marginFor(session.position!.units, session.position!.entryPrice, session.position!.leverage))
      .toBeCloseTo(marginFor(10, session.position!.entryPrice, session.position!.leverage) * 0.75);
  });

  it('closes 50% of a short with the same fractional quantity and commission semantics', () => {
    start('sell');

    expect(replayPartialClose(0.5, 90, 301)).toEqual({ ok: true });
    const session = getReplaySessionStateForTest();
    expect(session.position).toMatchObject({ side: 'short', units: 5, sl: 110, tp: 70 });
    expect(session.trades[0]).toMatchObject({ units: 5, direction: 'short', exitPrice: 90.1 });
    expect(session.trades[0].fee).toBeCloseTo(0.4505);
    expect(session.trades[0].realizedPnl).toBeCloseTo(48.5495);
  });

  it('supports multiple sequential partial closes and a final full close with exact trade history', () => {
    start('buy');

    expect(replayPartialClose(0.25, 110, 301)).toEqual({ ok: true });
    expect(replayPartialClose(0.5, 112, 302)).toEqual({ ok: true });
    expect(getReplaySessionStateForTest().position).toMatchObject({ units: 3.75 });
    expect(replayPartialClose(1, 115, 303)).toEqual({ ok: true });

    const session = getReplaySessionStateForTest();
    expect(session.position).toBeNull();
    expect(session.trades).toHaveLength(3);
    expect(session.behaviors).toHaveLength(1);
    expect(session.behaviors[0]).toMatchObject({ exitKind: 'manual' });
    expect(session.behaviors[0].realizedPnl)
      .toBeCloseTo(session.trades.reduce((total, trade) => total + trade.realizedPnl, 0));
    expect(sessionBalance(session))
      .toBeCloseTo(config.startBalance + session.trades.reduce((total, trade) => total + trade.realizedPnl, 0));
  });

  it('reconstructs pre/post partial states exactly and branches by discarding future partial actions', () => {
    start('buy');
    replayReconcileBar(bars[2]);
    setReplayActionContext(2, bars[2].time);
    expect(replayPartialClose(0.25, 109, bars[2].time)).toEqual({ ok: true });
    const afterFirstPartial = getReplaySessionStateForTest();

    replayReconcileBar(bars[3]);
    setReplayActionContext(3, bars[3].time);
    expect(replayPartialClose(0.5, 114, bars[3].time)).toEqual({ ok: true });
    expect(rebuildReplaySessionAt(2)).toBe(true);
    expect(getReplaySessionStateForTest()).toEqual(afterFirstPartial);
    expect(__getReplayActionJournalForTest().some((action) => action.kind === 'partial-close' && action.barIndex === 3)).toBe(false);

    expect(replayPartialClose(0.5, 111, bars[2].time)).toEqual({ ok: true });
    expect(__getReplayActionJournalForTest().at(-1)).toMatchObject({ kind: 'partial-close', barIndex: 2 });
  });

  it('rebuilds trailing enable, ratchet, disable, and eventual stop execution without touching live paper', () => {
    const liveBefore = structuredClone(__getStateForTest());
    start('buy');
    expect(replayUpdateProtection({ sl: 95, trailingSl: true })).toEqual({ ok: true });
    replayReconcileBar(bars[2]);
    const ratcheted = getReplaySessionStateForTest();
    expect(ratcheted.position!.sl).toBeGreaterThan(95);

    setReplayActionContext(2, bars[2].time);
    expect(replayUpdateProtection({ trailingSl: false })).toEqual({ ok: true });
    const disabled = getReplaySessionStateForTest();
    expect(disabled.position).toMatchObject({ trailingSl: false, trailingBest: null });
    expect(rebuildReplaySessionAt(2)).toBe(true);
    expect(getReplaySessionStateForTest()).toEqual(disabled);

    // Re-enable with a valid fresh stop; the following immutable bars ratchet
    // then execute the trailing SL. Rebuild must produce the same close.
    expect(replayUpdateProtection({ sl: 95, trailingSl: true })).toEqual({ ok: true });
    replayReconcileBar(bars[3]);
    replayReconcileBar(bars[4]);
    const stopped = getReplaySessionStateForTest();
    expect(stopped.position).toBeNull();
    expect(stopped.trades[0]).toMatchObject({ direction: 'long' });
    expect(rebuildReplaySessionAt(4)).toBe(true);
    expect(getReplaySessionStateForTest()).toEqual(stopped);
    expect(__getStateForTest()).toEqual(liveBefore);
  });
});
