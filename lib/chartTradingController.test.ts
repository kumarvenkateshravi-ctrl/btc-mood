import { describe, expect, it, vi } from 'vitest';
import {
  createChartTradingController,
  type ChartTradingControllerSession,
} from './chartTradingController';
import type { PlaceChartOrder } from './chartTradingCommands';

const order = (symbol = 'BTCUSDT'): PlaceChartOrder => ({
  symbol,
  side: 'buy',
  type: 'market',
  units: 0.1,
  price: null,
  tp: null,
  sl: null,
  reduceOnly: false,
  postOnly: false,
  leverage: 10,
  midPrice: 60_000,
});

function setup(initial: ChartTradingControllerSession = { mode: 'live', symbol: 'BTCUSDT' }) {
  let session = initial;
  const live = {
    placeOrder: vi.fn(() => ({ ok: true })),
    closePosition: vi.fn(() => ({ ok: true })),
    updateProtection: vi.fn(() => ({ ok: true })),
    partialClose: vi.fn(() => ({ ok: true })),
  };
  const replay = {
    setActionContext: vi.fn(),
    setPendingLevels: vi.fn(),
    openWithRisk: vi.fn(() => ({ ok: true })),
    updateProtection: vi.fn(() => ({ ok: true })),
    close: vi.fn(() => ({ ok: true })),
    partialClose: vi.fn(() => ({ ok: true })),
  };
  const controller = createChartTradingController({
    getSession: () => session,
    live,
    replay,
  });
  return {
    controller,
    live,
    replay,
    setSession(next: ChartTradingControllerSession) { session = next; },
  };
}

describe('single chart trading controller composition root', () => {
  it('routes current live and replay commands through one controller reference', () => {
    const root = setup();
    const sameReference = root.controller;

    expect(sameReference.submitOrder(order())).toMatchObject({ status: 'accepted', mode: 'live' });
    root.setSession({ mode: 'replay', symbol: 'BTCUSDT' });
    expect(sameReference.submitOrder(order())).toMatchObject({ status: 'unsupported', mode: 'replay' });
    expect(sameReference.close({ symbol: 'BTCUSDT', mark: 60_000, ts: 2, replayContext: { barIndex: 2, cutTime: 2 } }))
      .toMatchObject({ status: 'accepted', mode: 'replay' });

    expect(root.live.placeOrder).toHaveBeenCalledTimes(1);
    expect(root.replay.close).toHaveBeenCalledTimes(1);
  });

  it('rejects stale symbol callbacks without touching either owner', () => {
    const root = setup();
    root.setSession({ mode: 'live', symbol: 'XAUUSD' });

    expect(root.controller.submitOrder(order('BTCUSDT'))).toMatchObject({ status: 'rejected' });
    expect(root.live.placeOrder).not.toHaveBeenCalled();
    expect(root.replay.openWithRisk).not.toHaveBeenCalled();
  });

  it('disposes the old session controller so replacement cannot reuse stale callbacks', () => {
    const first = setup();
    first.controller.dispose();
    expect(first.controller.submitOrder(order())).toMatchObject({ status: 'rejected', mode: null });

    const replacement = setup({ mode: 'replay', symbol: 'BTCUSDT' });
    expect(replacement.controller.close({
      symbol: 'BTCUSDT',
      mark: 60_000,
      ts: 3,
      replayContext: { barIndex: 3, cutTime: 3 },
    })).toMatchObject({ status: 'accepted', mode: 'replay' });
    expect(first.live.placeOrder).not.toHaveBeenCalled();
    expect(replacement.replay.close).toHaveBeenCalledTimes(1);
  });

  it('preserves unsupported replay actions and idempotency on the shared reference', () => {
    const root = setup({ mode: 'replay', symbol: 'BTCUSDT' });
    expect(root.controller.reverse(order())).toMatchObject({ status: 'unsupported' });
    expect(root.controller.reverse(order())).toMatchObject({ status: 'unsupported' });
    expect(root.live.placeOrder).not.toHaveBeenCalled();
  });
});
