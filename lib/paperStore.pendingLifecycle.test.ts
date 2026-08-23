import { beforeEach, describe, expect, it } from "vitest";
import { marginFor, TAKER_FEE } from "./paper";
import {
  __getStateForTest as __getPaperStateForTest,
  __resetForTest as __resetPaperStoreForTest,
  cancelOrder,
  closePosition,
  placeOrder,
  reconcileBar,
} from "./paperStore";

const BTC = "BTCUSDT";
const GOLD = "XAUUSD";
const INITIAL_BALANCE = 10_000;

function pending(input: Partial<Parameters<typeof placeOrder>[0]> = {}) {
  return placeOrder({
    symbol: BTC,
    side: "buy",
    type: "limit",
    units: 0.1,
    price: 64_000,
    tp: null,
    sl: null,
    reduceOnly: false,
    postOnly: false,
    leverage: 10,
    midPrice: 64_100,
    ...input,
  });
}

function bar(overrides: Partial<{ open: number; high: number; low: number; close: number; time: number }> = {}) {
  return {
    open: 64_100,
    high: 64_100,
    low: 64_000,
    close: 64_000,
    time: 1_000,
    volume: 0,
    ...overrides,
  };
}

describe("paperStore pending-order reservation and bracket lifecycle", () => {
  beforeEach(() => {
    __resetPaperStoreForTest();
  });

  it("transfers a pending limit reservation into the position without a second margin debit", () => {
    pending();
    const orderId = __getPaperStateForTest().pending[0]!.id;
    const reserved = marginFor(0.1, 64_000, 10);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE - reserved);

    reconcileBar(BTC, bar());

    const state = __getPaperStateForTest();
    expect(state.pending).toHaveLength(0);
    expect(state.positions[BTC]?.units).toBeCloseTo(0.1);
    expect(state.balance).toBeCloseTo(INITIAL_BALANCE - reserved - 0.1 * 64_000 * TAKER_FEE);
    const balanceAfterFill = state.balance;
    cancelOrder(orderId);
    expect(__getPaperStateForTest().balance).toBeCloseTo(balanceAfterFill);
  });

  it("transfers a stop reservation at its actual fill price without charging margin twice", () => {
    pending({ type: "stop", price: 64_000 });
    const actualFill = 64_000.1;
    const expected = INITIAL_BALANCE - marginFor(0.1, actualFill, 10) - 0.1 * actualFill * TAKER_FEE;

    reconcileBar(BTC, bar({ open: 63_900, high: 64_000, low: 63_900, close: 64_000 }));

    expect(__getPaperStateForTest().balance).toBeCloseTo(expected);
  });

  it("releases a cancelled reservation exactly once", () => {
    pending();
    const orderId = __getPaperStateForTest().pending[0]!.id;
    cancelOrder(orderId);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE);

    cancelOrder(orderId);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE);
  });

  it("rejects a pending order when available balance cannot cover its reservation", () => {
    const result = pending({ units: 2 });

    expect(result.ok).toBe(false);
    expect(__getPaperStateForTest().pending).toHaveLength(0);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE);
  });

  it("rejects invalid pending bracket intent before reserving margin", () => {
    const result = pending({ tp: 63_000 });

    expect(result).toMatchObject({ ok: false, error: 'Buy TP must be above the entry price.' });
    expect(__getPaperStateForTest().pending).toHaveLength(0);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE);

  });

  it("keeps reservations independent across multiple pending orders and symbols", () => {
    pending();
    pending({ price: 63_000 });
    pending({ symbol: GOLD, units: 1, price: 2_200 });
    const totalReserved = marginFor(0.1, 64_000, 10) + marginFor(0.1, 63_000, 10) + marginFor(1, 2_200, 10);
    expect(__getPaperStateForTest().balance).toBeCloseTo(INITIAL_BALANCE - totalReserved);

    reconcileBar(BTC, bar());

    const state = __getPaperStateForTest();
    expect(state.pending.filter((order) => order.symbol === GOLD)).toHaveLength(1);
    expect(state.balance).toBeCloseTo(
      INITIAL_BALANCE
        - marginFor(0.1, 64_000, 10)
        - marginFor(0.1, 63_000, 10)
        - marginFor(1, 2_200, 10)
        - 0.1 * 64_000 * TAKER_FEE,
    );
  });

  it("releases only the cancelled OCO sibling reservation when a pending entry fills", () => {
    pending({ price: 64_000, ocoGroup: "entry-oco" });
    pending({ price: 63_000, ocoGroup: "entry-oco" });

    reconcileBar(BTC, bar());

    const state = __getPaperStateForTest();
    expect(state.pending).toHaveLength(0);
    expect(state.balance).toBeCloseTo(INITIAL_BALANCE - marginFor(0.1, 64_000, 10) - 0.1 * 64_000 * TAKER_FEE);
  });

  it("attaches a pending first-entry bracket only when that entry fills", () => {
    pending({ tp: 66_000, sl: 62_000 });
    expect(__getPaperStateForTest().positions[BTC]).toBeFalsy();

    reconcileBar(BTC, bar());

    expect(__getPaperStateForTest().positions[BTC]).toMatchObject({ tp: 66_000, sl: 62_000 });
  });

  it("does not mutate a same-side position bracket until the pending add fills", () => {
    placeOrder({ symbol: BTC, side: "buy", type: "market", units: 0.1, price: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000, tp: 70_000, sl: 60_000 });
    pending({ tp: 67_000, sl: 62_000 });
    expect(__getPaperStateForTest().positions[BTC]).toMatchObject({ tp: 70_000, sl: 60_000 });

    reconcileBar(BTC, bar({ high: 65_000, low: 64_000 }));

    expect(__getPaperStateForTest().positions[BTC]).toMatchObject({ units: 0.2, tp: 67_000, sl: 62_000 });
  });

  it("applies the accepted pending bracket to a reversal, without leaking the old position bracket", () => {
    placeOrder({ symbol: BTC, side: "buy", type: "market", units: 0.1, price: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000, tp: 70_000, sl: 60_000 });
    pending({ side: "sell", units: 0.2, price: 66_000, tp: 65_000, sl: 67_000 });
    expect(__getPaperStateForTest().positions[BTC]).toMatchObject({ tp: 70_000, sl: 60_000 });

    reconcileBar(BTC, bar({ open: 65_500, high: 66_000, low: 65_500, close: 66_000 }));

    expect(__getPaperStateForTest().balance).toBeCloseTo(
      INITIAL_BALANCE - 0.1 * 65_000.1 * TAKER_FEE
        + (66_000 - 65_000.1) * 0.1 - 0.2 * 66_000 * TAKER_FEE
        - marginFor(0.1, 66_000, 10),
    );
    expect(__getPaperStateForTest().positions[BTC]).toMatchObject({ side: "short", units: 0.1, tp: 65_000, sl: 67_000 });
  });

  it("keeps reduce-only bracket intent out of the resulting trade", () => {
    placeOrder({ symbol: BTC, side: "buy", type: "market", units: 0.1, price: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000, tp: 70_000, sl: 60_000 });
    pending({ side: "sell", units: 0.1, price: 66_000, reduceOnly: true, tp: 64_000, sl: 67_000 });
    expect(__getPaperStateForTest().pending).toHaveLength(1);

    reconcileBar(BTC, bar({ open: 65_500, high: 66_000, low: 65_500, close: 66_000 }));

    expect(__getPaperStateForTest().positions[BTC]).toBeFalsy();
    expect(__getPaperStateForTest().trades[0]).toMatchObject({ tp: 70_000, sl: 60_000 });
  });

  it("reconciles margin, realized P&L, and trade history after the resulting position closes", () => {
    pending();
    reconcileBar(BTC, bar());
    closePosition(65_000, BTC);

    const entryFee = 0.1 * 64_000 * TAKER_FEE;
    const exitPrice = 64_999.9;
    const exitFee = 0.1 * exitPrice * TAKER_FEE;
    const realizedPnl = (exitPrice - 64_000) * 0.1;
    const state = __getPaperStateForTest();
    expect(state.positions[BTC]).toBeFalsy();
    expect(state.pending).toHaveLength(0);
    expect(state.trades).toHaveLength(1);
    expect(state.balance).toBeCloseTo(INITIAL_BALANCE + realizedPnl - entryFee - exitFee);
  });
});
