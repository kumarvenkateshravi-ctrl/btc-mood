import { describe, expect, it } from 'vitest';
import {
  ANALYTICAL_POC_COLORS,
  analyticalColor,
  analyticalDecay,
  chooseAnalyticalFocus,
  resolveLabelCollisions,
} from './chartAnalyticalPresentation';

describe('chart analytical presentation policy', () => {
  it('keeps the locked session POC palette', () => {
    expect(ANALYTICAL_POC_COLORS).toEqual({
      fourHour: '#00bcd4',
      daily: '#f0b90b',
      weekly: '#a855f7',
    });
  });

  it('preserves hue while applying presentation opacity', () => {
    expect(analyticalColor('#00bcd4', 1)).toBe('#00bcd4');
    expect(analyticalColor('#00bcd4', 0.4)).toBe('rgba(0,188,212,0.4)');
  });

  it('makes current/focused analytics stronger while historical objects decay', () => {
    expect(analyticalDecay(0)).toBe(1);
    expect(analyticalDecay(1)).toBeGreaterThan(analyticalDecay(20));
    expect(analyticalDecay(20)).toBeGreaterThanOrEqual(0.28);
  });

  it('chooses the nearest object with deterministic kind priority', () => {
    expect(chooseAnalyticalFocus([
      { id: 'old-fvg', kind: 'fvg', distance: 2, active: true },
      { id: 'poc', kind: 'poc', distance: 4, active: true },
      { id: 'near-ob', kind: 'orderBlock', distance: 1.5, active: true },
    ])).toBe('near-ob');
  });

  it('keeps the highest-priority label when vertical labels collide', () => {
    const labels = resolveLabelCollisions([
      { id: 'price', y: 100, priority: 100 },
      { id: 'sl', y: 105, priority: 90 },
      { id: 'old-poc', y: 101, priority: 10 },
    ], 4);
    expect(labels.map((label) => label.id)).toEqual(['price', 'sl']);
  });
});
