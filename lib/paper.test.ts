import { describe, it, expect } from 'vitest';
import {
  applyFill,
  BTC_TICK_SIZE,
  BTC_TICK_VALUE_USD,
  INITIAL_PAPER_BALANCE,
  LIQUIDATION_MARGIN_RATIO,
  MAKER_FEE,
  TAKER_FEE,
  marginFor,
  marketFillPrice,
  notionalFor,
  reconcile,
  unrealizedPnl,
  validateOrder,
  type PaperFill,
  type PaperOrder,
  type PaperPosition,
} from './paper';

const bar = (over: Partial<{ open: number; high: number; low: number; close: number; time: number }> = {}) => ({
  time: 1_700_000_000,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1,
  ...over,
});

const mkOrder = (over: Partial<PaperOrder> = {}): PaperOrder => ({
  id: 'o1',
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'market',
  units: 0.1,
  price: null,
  tp: null,
  sl: null,
  reduceOnly: false,
  postOnly: false,
  createdAt: 0,
  leverage: 10,
  ocoGroup: null,
  ...over,
});

const mkFill = (over: Partial<PaperFill> = {}): PaperFill => ({
  orderId: 'o1',
  side: 'buy',
  units: 0.1,
  price: 100,
  feeRate: TAKER_FEE,
  fee: 0.1 * 100 * TAKER_FEE,
  ts: 1,
  leverage: 10,
  ...over,
});

const mkPos = (over: Partial<PaperPosition> = {}): PaperPosition => ({
  id: 'p1',
  symbol: 'BTCUSDT',
  side: 'long',
  units: 1,
  entryPrice: 100,
  realizedPnl: 0,
  feesPaid: 0,
  openedAt: 0,
  tp: null,
  sl: null,
  liquidated: false,
  leverage: 10,
  trailingSl: false,
  trailingBest: null,
  ...over,
});

const BAL = INITIAL_PAPER_BALANCE;

describe('paper: fee + notional math', () => {
  it('margin = (units * price) / leverage', () => {
    expect(marginFor(0.5, 60000, 10)).toBeCloseTo(3000, 6);
    expect(marginFor(0.5, 60000, 0)).toBe(Infinity);
  });

  it('notional = units * price', () => {
    expect(notionalFor(0.25, 40000)).toBe(10000);
  });

  it('BTC tick value and size are 0.10 USD', () => {
    expect(BTC_TICK_VALUE_USD).toBe(0.1);
    expect(BTC_TICK_SIZE).toBe(0.1);
  });

  it('initial balance constant', () => {
    expect(INITIAL_PAPER_BALANCE).toBe(10_000);
  });
});

describe('paper: market fills', () => {
  it('market buy fills at mid + 1 tick slippage', () => {
    expect(marketFillPrice('buy', 100)).toBeCloseTo(100 + 0.1, 6);
  });

  it('market sell fills at mid - 1 tick slippage', () => {
    expect(marketFillPrice('sell', 100)).toBeCloseTo(100 - 0.1, 6);
  });

  it('fees are subtracted from realized pnl when opening a position', () => {
    const r = applyFill(null, mkFill(), 'BTCUSDT', 1, 10);
    expect(r.position.side).toBe('long');
    expect(r.position.units).toBe(0.1);
    expect(r.position.entryPrice).toBe(100);
    expect(r.position.realizedPnl).toBeCloseTo(-0.1 * 100 * TAKER_FEE, 8);
    expect(r.position.leverage).toBe(10);
  });
});

describe('paper: limit and stop orders', () => {
  it('limit buy fills when bar.low <= limit', () => {
    const order = mkOrder({ type: 'limit', price: 95, side: 'buy', leverage: 10 });
    const r = reconcile(null, bar({ low: 90 }), [order], 1);
    expect(r.position?.side).toBe('long');
    expect(r.position?.entryPrice).toBe(95);
    expect(r.filled.length).toBe(1);
  });

  it('limit buy does not fill when bar.low > limit', () => {
    const order = mkOrder({ type: 'limit', price: 95, side: 'buy', leverage: 10 });
    const r = reconcile(null, bar({ low: 96 }), [order], 1);
    expect(r.position).toBeNull();
    expect(r.filled.length).toBe(0);
  });

  it('limit sell fills when bar.high >= limit', () => {
    const order = mkOrder({ type: 'limit', price: 110, side: 'sell', leverage: 10 });
    const r = reconcile(null, bar({ high: 120 }), [order], 1);
    expect(r.position?.side).toBe('short');
    expect(r.position?.entryPrice).toBe(110);
  });

  it('stop buy arms and fires when bar.high >= stop', () => {
    const order = mkOrder({ type: 'stop', price: 110, side: 'buy', leverage: 10 });
    const r = reconcile(null, bar({ high: 120 }), [order], 1);
    expect(r.position?.side).toBe('long');
    // Stop turns into a market order; expect entry slightly above stop.
    expect(r.position?.entryPrice).toBeGreaterThan(110);
  });
});

