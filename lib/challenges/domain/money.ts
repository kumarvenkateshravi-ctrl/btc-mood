import type { BtcQuantity, DecimalText, Money, Ppm } from "./types";

export const USD_MICRO_SCALE = 6;
export const BTC_INTERNAL_QUANTITY_SCALE = 8;
export const PARTS_PER_MILLION_SCALE = 6;
export const MAX_DECIMAL_DIGITS = 60;

export type DecimalRoundingMode = "reject" | "halfEven";

const DECIMAL_SYNTAX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError("Scale must be an integer from 0 through 18.");
  }
}

function pow10(scale: number): bigint {
  assertScale(scale);
  return BigInt(10) ** BigInt(scale);
}

export function normalizeDecimalText(value: string): DecimalText {
  if (typeof value !== "string" || value.trim() !== value || !DECIMAL_SYNTAX.test(value)) {
    throw new TypeError("Decimal text must use plain base-10 notation without whitespace or exponents.");
  }
  const digitCount = value.replace(/[-.]/g, "").length;
  if (digitCount > MAX_DECIMAL_DIGITS) {
    throw new RangeError(`Decimal text exceeds the ${MAX_DECIMAL_DIGITS}-digit limit.`);
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const normalized = trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole;
  return (normalized === "0" ? "0" : negative ? `-${normalized}` : normalized) as DecimalText;
}

export function isCanonicalDecimalText(value: string): value is DecimalText {
  try {
    return normalizeDecimalText(value) === value;
  } catch {
    return false;
  }
}

export function decimalText(value: string): DecimalText {
  const normalized = normalizeDecimalText(value);
  if (normalized !== value) {
    throw new TypeError(`Decimal text is not canonical; use "${normalized}".`);
  }
  return normalized;
}

export function roundDivideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) throw new RangeError("Denominator must not be zero.");

  const negative = (numerator < BigInt(0)) !== (denominator < BigInt(0));
  const positiveNumerator = numerator < BigInt(0) ? -numerator : numerator;
  const positiveDenominator = denominator < BigInt(0) ? -denominator : denominator;
  const quotient = positiveNumerator / positiveDenominator;
  const remainder = positiveNumerator % positiveDenominator;
  const doubled = remainder * BigInt(2);

  let rounded = quotient;
  if (
    doubled > positiveDenominator ||
    (doubled === positiveDenominator && quotient % BigInt(2) !== BigInt(0))
  ) {
    rounded += BigInt(1);
  }
  return negative ? -rounded : rounded;
}

export function parseScaledDecimal(
  value: string,
  scale: number,
  rounding: DecimalRoundingMode = "reject",
): bigint {
  assertScale(scale);
  const normalized = normalizeDecimalText(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const unit = pow10(scale);

  if (fraction.length <= scale) {
    const atoms =
      BigInt(whole) * unit +
      BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
    return negative ? -atoms : atoms;
  }

  if (rounding === "reject") {
    throw new RangeError(`Decimal has more than ${scale} fractional digits.`);
  }

  const allDigits = BigInt(whole + fraction);
  const divisor = pow10(fraction.length - scale);
  const rounded = roundDivideHalfEven(allDigits, divisor);
  return negative ? -rounded : rounded;
}

export function formatScaledDecimal(value: bigint, scale: number): DecimalText {
  assertScale(scale);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  if (scale === 0) return (negative ? `-${absolute}` : `${absolute}`) as DecimalText;

  const raw = absolute.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  const unsigned = fraction ? `${whole}.${fraction}` : whole;
  return (absolute === BigInt(0) ? "0" : negative ? `-${unsigned}` : unsigned) as DecimalText;
}

export function moneyFromDecimal(value: string): Money {
  return parseScaledDecimal(value, USD_MICRO_SCALE) as Money;
}

export function moneyFromAtoms(value: bigint): Money {
  return value as Money;
}

export function moneyToDecimal(value: Money): DecimalText {
  return formatScaledDecimal(value, USD_MICRO_SCALE);
}

export function encodeMoney(value: Money): string {
  return value.toString();
}

export function decodeMoney(value: string): Money {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("Encoded money must be a canonical integer string.");
  }
  return BigInt(value) as Money;
}

export function ppmFromRate(value: string): Ppm {
  const result = parseScaledDecimal(value, PARTS_PER_MILLION_SCALE);
  if (result < BigInt(0) || result > BigInt(1_000_000)) {
    throw new RangeError("Rate must be between 0 and 1 inclusive.");
  }
  return result as Ppm;
}

export function ppmToRate(value: Ppm): DecimalText {
  return formatScaledDecimal(value, PARTS_PER_MILLION_SCALE);
}

export function multiplyMoneyByPpm(value: Money, rate: Ppm): Money {
  return roundDivideHalfEven(value * rate, BigInt(1_000_000)) as Money;
}

export function moneyFromRatio(numerator: bigint, denominator: bigint): Money {
  return roundDivideHalfEven(numerator, denominator) as Money;
}

export function addMoney(...values: readonly Money[]): Money {
  return values.reduce<bigint>((total, value) => total + value, BigInt(0)) as Money;
}

export function subtractMoney(left: Money, right: Money): Money {
  return (left - right) as Money;
}

export function btcQuantityFromDecimal(value: string): BtcQuantity {
  return parseScaledDecimal(value, BTC_INTERNAL_QUANTITY_SCALE) as BtcQuantity;
}

export function btcQuantityToDecimal(value: BtcQuantity): DecimalText {
  return formatScaledDecimal(value, BTC_INTERNAL_QUANTITY_SCALE);
}
