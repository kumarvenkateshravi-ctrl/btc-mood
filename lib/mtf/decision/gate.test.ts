import { describe, expect, it } from 'vitest';
import { environmentGate } from './gate';
import { mkMarket } from './testFixtures';

describe('M9 environment gate — first-match ladder', () => {
  it('rung 1: any non-ready readiness blocks with the M8 reason verbatim', () => {
    const g = environmentGate(mkMarket({ readiness: { state: 'wait', reason: 'awaiting confirmation' } }));
    expect(g).toEqual({ passed: false, blockedBy: 'environment_wait', reason: 'awaiting confirmation' });
    expect(environmentGate(mkMarket({ readiness: { state: 'avoid', reason: 'x' } })).blockedBy)
      .toBe('environment_avoid');
    expect(environmentGate(mkMarket({ readiness: { state: 'no_trade', reason: 'x' } })).blockedBy)
      .toBe('environment_no_trade');
  });

  it('rung 2: ready but neutral bias → no_directional_edge', () => {
    const g = environmentGate(mkMarket({
      readiness: { state: 'ready', reason: 'ok' },
      headline: { bias: 'neutral' },
    }));
    expect(g.passed).toBe(false);
    expect(g.blockedBy).toBe('no_directional_edge');
  });

  it('rung 3: ready + directional but extreme risk → extreme_risk', () => {
    const g = environmentGate(mkMarket({
      readiness: { state: 'ready', reason: 'ok' },
      headline: { bias: 'bullish' },
      risk: { level: 'extreme' },
    }));
    expect(g.blockedBy).toBe('extreme_risk');
  });

  it('rung 4: invalidated lifecycle → lifecycle_invalidated', () => {
    const g = environmentGate(mkMarket({
      readiness: { state: 'ready', reason: 'ok' },
      headline: { bias: 'bullish' },
      risk: { level: 'low' },
      outlook: { invalidation: { invalidated: true, condition: 'broken' } },
    }));
    expect(g.blockedBy).toBe('lifecycle_invalidated');
  });

  it('all clear → passed with null blockedBy', () => {
    const g = environmentGate(mkMarket({
      readiness: { state: 'ready', reason: 'ok' },
      headline: { bias: 'bearish' },
      risk: { level: 'medium' },
      outlook: { invalidation: { invalidated: false, condition: null } },
    }));
    expect(g).toEqual({ passed: true, blockedBy: null, reason: 'ok' });
  });

  it('ordering: readiness rung fires before the bias rung', () => {
    const g = environmentGate(mkMarket({
      readiness: { state: 'wait', reason: 'w' },
      headline: { bias: 'neutral' },
    }));
    expect(g.blockedBy).toBe('environment_wait');
  });
});
