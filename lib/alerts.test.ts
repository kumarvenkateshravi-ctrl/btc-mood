import { describe, it, expect, beforeEach } from 'vitest';
import {
  isAlertSide,
  isRule,
  loadRules,
  newRuleId,
  rulesToFire,
  saveRules,
  type AlertRule,
} from './alerts';
import type { Signal, Timeframe } from './types';

const signal = (side: Signal['side']): Signal => ({
  side,
  source: 'ema+rsi',
  fresh: true,
});

const rule = (over: Partial<AlertRule>): AlertRule => ({
  id: newRuleId(),
  tf: '15m',
  side: 'buy',
  enabled: true,
  createdAt: 1,
  lastFiredAt: null,
  ...over,
});

describe('alerts: isAlertSide', () => {
  it('accepts buy and sell only', () => {
    expect(isAlertSide('buy')).toBe(true);
    expect(isAlertSide('sell')).toBe(true);
    expect(isAlertSide('neutral')).toBe(false);
    expect(isAlertSide('SELL')).toBe(false);
    expect(isAlertSide('')).toBe(false);
  });
});

describe('alerts: isRule', () => {
  it('accepts a complete rule', () => {
    expect(isRule(rule({}))).toBe(true);
  });
  it('rejects a non-object', () => {
    expect(isRule(null)).toBe(false);
    expect(isRule('x')).toBe(false);
    expect(isRule(42)).toBe(false);
  });
  it('rejects an object with the wrong shape', () => {
    expect(isRule({ id: 'x' })).toBe(false);
    expect(isRule({ id: 'x', tf: '5m', side: 'buy', enabled: true, createdAt: 1, lastFiredAt: 'no' })).toBe(false);
  });
  it('rejects a rule with a non-bool enabled', () => {
    expect(isRule(rule({ enabled: 'yes' as unknown as boolean }))).toBe(false);
  });
});

describe('alerts: localStorage roundtrip', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('saveRules + loadRules roundtrips a rule', () => {
    const r = rule({});
    saveRules([r]);
    const out = loadRules();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(r.id);
  });

  it('loadRules returns [] when storage is empty', () => {
    expect(loadRules()).toEqual([]);
  });

  it('loadRules returns [] when storage is corrupted', () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('btc-mood:alerts:v1', '{not json');
    }
    expect(loadRules()).toEqual([]);
  });
});

describe('alerts: rulesToFire', () => {
  it('fires a buy rule when the snapshot is buy', () => {
    const r = rule({ tf: '15m', side: 'buy' });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': signal('buy'),
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    expect(rulesToFire([r], snaps, {})).toEqual([r]);
  });

  it('does not fire a disabled rule', () => {
    const r = rule({ tf: '15m', side: 'buy', enabled: false });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': signal('buy'),
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    expect(rulesToFire([r], snaps, {})).toEqual([]);
  });

  it('does not fire a sell rule when the snapshot is buy', () => {
    const r = rule({ tf: '15m', side: 'sell' });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': signal('buy'),
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    expect(rulesToFire([r], snaps, {})).toEqual([]);
  });

  it('dedupes: a rule that already fired for the same side does not re-fire', () => {
    const r = rule({ tf: '15m', side: 'buy' });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': signal('buy'),
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    expect(rulesToFire([r], snaps, { [r.id]: 'buy' })).toEqual([]);
  });

  it('re-fires a rule when the side flips through neutral and back', () => {
    const r = rule({ tf: '15m', side: 'buy' });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': signal('buy'),
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    // The rule was last fired for 'sell', so even though it's been
    // seen in 'buy' state, the dedupe state is 'sell' → re-fires.
    expect(rulesToFire([r], snaps, { [r.id]: 'sell' })).toEqual([r]);
  });

  it('skips rules whose TF snapshot is null', () => {
    const r = rule({ tf: '15m', side: 'buy' });
    const snaps: Record<Timeframe, Signal | null> = {

      '5m': null,
      '15m': null,
      '30m': null,
      '1h': null,
      '4h': null,
      '1d': null,
    };
    expect(rulesToFire([r], snaps, {})).toEqual([]);
  });
});
