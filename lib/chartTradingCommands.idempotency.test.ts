import { describe, expect, it, vi } from 'vitest';
import {
  createChartTradingCommands,
  type ChartTradingCommandContext,
  type PlaceChartOrder,
} from './chartTradingCommands';

const BTC = 'BTCUSDT';

const order = (side: 'buy' | 'sell' = 'buy'): PlaceChartOrder => ({
  symbol: BTC,
  side,
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
  let now = 1_000;
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
    now: () => now,
  });
  return {
    commands,
    live,
    replay,
    advance: (ms: number) => { now += ms; },
    setContext: (next: ChartTradingCommandContext) => { context = next; },
  };
}

describe('chart trading command idempotency', () => {
  it('accepts a BUY once and rejects an immediate duplicate instead of placing twice', () => {
    const { commands, live } = setup();

    expect(commands.submitOrder(order('buy'))).toMatchObject({ status: 'accepted' });
    expect(commands.submitOrder(order('buy'))).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/duplicate|in-flight/i) });
    expect(live.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('separates BUY and SELL while still blocking repeated SELL submissions', () => {
    const { commands, live } = setup();

    expect(commands.submitOrder(order('buy'))).toMatchObject({ status: 'accepted' });
    expect(commands.submitOrder(order('sell'))).toMatchObject({ status: 'accepted' });
    expect(commands.submitOrder(order('sell'))).toMatchObject({ status: 'rejected' });
    expect(live.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('cannot close, reverse, partially close, or repeat protection changes twice in one gesture window', () => {
    const { commands, live } = setup();

    expect(commands.close({ symbol: BTC, mark: 60_000 })).toMatchObject({ status: 'accepted' });
    expect(commands.close({ symbol: BTC, mark: 60_000 })).toMatchObject({ status: 'rejected' });
    expect(commands.partialClose({ symbol: BTC, fraction: 0.5, mark: 60_000 })).toMatchObject({ status: 'accepted' });
    expect(commands.partialClose({ symbol: BTC, fraction: 0.5, mark: 60_000 })).toMatchObject({ status: 'rejected' });
    expect(commands.reverse(order('sell'))).toMatchObject({ status: 'accepted' });
    expect(commands.reverse(order('sell'))).toMatchObject({ status: 'rejected' });
    expect(commands.setProtection({ symbol: BTC, protection: { sl: 59_000, tp: 61_000 } })).toMatchObject({ status: 'accepted' });
    expect(commands.setProtection({ symbol: BTC, protection: { sl: 59_000, tp: 61_000 } })).toMatchObject({ status: 'rejected' });

    expect(live.closePosition).toHaveBeenCalledTimes(1);
    expect(live.partialClose).toHaveBeenCalledTimes(1);
    expect(live.placeOrder).toHaveBeenCalledTimes(1);
    expect(live.updateProtection).toHaveBeenCalledTimes(1);
  });

  it('allows a deliberate identical action after the idempotency window has elapsed', () => {
    const { commands, live, advance } = setup();

    expect(commands.submitOrder(order())).toMatchObject({ status: 'accepted' });
    advance(1_000);
    expect(commands.submitOrder(order())).toMatchObject({ status: 'accepted' });
    expect(live.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('does not trap a ticket after a rejected command, so the corrected input can be resubmitted', () => {
    const { commands, live } = setup();
    live.placeOrder.mockReturnValue({ ok: false, error: 'Insufficient margin' } as { ok: boolean; error?: string });

    expect(commands.submitOrder(order())).toMatchObject({ status: 'rejected', reason: 'Insufficient margin' });
    expect(commands.submitOrder(order())).toMatchObject({ status: 'rejected', reason: 'Insufficient margin' });
    expect(live.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('reports an already-flat close rather than presenting a no-op close as accepted', () => {
    const { commands, live } = setup();
    live.closePosition.mockReturnValue({ ok: false, error: 'No active position to close' } as { ok: boolean; error?: string });

    expect(commands.close({ symbol: BTC, mark: 60_000 })).toMatchObject({ status: 'rejected', reason: 'No active position to close' });
    expect(live.closePosition).toHaveBeenCalledTimes(1);
  });

  it('resolves a changed mode and symbol before idempotency so stale callbacks cannot be accepted', () => {
    const { commands, live, setContext } = setup();
    setContext({ mode: 'replay', symbol: 'XAUUSD' });

    expect(commands.submitOrder(order())).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/stale/i) });
    expect(live.placeOrder).not.toHaveBeenCalled();
  });

  it('guards replay risk entries, pending-level updates, and trailing toggles too', () => {
    const { commands, replay } = setup({ mode: 'replay', symbol: BTC });
    const replayContext = { barIndex: 12, cutTime: 1_700_000_000 };

    expect(commands.openReplayRisk({ symbol: BTC, side: 'buy', mark: 60_000, ts: 1_700_000_000, replayContext })).toMatchObject({ status: 'accepted' });
    expect(commands.openReplayRisk({ symbol: BTC, side: 'buy', mark: 60_000, ts: 1_700_000_000, replayContext })).toMatchObject({ status: 'rejected' });
    expect(commands.setReplayPendingLevels({ symbol: BTC, sl: 59_000, tp: 61_000, replayContext })).toMatchObject({ status: 'accepted' });
    expect(commands.setReplayPendingLevels({ symbol: BTC, sl: 59_000, tp: 61_000, replayContext })).toMatchObject({ status: 'rejected' });
    expect(commands.toggleTrailing({ symbol: BTC, enabled: true, replayContext })).toMatchObject({ status: 'accepted' });
    expect(commands.toggleTrailing({ symbol: BTC, enabled: true, replayContext })).toMatchObject({ status: 'rejected' });

    expect(replay.openWithRisk).toHaveBeenCalledTimes(1);
    expect(replay.setPendingLevels).toHaveBeenCalledTimes(1);
    expect(replay.updateProtection).toHaveBeenCalledTimes(1);
  });
});
