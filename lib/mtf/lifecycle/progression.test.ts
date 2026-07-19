import { describe, expect, it } from 'vitest';
import { progress } from './progression';

describe('progress', () => {
  it('no previous → advancing', () => {
    const r = progress(null, 'trend_establishment');
    expect(r.previous).toBeNull();
    expect(r.current).toBe('trend_establishment');
    expect(r.trajectory).toBe('advancing');
  });
  it('forward move in cycle order → advancing', () => {
    expect(progress('breakout', 'confirmation').trajectory).toBe('advancing');
  });
  it('same stage → stalling', () => {
    expect(progress('confirmation', 'confirmation').trajectory).toBe('stalling');
  });
  it('backward move in cycle order → regressing', () => {
    expect(progress('continuation', 'trend_establishment').trajectory).toBe('regressing');
  });
  it('dropping into range from a trending stage → regressing', () => {
    expect(progress('continuation', 'range').trajectory).toBe('regressing');
  });
  it('emerging from range into breakout → advancing', () => {
    expect(progress('range', 'breakout').trajectory).toBe('advancing');
  });
});