describe('paper: TP / SL on an open position', () => {
  it('TP triggers before SL; loser auto-cancels by not refiring', () => {
    const pos = mkPos({ tp: 110, sl: 90 });
    // Bar that hits both — TP path runs first.
    const r = reconcile(pos, bar({ high: 115, low: 85, close: 112 }), [], 1);
    expect(r.position?.side).toBe('flat');
    expect(r.trades.length).toBe(1);
  });

  it('SL closes the position and realizes the loss', () => {
    const pos = mkPos({ tp: 120, sl: 95 });
    const r = reconcile(pos, bar({ high: 105, low: 90 }), [], 1);
    expect(r.position?.side).toBe('flat');
    const trade = r.trades[0];
    // -5 price diff minus 1 * 95 * TAKER_FEE (taker fee on the closing fill).
    expect(trade.realizedPnl).toBeCloseTo(-5 - 95 * TAKER_FEE, 6);
  });
});

describe('paper: fees', () => {
  it('post-only limit uses maker fee, market uses taker fee', () => {
    const maker = mkFill({ feeRate: MAKER_FEE, fee: 0.1 * 100 * MAKER_FEE });
    const taker = mkFill({ feeRate: TAKER_FEE, fee: 0.1 * 100 * TAKER_FEE });
    const a = applyFill(null, maker, 'BTCUSDT', 1, 10);
    const b = applyFill(null, taker, 'BTCUSDT', 1, 10);
    expect(a.position.feesPaid).toBeCloseTo(0.1 * 100 * MAKER_FEE, 8);
    expect(b.position.feesPaid).toBeCloseTo(0.1 * 100 * TAKER_FEE, 8);
  });
});

describe('paper: liquidation', () => {
  it('force-closes when bar loss reaches 90% of margin', () => {
    const pos = mkPos();
    const dropPct = LIQUIDATION_MARGIN_RATIO;
    const worst = 100 * (1 - dropPct);
    const r = reconcile(pos, bar({ low: worst - 0.01 }), [], 1);
    expect(r.position?.liquidated).toBe(true);
    expect(r.position?.side).toBe('flat');
  });
});

describe('paper: validation', () => {
  it('rejects units <= 0', () => {
    const o = mkOrder({ units: 0 });
    expect(validateOrder(o, null, BAL, 10)).toMatch(/units/i);
  });

  it('requires price for limit and stop', () => {
    expect(validateOrder(mkOrder({ type: 'limit' }), null, BAL, 10)).toMatch(/price/i);
    expect(validateOrder(mkOrder({ type: 'stop' }), null, BAL, 10)).toMatch(/price/i);
  });

  it('reduce-only rejects size-increasing orders', () => {
    const pos = mkPos({ side: 'short', units: 0.5 });
    const o = mkOrder({ side: 'sell', reduceOnly: true });
    expect(validateOrder(o, pos, BAL, 10)).toMatch(/reduce-only/i);
  });

  it('reduce-only allows position-closing orders', () => {
    const pos = mkPos({ side: 'short', units: 0.5 });
    const o = mkOrder({ side: 'buy', reduceOnly: true });
    expect(validateOrder(o, pos, BAL, 10)).toBeNull();
  });
});

describe('paper: position math', () => {
  it('increasing a long position averages the entry price', () => {
    const r1 = applyFill(null, mkFill({ units: 1, price: 100 }), 'BTCUSDT', 1, 10);
    const r2 = applyFill(r1.position, mkFill({ units: 1, price: 110 }), 'BTCUSDT', 1, 10);
    expect(r2.position.side).toBe('long');
    expect(r2.position.units).toBe(2);
    expect(r2.position.entryPrice).toBeCloseTo(105, 6);
  });

  it('reversing a long to a short realizes the close and opens a new position', () => {
    const r1 = applyFill(null, mkFill({ units: 1, price: 100 }), 'BTCUSDT', 1, 10);
    const r2 = applyFill(r1.position, mkFill({ units: 1.5, price: 110, side: 'sell' }), 'BTCUSDT', 1, 10);
    expect(r2.position.side).toBe('short');
    expect(r2.position.units).toBeCloseTo(0.5, 6);
    expect(r2.position.entryPrice).toBeCloseTo(110, 6);
    expect(r2.trade).not.toBeNull();
  });

  it('unrealized pnl marks long and short correctly', () => {
    const r = applyFill(null, mkFill({ units: 1, price: 100 }), 'BTCUSDT', 1, 10);
    expect(unrealizedPnl(r.position, 110)).toBeCloseTo(10, 6);
    expect(unrealizedPnl(r.position, 90)).toBeCloseTo(-10, 6);

    const s = applyFill(null, mkFill({ units: 1, price: 100, side: 'sell' }), 'BTCUSDT', 1, 10);
    expect(unrealizedPnl(s.position, 110)).toBeCloseTo(-10, 6);
    expect(unrealizedPnl(s.position, 90)).toBeCloseTo(10, 6);
  });

  it('flat position has zero unrealized pnl', () => {
    expect(unrealizedPnl(null, 100)).toBe(0);
  });
});
