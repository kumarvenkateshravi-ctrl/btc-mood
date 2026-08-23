import { describe, expect, it, vi } from 'vitest';
import {
  createChartTradingCommands,
  type ChartTradingCommandContext,
  type PlaceChartOrder,
} from './chartTradingCommands';

const BTC = 'BTCUSDT';
const GOLD = 'XAUUSD';

const order = (symbol = BTC): PlaceChartOrder => ({
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

function setup(initial: ChartTradingCommandContext = { mode: 'live', symbol: BTC }) {
  let context = initial;
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
  const commands = createChartTradingCommands({
    getContext: () => context,
    live,
    replay,
  });
  return {
    commands,
    live,
    replay,
    setContext: (next: ChartTradingCommandContext) => { context = next; },
  };
}

describe('chart trading command boundary', () => {
  it('reproduces the former context-menu defect as a regression: replay BUY and SELL never reach live paper', () => {
    const { commands, live } = setup({ mode: 'replay', symbol: BTC });

    expect(commands.submitOrder(order())).toMatchObject({ status: 'unsupported' });
    expect(commands.submitOrder({ ...order(), side: 'sell' })).toMatchObject({ status: 'unsupported' });
    expect(live.placeOrder).not.toHaveBeenCalled();
  });

  it('rejects the replay order ticket and quick ticket instead of routing them to live paper', () => {
    const { commands, live } = setup({ mode: 'replay', symbol: BTC });

    expect(commands.openOrderTicket(BTC)).toMatchObject({ status: 'unsupported' });
    expect(commands.submitOrder(order())).toMatchObject({ status: 'unsupported' });
    expect(live.placeOrder).not.toHaveBeenCalled();
  });

  it('routes supported replay close and overlay commands only to replay', () => {
    const { commands, live, replay } = setup({ mode: 'replay', symbol: BTC });
    const replayContext = { barIndex: 42, cutTime: 1_700_000_000 };

    expect(commands.close({ symbol: BTC, mark: 60_000, ts: 1_700_000_000, replayContext })).toMatchObject({ status: 'accepted' });
    expect(commands.setOverlay({ symbol: BTC, field: 'sl', value: 59_000, replayContext })).toMatchObject({ status: 'accepted' });

    expect(replay.setActionContext).toHaveBeenCalledWith(42, 1_700_000_000);
    expect(replay.close).toHaveBeenCalledWith(60_000, 1_700_000_000);
    expect(replay.updateProtection).toHaveBeenCalledWith({ sl: 59_000 });
    expect(live.closePosition).not.toHaveBeenCalled();
    expect(live.updateProtection).not.toHaveBeenCalled();
  });

  it('rejects replay commands that are not implemented instead of falling through to live paper', () => {
    const { commands, live } = setup({ mode: 'replay', symbol: BTC });

    expect(commands.reverse(order())).toMatchObject({ status: 'unsupported' });
    expect(live.placeOrder).not.toHaveBeenCalled();
    expect(live.partialClose).not.toHaveBeenCalled();
    expect(live.updateProtection).not.toHaveBeenCalled();
  });

  it('routes live commands only to paperStore', () => {
    const { commands, live, replay } = setup();


    expect(commands.submitOrder(order())).toMatchObject({ status: 'accepted', mode: 'live' });
    expect(commands.close({ symbol: BTC, mark: 60_000 })).toMatchObject({ status: 'accepted', mode: 'live' });
    expect(commands.setOverlay({ symbol: BTC, field: 'tp', value: 61_000 })).toMatchObject({ status: 'accepted', mode: 'live' });
    expect(commands.setProtection({ symbol: BTC, protection: { sl: 59_000, tp: 61_000 } })).toMatchObject({ status: 'accepted', mode: 'live' });

    expect(live.placeOrder).toHaveBeenCalledTimes(1);
    expect(live.closePosition).toHaveBeenCalledWith(60_000, BTC);
    expect(live.updateProtection).toHaveBeenCalledWith(BTC, { tp: 61_000 });
    expect(live.updateProtection).toHaveBeenLastCalledWith(BTC, { sl: 59_000, tp: 61_000 });
    expect(replay.close).not.toHaveBeenCalled();
    expect(replay.updateProtection).not.toHaveBeenCalled();
  });

  it('routes replay partial close only to replaySession with the current execution context', () => {
    const { commands, live, replay } = setup({ mode: 'replay', symbol: BTC });
    const replayContext = { barIndex: 42, cutTime: 1_700_000_000 };

    expect(commands.partialClose({ symbol: BTC, fraction: 0.25, mark: 60_000, ts: 1_700_000_000, replayContext }))
      .toMatchObject({ status: 'accepted', mode: 'replay' });
    expect(replay.setActionContext).toHaveBeenCalledWith(42, 1_700_000_000);
    expect(replay.partialClose).toHaveBeenCalledWith(0.25, 60_000, 1_700_000_000);
    expect(live.partialClose).not.toHaveBeenCalled();
  });

  it('routes supported replay risk entry and pending levels to replaySession', () => {
    const { commands, live, replay } = setup({ mode: 'replay', symbol: BTC });
    const replayContext = { barIndex: 8, cutTime: 1_700_000_100 };

    expect(commands.setReplayPendingLevels({ symbol: BTC, sl: 59_000, tp: 62_000, replayContext })).toMatchObject({ status: 'accepted' });
    expect(commands.openReplayRisk({ symbol: BTC, side: 'buy', mark: 60_000, ts: 1_700_000_100, replayContext })).toMatchObject({ status: 'accepted' });

    expect(replay.setPendingLevels).toHaveBeenCalledWith(59_000, 62_000);
    expect(replay.openWithRisk).toHaveBeenCalledWith('buy', 60_000, 1_700_000_100);
    expect(live.placeOrder).not.toHaveBeenCalled();
  });

  it('resolves mode at dispatch time across rapid live/replay transitions', () => {
    const { commands, live, replay, setContext } = setup({ mode: 'live', symbol: BTC });

    commands.submitOrder(order());
    setContext({ mode: 'replay', symbol: BTC });
    commands.close({ symbol: BTC, mark: 60_000, ts: 1, replayContext: { barIndex: 1, cutTime: 1 } });
    setContext({ mode: 'live', symbol: BTC });
    commands.submitOrder(order());

    expect(live.placeOrder).toHaveBeenCalledTimes(2);
    expect(replay.close).toHaveBeenCalledTimes(1);
    expect(live.closePosition).not.toHaveBeenCalled();
  });

  it('rejects a stale symbol rather than routing an old callback to either account', () => {
    const { commands, live, replay, setContext } = setup({ mode: 'live', symbol: BTC });
    setContext({ mode: 'replay', symbol: GOLD });

    expect(commands.submitOrder(order(BTC))).toMatchObject({ status: 'rejected' });
    expect(live.placeOrder).not.toHaveBeenCalled();
    expect(replay.openWithRisk).not.toHaveBeenCalled();
  });

  it('prevents delivery after final disposal and permits a fresh remount boundary', () => {
    const first = setup();
    first.commands.dispose();
    expect(first.commands.submitOrder(order())).toMatchObject({ status: 'rejected' });
    expect(first.live.placeOrder).not.toHaveBeenCalled();

    const remounted = setup({ mode: 'replay', symbol: BTC });
    expect(remounted.commands.close({ symbol: BTC, mark: 60_000, ts: 2, replayContext: { barIndex: 2, cutTime: 2 } })).toMatchObject({ status: 'accepted' });
    expect(remounted.replay.close).toHaveBeenCalledTimes(1);
  });
});
