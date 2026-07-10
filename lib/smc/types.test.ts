import { describe, it, expect } from 'vitest';
import { DEFAULT_SMC_CONFIG, resolveSmcConfig, smcObjectId, clampScore } from './types';

describe('smc types', () => {
  it('default config matches LuxAlgo script defaults', () => {
    expect(DEFAULT_SMC_CONFIG).toMatchObject({
      version: '1.0',
      swingsLength: 50,
      internalLength: 5,
      eqLength: 3,
      eqThreshold: 0.1,
      obFilter: 'atr',
      obMitigation: 'highlow',
      maxInternalOrderBlocks: 5,
      maxSwingOrderBlocks: 5,
      fvgAutoThreshold: true,
      fvgExtend: 1,
      maxAgeBars: 500,
      sweepConfirmBars: 2,
      weights: { structure: 30, liquidity: 25, orderBlocks: 25, fvg: 10, premiumDiscount: 10 },
    });
  });

  it('resolveSmcConfig merges partials without mutating defaults', () => {
    const cfg = resolveSmcConfig({ swingsLength: 20, weights: { structure: 50 } as never });
    expect(cfg.swingsLength).toBe(20);
    expect(cfg.internalLength).toBe(5);
    expect(cfg.weights.structure).toBe(50);
    expect(cfg.weights.liquidity).toBe(25);
    expect(DEFAULT_SMC_CONFIG.swingsLength).toBe(50);
    expect(DEFAULT_SMC_CONFIG.weights.structure).toBe(30);
  });

  it('object ids are deterministic', () => {
    expect(smcObjectId('orderBlock', 'internal', 'bullish', 412)).toBe('orderBlock_internal_bullish_412');
    expect(smcObjectId('liquidityPool', undefined, 'bearish', 9)).toBe('liquidityPool_x_bearish_9');
  });

  it('clampScore clamps to integer 0-100', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(66.6)).toBe(67);
  });
});
