import { describe, it, expect } from 'vitest';
import { confluenceScore, computeModuleScores } from './confluence';
import { computeInstitutional } from './institutionalScore';
import { DEFAULT_SMC_CONFIG } from './types';
import type { SetupState } from './types';

const W = DEFAULT_SMC_CONFIG.weights;

const noTrigger = {
  hasDirectionalEvent: false,
  qualifyingObjectMitigatedAgainst: false,
  insideQualifyingObject: false,
  approachingQualifyingObject: false,
};

describe('confluenceScore', () => {
  it('base 60 when trends agree, +10 per strong module', () => {
    const m = { structure: 70, liquidity: 65, orderBlocks: 60, fvg: 10, premiumDiscount: 20 };
    expect(confluenceScore(m, 1, 1)).toBe(90); // 60 + 3 modules ≥ 60
    expect(confluenceScore(m, 1, -1)).toBe(60); // 30 + 30
  });
});

describe('computeModuleScores', () => {
  it('returns zeros with no objects', () => {
    const m = computeModuleScores({
      structureLevels: [], pools: [], blocks: [], gaps: [],
      swingTrend: 0, internalTrend: 0, zone: 'equilibrium', recentEvents: [],
    });
    expect(m).toEqual({ structure: 0, liquidity: 0, orderBlocks: 0, fvg: 0, premiumDiscount: 50 });
  });
});

describe('computeInstitutional setup machine', () => {
  const walk = (
    prev: SetupState,
    score: { structure: number; liquidity: number; orderBlocks: number; fvg: number; premiumDiscount: number },
    confluence: number,
    trigger: Partial<typeof noTrigger>,
  ) =>
    computeInstitutional(score, confluence, W, prev, { ...noTrigger, ...trigger }, 1, 1);

  const hi = { structure: 90, liquidity: 85, orderBlocks: 90, fvg: 70, premiumDiscount: 80 };
  const lo = { structure: 20, liquidity: 10, orderBlocks: 15, fvg: 0, premiumDiscount: 20 };

  it('none → watch → building → ready → confirmed → exhausted', () => {
    let r = walk('none', hi, 80, {});
    expect(r.setup).toBe('watch');
    r = walk('watch', hi, 80, { approachingQualifyingObject: true });
    expect(r.setup).toBe('building');
    r = walk('building', hi, 80, { insideQualifyingObject: true });
    expect(r.setup).toBe('ready');
    r = walk('ready', hi, 80, { insideQualifyingObject: true, hasDirectionalEvent: true });
    expect(r.setup).toBe('confirmed');
    r = walk('confirmed', lo, 20, {});
    expect(r.setup).toBe('exhausted');
    r = walk('exhausted', lo, 20, {});
    expect(r.setup).toBe('none');
  });

  it('invalidates from pre-confirmed states when a qualifying object is mitigated against', () => {
    const r = walk('ready', hi, 80, { qualifyingObjectMitigatedAgainst: true });
    expect(r.setup).toBe('invalidated');
  });

  it('weighted blend with confluence adjustment', () => {
    const r = walk('none', hi, 80, {});
    // Σ(score*w)/Σw = (90*30+85*25+90*25+70*10+80*10)/100 = 85.75 → +10 (confluence ≥ 70) → 96
    expect(r.institutional).toBe(96);
    expect(r.bias).toBe('bullish');
  });
});
