import { describe, it, expect } from 'vitest';
import {
  obStrength,
  fvgStrength,
  poolStrength,
  structureStrength,
  qualityOf,
  confidenceOf,
} from './scoring';
import type { SmcObject } from './types';

const obj = (over: Partial<SmcObject> = {}): SmcObject => ({
  id: 'orderBlock_internal_bullish_1',
  kind: 'orderBlock',
  scope: 'internal',
  direction: 'bullish',
  top: 101,
  bottom: 100,
  createdAtBar: 0,
  createdAtTime: 0,
  updatedAtBar: 0,
  state: 'active',
  touches: 0,
  strength: 0,
  quality: 0,
  confidence: 0,
  ...over,
});

describe('strength formulas', () => {
  it('scales with impulse vs ATR and clamps at 100', () => {
    expect(obStrength(2)).toBe(50); // displacement 2x ATR → 50
    expect(obStrength(10)).toBe(100);
    expect(fvgStrength(1)).toBe(50); // gap 1x ATR → 50
    expect(fvgStrength(4)).toBe(100);
    expect(poolStrength(1)).toBe(75); // 50 + 25/extra touch
    expect(poolStrength(4)).toBe(100);
    expect(structureStrength(2)).toBe(60); // break magnitude 2x ATR → 60
  });
});

describe('qualityOf', () => {
  it('is 100 for a fresh untouched object', () => {
    expect(qualityOf(obj(), 0, 500)).toBe(100);
  });
  it('caps tested at 70 and partial at 40, decays with age', () => {
    expect(qualityOf(obj({ state: 'tested', touches: 1 }), 0, 500)).toBe(70);
    expect(qualityOf(obj({ state: 'partial', touches: 2 }), 0, 500)).toBe(40);
    // age decay: half of maxAge removes 20
    expect(qualityOf(obj(), 250, 500)).toBe(80);
  });
});

describe('confidenceOf', () => {
  it('rewards trend and zone alignment', () => {
    // bullish object, both trends bullish, in discount: 40 + 30 + 30 = 100
    expect(confidenceOf(obj(), 1, 1, 'discount')).toBe(100);
    // both trends against, in premium: 0
    expect(confidenceOf(obj(), -1, -1, 'premium')).toBe(0);
    // swing agrees only, equilibrium: 40 + 15 = 55
    expect(confidenceOf(obj(), 1, -1, 'equilibrium')).toBe(55);
  });
});
