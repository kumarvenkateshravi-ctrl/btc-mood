import { afterEach, describe, expect, it } from "vitest";

import fixture from "./__fixtures__/btc-challenge-v1.golden.json";
import {
  applyFill,
  reconcile,
  type PaperFill,
  type PaperPosition,
  validateOrder,
} from "../paper";
import { intrabarSubBars } from "../replay/intrabar";
import {
  __resetReplaySessionForTest,
  configureReplaySession,
  getReplaySessionStateForTest,
  replayClose,
  replayMarketOrder,
  sessionBalance,
  setReplayActionContext,
  startReplaySession,
} from "../replaySession";
import { captureReplayDataset, clearReplayDataset } from "../replay/replayDataset";
import type { Candle } from "../types";

const MICRO = BigInt(1_000_000);

function usd(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const result = BigInt(whole || "0") * MICRO + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -result : result;
}

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * BigInt(2);
  if (doubled > denominator) return quotient + BigInt(1);
  if (doubled < denominator) return quotient;
  return quotient % BigInt(2) === BigInt(0) ? quotient : quotient + BigInt(1);
}

function commission(notional: bigint, partsPerMillion: number): bigint {
  return roundHalfEven(notional * BigInt(partsPerMillion), BigInt(1_000_000));
}

function fill(overrides: Partial<PaperFill> = {}): PaperFill {
  return {
    orderId: "order-1",
    side: "buy",
    units: 10,
    price: 100,
    feeRate: 0.001,
    fee: 1,
    ts: 1,
    leverage: 20,
    ...overrides,
  };
}

function position(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: "position-1",
    symbol: "BTCUSDT",
    side: "long",
    units: 10,
    entryPrice: 100,
    realizedPnl: -1,
    feesPaid: 1,
    openedAt: 1,
    leverage: 20,
    tp: 120,
    sl: 95,
    liquidated: false,
    trailingSl: true,
    trailingBest: 110,
    ...overrides,
  };
}

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 };
}

afterEach(() => {
  __resetReplaySessionForTest();
  clearReplayDataset();
});

describe("Task 0 BTC Challenge v1 golden contracts", () => {
  it("proves the exact round-trip ledger and margin identities", () => {
    const data = fixture.fixtures.roundTrip;
    const entryNotional = usd(data.entryNotional);
    const exitNotional = usd(data.exitNotional);
    const entryFee = commission(entryNotional, 1000);
    const exitFee = commission(exitNotional, 1000);
    const gross = usd(data.grossRealizedPnl);

    expect(entryFee).toBe(usd(data.entryCommission));
    expect(exitFee).toBe(usd(data.exitCommission));
    expect(entryFee + exitFee).toBe(usd(data.totalCommissions));
    expect(gross - entryFee - exitFee).toBe(usd(data.netRealizedPnl));
    expect(usd(data.startingCash) + gross - entryFee - exitFee).toBe(usd("10097.90"));

    for (const state of data.states) {
      expect(usd(state.cash) + usd(state.unrealizedPnl), state.at).toBe(usd(state.equity));
      expect(usd(state.equity) - usd(state.usedMargin) - usd(state.reservedMargin), state.at).toBe(
        usd(state.freeMargin),
      );
    }
  });

  it("proves deterministic half-even commission rounding at the ledger scale", () => {
    const data = fixture.fixtures.rounding;
    expect(commission(usd(data.halfwayToEvenZero.notional), data.commissionRatePartsPerMillion)).toBe(
      usd(data.halfwayToEvenZero.commission),
    );
    expect(commission(usd(data.halfwayToEvenTwo.notional), data.commissionRatePartsPerMillion)).toBe(
      usd(data.halfwayToEvenTwo.commission),
    );
  });

  it("freezes increase, partial-close, and reversal arithmetic", () => {
    const increase = fixture.fixtures.increase.expected;
    expect(usd(increase.cash) + usd(increase.unrealizedPnl)).toBe(usd(increase.equity));
    expect(usd(increase.equity) - usd(increase.usedMargin)).toBe(usd(increase.freeMargin));

    const partial = fixture.fixtures.partialClose.expected;
    expect(usd(partial.cash) + usd(partial.unrealizedPnlAt110)).toBe(usd(partial.equityAt110));
    expect(usd(partial.equityAt110) - usd(partial.usedMargin)).toBe(usd(partial.freeMarginAt110));
    expect(usd(partial.allocatedEntryCommissionClosed) + usd(partial.allocatedEntryCommissionRemaining)).toBe(
      usd(fixture.fixtures.partialClose.entry.commission),
    );

    const reversal = fixture.fixtures.reversal.expected;
    expect(usd(reversal.equity) - usd(reversal.usedMargin)).toBe(usd(reversal.freeMargin));
    expect(usd(reversal.closingCommission) + usd(reversal.newAllocatedEntryCommission)).toBe(
      usd(fixture.fixtures.reversal.reverse.commission),
    );
  });

  it("freezes UTC boundaries, drawdown floors, targets, and breach priority", () => {
    const rules = fixture.fixtures.rules;
    expect(usd(rules.daily.dayStartCash) - usd(rules.daily.allowance)).toBe(usd(rules.daily.floor));
    expect(usd(rules.phaseStartingCash) - usd(rules.maximumStatic.allowance)).toBe(
      usd(rules.maximumStatic.floor),
    );
    expect(usd(rules.maximumTrailingExample.peakEquity) - usd(rules.maximumTrailingExample.allowance)).toBe(
      usd(rules.maximumTrailingExample.floor),
    );
    expect(Math.floor(rules.boundaryTimestampSeconds / 86_400)).toBe(rules.boundaryBelongsToUtcDay);
    expect(rules.simultaneous.outcome).toBe("failed");
  });
});

