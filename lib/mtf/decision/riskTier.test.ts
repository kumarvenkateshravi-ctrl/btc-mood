import { describe, expect, it } from 'vitest';
import { riskTierOf } from './riskTier';
import { mkMarket } from './testFixtures';

const m = (quality: string, risk: string, calibration: 'prior' | 'empirical') => mkMarket({
  quality: { level: quality as never },
  risk: { level: risk as never },
  headline: { calibration },
});

describe('M9 risk tier — first-match ladder + advisory caps (Arch v2: never flips action)', () => {
  it('gate failed → none, never capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), false)).toEqual({ tier: 'none', capped: false, capReason: null });
  });

  it('excellent quality + low risk + empirical calibration → full', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), true)).toEqual({ tier: 'full', capped: false, capReason: null });
    expect(riskTierOf(m('excellent', 'very_low', 'empirical'), true)).toEqual({ tier: 'full', capped: false, capReason: null });
  });

  it('honesty cap: excellent/low but priors → half, capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: true, capReason: 'prior' });
  });

  it('good/medium → half; cap does not mark half as capped', () => {
    expect(riskTierOf(m('good', 'medium', 'empirical'), true)).toEqual({ tier: 'half', capped: false, capReason: null });
    expect(riskTierOf(m('good', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: false, capReason: null });
  });

  it('rungs break on either dimension → quarter', () => {
    expect(riskTierOf(m('average', 'medium', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
    expect(riskTierOf(m('excellent', 'high', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
  });

  it('extreme risk → none, capped, regardless of quality (advisory cap, not an action veto)', () => {
    expect(riskTierOf(m('excellent', 'extreme', 'empirical'), true)).toEqual({ tier: 'none', capped: true, capReason: 'extreme_risk' });
  });

  it('invalidated lifecycle caps a full/half tier down to quarter, never upgrades a lower tier', () => {
    const invalidated = (quality: string, risk: string) => mkMarket({
      quality: { level: quality as never }, risk: { level: risk as never }, headline: { calibration: 'empirical' },
      outlook: { invalidation: { invalidated: true, condition: 'broken' } },
    });
    expect(riskTierOf(invalidated('excellent', 'low'), true)).toEqual({ tier: 'quarter', capped: true, capReason: 'lifecycle_invalidated' });
    expect(riskTierOf(invalidated('average', 'medium'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
  });
});
