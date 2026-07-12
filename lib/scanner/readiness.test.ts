import { describe, it, expect } from 'vitest';
import { computeTradeReadiness } from './readiness';

describe('computeTradeReadiness', () => {
  it('a strong aligned long market reads ready with 5 stars and weak counter-trend', () => {
    const r = computeTradeReadiness({
      institutional: 90, confluence: 90, stackScore: 88, direction: 'long', gatesPassed: 4, gatesTotal: 4,
    });
    expect(r.readiness).toBeGreaterThanOrEqual(85);
    expect(r.stars).toBe(5);
    expect(r.counterStars).toBe(1);
    expect(r.bias).toBe('long');
  });

  it('a bearish market aligns the stack score with the SHORT side', () => {
    const short = computeTradeReadiness({
      institutional: 80, confluence: 70, stackScore: 15, direction: 'short', gatesPassed: 4, gatesTotal: 4,
    });
    const wrongWay = computeTradeReadiness({
      institutional: 80, confluence: 70, stackScore: 15, direction: 'long', gatesPassed: 4, gatesTotal: 4,
    });
    expect(short.readiness).toBeGreaterThan(wrongWay.readiness);
  });

  it('no direction: neutral stack contribution, capped by failed gates', () => {
    const r = computeTradeReadiness({
      institutional: 40, confluence: 30, stackScore: 90, direction: null, gatesPassed: 1, gatesTotal: 4,
    });
    expect(r.bias).toBeNull();
    expect(r.readiness).toBeLessThan(55);
    expect(r.stars).toBeLessThanOrEqual(2);
    expect(r.counterStars).toBeLessThanOrEqual(r.stars + 1);
  });

  it('counter-trend never exceeds the recommended side', () => {
    for (const inst of [10, 40, 60, 85, 95]) {
      const r = computeTradeReadiness({
        institutional: inst, confluence: inst, stackScore: 70, direction: 'long', gatesPassed: 3, gatesTotal: 4,
      });
      expect(r.counterStars).toBeLessThanOrEqual(r.stars === 3 ? 3 : r.stars);
    }
  });
});
