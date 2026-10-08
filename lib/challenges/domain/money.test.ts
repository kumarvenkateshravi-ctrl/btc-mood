import { describe, expect, it } from "vitest";

import {
  addMoney,
  btcQuantityFromDecimal,
  btcQuantityToDecimal,
  decodeMoney,
  decimalText,
  encodeMoney,
  formatScaledDecimal,
  isCanonicalDecimalText,
  moneyFromDecimal,
  moneyToDecimal,
  multiplyMoneyByPpm,
  normalizeDecimalText,
  parseScaledDecimal,
  ppmFromRate,
  roundDivideHalfEven,
  subtractMoney,
} from "./money";

describe("challenge exact decimal and money primitives", () => {
  it("normalizes finite plain decimals without changing their value", () => {
    expect(normalizeDecimalText("100.00")).toBe("100");
    expect(normalizeDecimalText("-0.000")).toBe("0");
    expect(normalizeDecimalText("0.0100")).toBe("0.01");
    expect(decimalText("0.1")).toBe("0.1");
    expect(isCanonicalDecimalText("0.1")).toBe(true);
    expect(isCanonicalDecimalText("0.10")).toBe(false);
  });

  it.each([" 1", "1 ", "+1", "01", ".5", "1.", "1e3", "NaN", "Infinity"])(
    "rejects unsupported decimal syntax: %s",
    (value) => {
      expect(() => normalizeDecimalText(value)).toThrow();
    },
  );

  it("parses and formats scaled values exactly", () => {
    expect(parseScaledDecimal("100.123456", 6)).toBe(BigInt(100_123_456));
    expect(formatScaledDecimal(BigInt(100_123_456), 6)).toBe("100.123456");
    expect(formatScaledDecimal(BigInt(-500_000), 6)).toBe("-0.5");
    expect(() => parseScaledDecimal("1.0000001", 6)).toThrow();
  });

  it("rounds exact halfway ratios to the even atom for both signs", () => {
    expect(roundDivideHalfEven(BigInt(5), BigInt(2))).toBe(BigInt(2));
    expect(roundDivideHalfEven(BigInt(15), BigInt(10))).toBe(BigInt(2));
    expect(roundDivideHalfEven(BigInt(25), BigInt(10))).toBe(BigInt(2));
    expect(roundDivideHalfEven(BigInt(35), BigInt(10))).toBe(BigInt(4));
    expect(roundDivideHalfEven(BigInt(-5), BigInt(2))).toBe(BigInt(-2));
    expect(roundDivideHalfEven(BigInt(-15), BigInt(10))).toBe(BigInt(-2));
  });

  it("reproduces the approved fee-complete round trip exactly", () => {
    const startingCash = moneyFromDecimal("10000");
    const entryFee = multiplyMoneyByPpm(moneyFromDecimal("1000"), ppmFromRate("0.001"));
    const exitFee = multiplyMoneyByPpm(moneyFromDecimal("1100"), ppmFromRate("0.001"));
    const grossPnl = moneyFromDecimal("100");
    const finalCash = subtractMoney(
      addMoney(startingCash, grossPnl),
      addMoney(entryFee, exitFee),
    );

    expect(moneyToDecimal(entryFee)).toBe("1");
    expect(moneyToDecimal(exitFee)).toBe("1.1");
    expect(moneyToDecimal(finalCash)).toBe("10097.9");
  });

  it("round-trips money atoms without JSON number conversion", () => {
    const original = moneyFromDecimal("-123456789.123456");
    expect(decodeMoney(encodeMoney(original))).toBe(original);
    expect(() => decodeMoney("01")).toThrow();
    expect(() => decodeMoney("1.0")).toThrow();
  });

  it("keeps BTC storage precision separate from the executable quantity step", () => {
    const oneSatoshi = btcQuantityFromDecimal("0.00000001");
    expect(oneSatoshi).toBe(BigInt(1));
    expect(btcQuantityToDecimal(oneSatoshi)).toBe("0.00000001");
  });
});