describe("Task 0 legacy behavior characterization", () => {
  it("records that the shared fill kernel flattens an ordinary partial close", () => {
    const result = applyFill(
      position(),
      fill({ side: "sell", units: 4, price: 110, fee: 0.44 }),
      "BTCUSDT",
      2,
      20,
    );

    expect(result.trade?.units).toBe(4);
    expect(result.trade?.realizedPnl).toBeCloseTo(39.56, 8);
    expect(result.position.side).toBe("flat");
    expect(result.position.units).toBe(0);
    expect(result.position.realizedPnl).toBeCloseTo(38.56, 8);
  });

  it("records that legacy validation accepts off-grid BTC quantity and price", () => {
    const error = validateOrder(
      {
        id: "off-grid",
        symbol: "BTCUSDT",
        type: "limit",
        side: "buy",
        units: 0.1234567890123,
        price: 100.03,
        tp: null,
        sl: null,
        reduceOnly: false,
        postOnly: false,
        leverage: 20,
        ocoGroup: null,
        createdAt: 1,
      },
      null,
      10_000,
      100,
    );
    expect(error).toBeNull();
  });

  it("records legacy bracket carry-over on reversal", () => {
    const result = applyFill(
      position(),
      fill({ side: "sell", units: 15, price: 110, fee: 1.65 }),
      "BTCUSDT",
      2,
      20,
    );

    expect(result.position.side).toBe("short");
    expect(result.position.units).toBe(5);
    expect(result.position.sl).toBe(95);
    expect(result.position.tp).toBe(120);
    expect(result.position.trailingSl).toBe(false);
  });

  it("records the established intrabar path and same-bar exit ordering", () => {
    const up = candle(60, 100, 106, 97, 105);
    const down = candle(120, 100, 106, 97, 98.5);

    expect(intrabarSubBars(up).map((bar) => bar.close)).toEqual([100, 97, 106, 105]);
    expect(intrabarSubBars(down).map((bar) => bar.close)).toEqual([100, 106, 97, 98.5]);

    let upPosition: PaperPosition | null = position({ sl: 98, tp: 105, trailingSl: false, trailingBest: null });
    let upExit: number | undefined;
    for (const bar of intrabarSubBars(up)) {
      const result = reconcile(upPosition, bar, [], bar.time, { takerFeeRate: 0, makerFeeRate: 0 });
      upPosition = result.position?.side === "flat" ? null : result.position;
      if (result.trades[0]) { upExit = result.trades[0].exitPrice; break; }
    }

    let downPosition: PaperPosition | null = position({ sl: 98, tp: 105, trailingSl: false, trailingBest: null });
    let downExit: number | undefined;
    for (const bar of intrabarSubBars(down)) {
      const result = reconcile(downPosition, bar, [], bar.time, { takerFeeRate: 0, makerFeeRate: 0 });
      downPosition = result.position?.side === "flat" ? null : result.position;
      if (result.trades[0]) { downExit = result.trades[0].exitPrice; break; }
    }

    expect(upExit).toBe(98);
    expect(downExit).toBe(105);
  });

  it("records the optimistic legacy fill price on a gap through a protective stop", () => {
    const result = reconcile(
      position({ sl: 95, tp: null, trailingSl: false, trailingBest: null }),
      candle(60, 90, 92, 89, 91),
      [],
      60,
      { takerFeeRate: 0.001, makerFeeRate: 0.001 },
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.exitPrice).toBe(95);
    expect(fixture.fixtures.gapThroughStop.challengeV1FillPrice).toBe("90.00");
  });

  it("records that replay session balance omits the entry commission", () => {
    captureReplayDataset({
      symbol: "BTCUSDT",
      executionTf: "5m",
      candlesByTf: {
        "5m": [
          candle(0, 99.9, 100, 99, 99.9),
          candle(300, 105, 106, 104, 105),
          candle(600, 110.1, 111, 109, 110.1),
        ],
      },
    });
    startReplaySession("BTCUSDT", { startIndex: 1, executionTf: "5m" });
    configureReplaySession({
      currency: "USD",
      startBalance: 10_000,
      commissionRate: 0.001,
      leverage: 10,
      riskPct: 1,
    });

    setReplayActionContext(1, 300);
    replayMarketOrder("buy", 10, 99.9, 300, 10);
    setReplayActionContext(2, 600);
    replayClose(110.1, 600);

    const state = getReplaySessionStateForTest();
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0]?.realizedPnl).toBeCloseTo(98.9, 8);
    expect(sessionBalance(state)).toBeCloseTo(10_098.9, 8);
    expect(sessionBalance(state)).not.toBe(Number(fixture.fixtures.roundTrip.states.at(-1)?.cash));
  });
});
