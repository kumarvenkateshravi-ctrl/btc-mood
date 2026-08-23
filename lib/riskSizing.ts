import { marginFor, type Side } from './paper';

export type EntryValidationReason =
  | 'invalid-side'
  | 'invalid-entry-price'
  | 'invalid-stop-price'
  | 'invalid-units'
  | 'invalid-capital'
  | 'invalid-risk-pct'
  | 'invalid-leverage'
  | 'no-stop'
  | 'stop-on-wrong-side'
  | 'insufficient-margin';

export type EntryValidationResult =
  | { ok: true }
  | { ok: false; reason: EntryValidationReason };

export interface EntryValidationInput {
  side: Side;
  /** Expected execution price: live uses its fill price; replay uses its mark. */
  entryPrice: number;
  /** Null is allowed for explicit-unit live entries, but never for risk sizing. */
  stopPrice: number | null;
  units: number;
  equity: number;
  leverage: number;
  /** Whether a stop is mandatory for the caller. */
  requireStop?: boolean;
}

export interface RiskSizingInput {
  side: Side;
  entryPrice: number;
  stopPrice: number | null;
  equity: number;
  riskPct: number;
  leverage: number;
}

export interface RiskSizingResult {
  ok: boolean;
  units: number;
  riskAmount: number;
  margin: number;
  /** 'bad-input' is retained for replay-session lifecycle rejections. */
  reason: 'ok' | EntryValidationReason | 'bad-input';
}

const failure = (reason: EntryValidationReason): EntryValidationResult => ({ ok: false, reason });

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Shared pure pre-trade validation. It deliberately does not alter any fill,
 * fee, slippage, or P&L formula: callers supply the exact execution reference
 * that their existing engine uses.
 */
export function validateEntry(input: EntryValidationInput): EntryValidationResult {
  if (input.side !== 'buy' && input.side !== 'sell') return failure('invalid-side');
  if (!isFinitePositive(input.entryPrice)) return failure('invalid-entry-price');
  if (!isFinitePositive(input.units)) return failure('invalid-units');
  if (!isFinitePositive(input.equity)) return failure('invalid-capital');
  if (!isFinitePositive(input.leverage)) return failure('invalid-leverage');

  if (input.stopPrice == null) {
    if (input.requireStop) return failure('no-stop');
  } else {
    if (!isFinitePositive(input.stopPrice)) return failure('invalid-stop-price');
    if (input.side === 'buy' ? input.stopPrice >= input.entryPrice : input.stopPrice <= input.entryPrice) {
      return failure('stop-on-wrong-side');
    }
  }

  const margin = marginFor(input.units, input.entryPrice, input.leverage);
  if (!Number.isFinite(margin) || margin > input.equity * (1 + 1e-9)) return failure('insufficient-margin');
  return { ok: true };
}

/**
 * The replay/session sizing rule: risk amount divided by loss per unit.
 * The amount is intentionally based on the supplied equity and retains the
 * platform's existing leverage-only margin calculation.
 */
export function sizeRiskPosition(input: RiskSizingInput): RiskSizingResult {
  const none = (reason: Exclude<RiskSizingResult['reason'], 'ok'>): RiskSizingResult => ({
    ok: false, units: 0, riskAmount: 0, margin: 0, reason,
  });

  if (input.side !== 'buy' && input.side !== 'sell') return none('invalid-side');
  if (!isFinitePositive(input.entryPrice)) return none('invalid-entry-price');
  if (!isFinitePositive(input.equity)) return none('invalid-capital');
  if (!isFinitePositive(input.leverage)) return none('invalid-leverage');
  if (!isFinitePositive(input.riskPct)) return none('invalid-risk-pct');
  if (input.stopPrice == null) return none('no-stop');
  if (!isFinitePositive(input.stopPrice)) return none('invalid-stop-price');
  if (input.side === 'buy' ? input.stopPrice >= input.entryPrice : input.stopPrice <= input.entryPrice) return none('stop-on-wrong-side');

  const riskAmount = (input.equity * input.riskPct) / 100;
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return none('stop-on-wrong-side');
  const units = riskAmount / stopDistance;
  if (!isFinitePositive(units)) return none('invalid-units');
  const margin = marginFor(units, input.entryPrice, input.leverage);
  if (!Number.isFinite(margin) || margin > input.equity * (1 + 1e-9)) return none('insufficient-margin');
  return { ok: true, units, riskAmount, margin, reason: 'ok' };
}
