import { describe, it, expect } from 'vitest';
import { computeZones } from './premiumDiscount';
import type { TrailingExtremes } from './marketStructure';

const trailing: TrailingExtremes = {
  top: 120,
  bottom: 80,
  barIndex: 5,
  barTime: 300,
  lastTopTime: 500,
  lastBottomTime: 400,
};

describe('computeZones', () => {
  it('builds LuxAlgo zone bands from trailing extremes', () => {
    const z = computeZones(trailing, 119, 50, 3000);
    // premium: [0.95*top + 0.05*bottom, top] = [118, 120]
    expect(z.premium.top).toBeCloseTo(120);
    expect(z.premium.bottom).toBeCloseTo(118);
    // equilibrium: [0.525*bottom+0.475*top, 0.525*top+0.475*bottom] = [99, 101]
    expect(z.equilibrium.top).toBeCloseTo(101);
    expect(z.equilibrium.bottom).toBeCloseTo(99);
    // discount: [bottom, 0.95*bottom + 0.05*top] = [80, 82]
    expect(z.discount.top).toBeCloseTo(82);
    expect(z.discount.bottom).toBeCloseTo(80);
  });

  it('classifies price position: premium / equilibrium / discount', () => {
    expect(computeZones(trailing, 119, 50, 0).zone).toBe('premium');
    expect(computeZones(trailing, 103, 50, 0).zone).toBe('premium'); // above eq top ⇒ premium side
    expect(computeZones(trailing, 100, 50, 0).zone).toBe('equilibrium');
    expect(computeZones(trailing, 98, 50, 0).zone).toBe('discount'); // below eq bottom ⇒ discount side
    expect(computeZones(trailing, 81, 50, 0).zone).toBe('discount');
  });
});
