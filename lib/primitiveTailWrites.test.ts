import { describe, expect, it } from 'vitest';
import { IndicatorBandPrimitive } from './indicatorBandPrimitive';
import { GradientZonePrimitive } from './gradientZonePrimitive';

describe('indicator primitive tail writes', () => {
  it('updates and appends a band tail without rebuilding historical arrays', () => {
    const band = new IndicatorBandPrimitive();
    band.setData([10, 11], [5, 6], [1, 2], '#fff', true);
    const upper = band.upper;
    band.updateLast(12, 7, 2, '#fff', true);
    expect(band.upper).toBe(upper);
    expect(band.upper).toEqual([10, 12]);
    band.append(13, 8, 3, '#fff', true);
    expect(band.upper).toEqual([10, 12, 13]);
    expect(band.lower).toEqual([5, 7, 8]);
  });

  it('updates and appends a gradient tail without rebuilding historical arrays', () => {
    const gradient = new GradientZonePrimitive();
    gradient.setData([1, 2], [10, 20], []);
    const values = gradient.values;
    gradient.updateLast(3, 20, []);
    expect(gradient.values).toBe(values);
    expect(gradient.values).toEqual([1, 3]);
    gradient.append(4, 30, []);
    expect(gradient.values).toEqual([1, 3, 4]);
    expect(gradient.times).toEqual([10, 20, 30]);
  });
});
