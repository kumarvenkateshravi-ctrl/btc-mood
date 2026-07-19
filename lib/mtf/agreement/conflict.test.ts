import { describe, expect, it } from 'vitest';
import { conflictFrom } from './conflict';

describe('conflictFrom', () => {
  it('evenly split directional votes → high', () => { expect(conflictFrom(49, 48, 100)).toBe(96); });
  it('one-sided → low', () => { expect(conflictFrom(95, 5, 100)).toBe(10); });
  it('unanimous → 0', () => { expect(conflictFrom(100, 0, 100)).toBe(0); });
  it('all neutral (no directional mass) → 0', () => { expect(conflictFrom(0, 0, 100)).toBe(0); });
  it('perfectly even, scaled by directional share', () => { expect(conflictFrom(40, 40, 100)).toBe(80); });
  it('clamps / guards degenerate totals', () => { expect(conflictFrom(0, 0, 0)).toBe(0); });
});
