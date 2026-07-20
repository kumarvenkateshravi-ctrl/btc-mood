import { describe, expect, it } from 'vitest';
import { OPP_GRADES, OPP_WEIGHTS, QUALITY_BANDS, QUALITY_WEIGHTS, RISK_BANDS } from './config';

describe('M8 config', () => {
  it('quality weights sum to 1', () => {
    expect(Object.values(QUALITY_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
  });
  it('opportunity weights sum to 1', () => {
    expect(Object.values(OPP_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
  });
  it('quality bands strictly descending', () => {
    expect(QUALITY_BANDS.excellent).toBeGreaterThan(QUALITY_BANDS.good);
    expect(QUALITY_BANDS.good).toBeGreaterThan(QUALITY_BANDS.average);
    expect(QUALITY_BANDS.average).toBeGreaterThan(QUALITY_BANDS.poor);
  });
  it('grades strictly descending', () => {
    expect(OPP_GRADES['A+']).toBeGreaterThan(OPP_GRADES.A);
    expect(OPP_GRADES.A).toBeGreaterThan(OPP_GRADES.B);
    expect(OPP_GRADES.B).toBeGreaterThan(OPP_GRADES.C);
    expect(OPP_GRADES.C).toBeGreaterThan(OPP_GRADES.D);
  });
  it('risk bands strictly ascending', () => {
    expect(RISK_BANDS.veryLow).toBeLessThan(RISK_BANDS.low);
    expect(RISK_BANDS.low).toBeLessThan(RISK_BANDS.medium);
    expect(RISK_BANDS.medium).toBeLessThan(RISK_BANDS.high);
  });
});
