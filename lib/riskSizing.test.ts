import { describe, expect, it } from 'vitest';
import { sizeRiskPosition, validateEntry } from './riskSizing';
import { DEFAULT_SESSION_CONFIG, positionSizeFor } from './replay/sessionSim';

describe('shared entry validation', () => {
  it('accepts finite positive long and short entries with stops on the loss side', () => {
    expect(validateEntry({ side: 'buy', entryPrice: 100, stopPrice: 95, units: 2, leverage: 5, equity: 1_000 })).toEqual({ ok: true });
    expect(validateEntry({ side: 'sell', entryPrice: 100, stopPrice: 105, units: 2, leverage: 5, equity: 1_000 })).toEqual({ ok: true });
  });

  it.each([
    ['long wrong-side stop', { side: 'buy', entryPrice: 100, stopPrice: 100, units: 1, leverage: 1, equity: 1_000 }, 'stop-on-wrong-side'],
    ['short wrong-side stop', { side: 'sell', entryPrice: 100, stopPrice: 100, units: 1, leverage: 1, equity: 1_000 }, 'stop-on-wrong-side'],
    ['NaN entry', { side: 'buy', entryPrice: Number.NaN, stopPrice: 95, units: 1, leverage: 1, equity: 1_000 }, 'invalid-entry-price'],
    ['negative entry', { side: 'buy', entryPrice: -100, stopPrice: 95, units: 1, leverage: 1, equity: 1_000 }, 'invalid-entry-price'],
    ['infinite stop', { side: 'buy', entryPrice: 100, stopPrice: Number.POSITIVE_INFINITY, units: 1, leverage: 1, equity: 1_000 }, 'invalid-stop-price'],
    ['zero stop', { side: 'buy', entryPrice: 100, stopPrice: 0, units: 1, leverage: 1, equity: 1_000 }, 'invalid-stop-price'],
    ['invalid units', { side: 'buy', entryPrice: 100, stopPrice: 95, units: 0, leverage: 1, equity: 1_000 }, 'invalid-units'],
    ['invalid capital', { side: 'buy', entryPrice: 100, stopPrice: 95, units: 1, leverage: 1, equity: 0 }, 'invalid-capital'],
    ['invalid leverage', { side: 'buy', entryPrice: 100, stopPrice: 95, units: 1, leverage: 0, equity: 1_000 }, 'invalid-leverage'],
  ] as const)('rejects %s', (_label, input, reason) => {
    expect(validateEntry(input)).toEqual({ ok: false, reason });
  });

  it('allows explicit-unit live entries without an SL while requiring a stop for risk sizing', () => {
    expect(validateEntry({ side: 'buy', entryPrice: 100, stopPrice: null, units: 1, leverage: 1, equity: 1_000 })).toEqual({ ok: true });
    expect(sizeRiskPosition({ side: 'buy', entryPrice: 100, stopPrice: null, equity: 1_000, riskPct: 1, leverage: 1 }).reason).toBe('no-stop');
  });
});

describe('shared risk sizing', () => {
  const long = { side: 'buy' as const, entryPrice: 100, stopPrice: 95, equity: 1_000, riskPct: 1, leverage: 1 };
  const short = { ...long, side: 'sell' as const, stopPrice: 105 };

  it('sizes long and short symmetrically', () => {
    const longResult = sizeRiskPosition(long);
    const shortResult = sizeRiskPosition(short);
    expect(longResult).toMatchObject({ ok: true, units: 2, riskAmount: 10, margin: 200, reason: 'ok' });
    expect(shortResult).toMatchObject({ ok: true, units: 2, riskAmount: 10, margin: 200, reason: 'ok' });
  });

  it.each([
    ['non-finite risk', { ...long, riskPct: Number.POSITIVE_INFINITY }, 'invalid-risk-pct'],
    ['zero risk', { ...long, riskPct: 0 }, 'invalid-risk-pct'],
    ['negative capital', { ...long, equity: -1 }, 'invalid-capital'],
    ['invalid leverage', { ...long, leverage: Number.NaN }, 'invalid-leverage'],
    ['insufficient margin', { ...long, stopPrice: 99.9, leverage: 1 }, 'insufficient-margin'],
  ] as const)('rejects %s', (_label, input, reason) => {
    expect(sizeRiskPosition(input)).toMatchObject({ ok: false, reason, units: 0, riskAmount: 0, margin: 0 });
  });

  it('is deterministic for identical replay sizing inputs', () => {
    expect(sizeRiskPosition(long)).toEqual(sizeRiskPosition(long));
  });
});

describe('replay sizing adapter', () => {
  it('uses the same pure sizing result as the shared primitive', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, riskPct: 1, leverage: 1 as const };
    const shared = sizeRiskPosition({ side: 'buy', entryPrice: 100, stopPrice: 95, equity: 1_000, riskPct: 1, leverage: 1 });
    expect(positionSizeFor(config, 1_000, 'buy', 100, 95)).toEqual(shared);
  });
});