import { describe, expect, it } from 'vitest';
import { explain } from './explanation';
import { buildSetup } from './levels';
import type { Candle } from '../../types';

const BANNED = /\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i;

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];

describe('M9 explanation — deterministic, banned-vocabulary-safe', () => {
  it('no_trade explanation carries the gate reason', () => {
    const lines = explain({
      action: 'no_trade',
      gate: { passed: false, blockedBy: 'environment_wait', reason: 'awaiting confirmation' },
      executionTf: '15m', setup: null, tier: 'none', capped: false, calibration: 'prior',
    });
    expect(lines[0]).toBe('No trade: awaiting confirmation.');
    for (const line of lines) expect(line).not.toMatch(BANNED);
  });

  it('trade explanation names zone, stop-as-invalidation, target, RR, and tier', () => {
    const out = buildSetup('long', bars(LONG));
    if (out.kind !== 'setup') throw new Error('fixture broke');
    const lines = explain({
      action: 'long',
      gate: { passed: true, blockedBy: null, reason: 'ok' },
      executionTf: '15m', setup: out.setup, tier: 'half', capped: true, calibration: 'prior',
    });
    expect(lines).toEqual([
      'Setup proposed on 15m: long entry 105–105.5 (pullback), stop 103 (2.14%), first target 111 (RR 2.56).',
      'Invalid below 103 — the stop is the invalidation.',
      'Risk tier: half. Capped while probabilities run on model priors.',
    ]);
    for (const line of lines) expect(line).not.toMatch(BANNED);
  });
});
