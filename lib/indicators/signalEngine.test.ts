import { describe, it, expect } from 'vitest';
import { computeStopLoss, DEFAULT_SIGNAL_CONFIG } from './signalEngine';

const zone = { upper: 105, lower: 100 };

describe('computeStopLoss', () => {
  it('atr mode: buy stop is zone.lower minus slBuffer*atr', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(99, 6);
  });
  it('percent mode: buy stop uses % of entry', () => {
    const sl = computeStopLoss('buy', zone, 200, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'percent', slBuffer: 1 });
    expect(sl).toBeCloseTo(98, 6);
  });
  it('ticks mode: buy stop uses slBuffer*tickSize', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'ticks', slBuffer: 5, tickSize: 0.1 });
    expect(sl).toBeCloseTo(99.5, 6);
  });
  it('sell mirrors above the zone upper', () => {
    const sl = computeStopLoss('sell', zone, 104, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(106, 6);
  });
});
