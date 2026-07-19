import { describe, expect, it } from 'vitest';
import { tfWeight, tfRole, TIMEFRAME_HIERARCHY } from './config';

describe('timeframe config', () => {
  it('position-derived weights (top highest)', () => {
    expect(tfWeight('1d')).toBe(6);
    expect(tfWeight('4h')).toBe(5);
    expect(tfWeight('5m')).toBe(1);
    expect(tfWeight('1w' as never)).toBe(0);
  });
  it('roles by tier thirds', () => {
    expect(tfRole('1d')).toBe('context');
    expect(tfRole('4h')).toBe('context');
    expect(tfRole('1h')).toBe('confirmation');
    expect(tfRole('30m')).toBe('confirmation');
    expect(tfRole('15m')).toBe('trigger');
    expect(tfRole('5m')).toBe('trigger');
  });
  it('default hierarchy is highest → lowest', () => {
    expect(TIMEFRAME_HIERARCHY[0]).toBe('1d');
    expect(TIMEFRAME_HIERARCHY[TIMEFRAME_HIERARCHY.length - 1]).toBe('5m');
  });
});
