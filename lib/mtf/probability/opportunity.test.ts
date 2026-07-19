import { describe, expect, it } from 'vitest';
import { opportunityOf } from './opportunity';

const out = (probability: number) => ({ outcome: 'continuation' as const, probability });
const dir = (probability: number) => ({ direction: 'bullish' as const, probability });

describe('opportunityOf', () => {
  it('score = round(100·(0.6·P_outcome + 0.4·P_direction))', () => {
    expect(opportunityOf(out(0.9), dir(0.8))).toEqual({ score: 86, grade: 'A' });
  });
  it('grade bands A/B/C/D', () => {
    expect(opportunityOf(out(0.8), dir(0.8)).grade).toBe('A');   // exactly 80
    expect(opportunityOf(out(0.7), dir(0.6))).toEqual({ score: 66, grade: 'B' });
    expect(opportunityOf(out(0.5), dir(0.45))).toEqual({ score: 48, grade: 'C' });
    expect(opportunityOf(out(0.3), dir(0.34))).toEqual({ score: 32, grade: 'D' });
  });
});
