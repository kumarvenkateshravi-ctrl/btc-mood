import { describe, expect, it } from 'vitest';
import {
  deriveMarketDataIntegrity,
  isPriceExecutionTrusted,
  type MarketDataIntegrityInput,
} from './marketDataIntegrity';

const base: MarketDataIntegrityInput = {
  hasAnyCandles: true,
  hasAllTimeframes: true,
  hasErrors: false,
  isLoading: false,
  wsStatus: 'open',
  lastUpdateMs: 10_000,
  nowMs: 11_000,
};

describe('deriveMarketDataIntegrity', () => {
  it.each([
    [{ ...base, hasAnyCandles: false, isLoading: true }, 'loading'],
    [{ ...base, hasAnyCandles: false, wsStatus: 'closed' }, 'unavailable'],
    [{ ...base, wsStatus: 'closed' }, 'historical'],
    [{ ...base }, 'live'],
    [{ ...base, lastUpdateMs: 0 }, 'stale'],
    [{ ...base, hasAllTimeframes: false }, 'partial'],
    [{ ...base, hasErrors: true, hasAllTimeframes: false }, 'partial'],
    [{ ...base, hasErrors: true }, 'stale'],
    [{ ...base, replayActive: true }, 'replay'],
    [{ ...base, demo: true }, 'demo'],
  ] as const)('returns %s for the corresponding data condition', (input, expected) => {
    expect(deriveMarketDataIntegrity(input)).toBe(expected);
  });

  it('trusts only a fresh live production price for price-dependent execution', () => {
    for (const integrity of ['loading', 'historical', 'stale', 'partial', 'unavailable', 'replay', 'demo'] as const) {
      expect(isPriceExecutionTrusted(integrity)).toBe(false);
    }
    expect(isPriceExecutionTrusted('live')).toBe(true);
  });
});
