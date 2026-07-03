import { describe, it, expect } from 'vitest';
import { projectedPnl } from './paper';

describe('projectedPnl', () => {
  it('long: profit above entry, loss below', () => {
    expect(projectedPnl('buy', 10, 61_956, 62_069.33)).toBeCloseTo(1133.3, 1);
    expect(projectedPnl('buy', 10, 61_956, 61_716.72)).toBeCloseTo(-2392.8, 1);
  });
  it('short: mirrored', () => {
    expect(projectedPnl('sell', 10, 61_956, 61_716.72)).toBeCloseTo(2392.8, 1);
  });
  it('zero units → 0', () => {
    expect(projectedPnl('buy', 0, 61_956, 70_000)).toBe(0);
  });
});
