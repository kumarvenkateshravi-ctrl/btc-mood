import { describe, expect, it } from 'vitest';
import { riskTierOf } from './riskTier';
import { mkMarket } from './testFixtures';

const m = (quality: string, risk: string, calibration: 'prior' | 'empirical') => mkMarket({
  quality: { level: quality as never },
  risk: { level: risk as never },
  headline: { calibration },
});

describe('M9 risk tier — first-match ladder + prior cap', () => {
  it('gate failed → none, never capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), false)).toEqual({ tier: 'none', capped: false });
  });

  it('excellent quality + low risk + empirical calibration → full', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), true)).toEqual({ tier: 'full', capped: false });
    expect(riskTierOf(m('excellent', 'very_low', 'empirical'), true)).toEqual({ tier: 'full', capped: false });
  });

  it('honesty cap: excellent/low but priors → half, capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: true });
  });

  it('good/medium → half; cap does not mark half as capped', () => {
    expect(riskTierOf(m('good', 'medium', 'empirical'), true)).toEqual({ tier: 'half', capped: false });
    expect(riskTierOf(m('good', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: false });
  });

  it('rungs break on either dimension → quarter', () => {
    expect(riskTierOf(m('average', 'medium', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false });
    expect(riskTierOf(m('excellent', 'high', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false });
  });
});
