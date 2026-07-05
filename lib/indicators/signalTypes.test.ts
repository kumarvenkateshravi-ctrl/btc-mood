import { describe, it, expect } from 'vitest';
import { zoneIdOf, SIGNAL_STATUSES } from './signalTypes';

describe('signalTypes', () => {
  it('zoneIdOf builds a stable id from tf, kind and formation index', () => {
    expect(zoneIdOf('D', 'demand', 42)).toBe('D:demand:42');
  });
  it('exposes the full status set', () => {
    expect(SIGNAL_STATUSES).toEqual(['armed', 'triggered', 'tp1', 'tp2', 'stopped', 'expired', 'invalidated']);
  });
});
