import { describe, it, expect } from 'vitest';
import { distToSegment, fibLevelPrices, TOOL_POINTS, isDrawing, FIB_LEVELS } from './drawings';

describe('distToSegment', () => {
  it('is 0 on the segment', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });
  it('is the perpendicular distance for an interior projection', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 6);
  });
  it('clamps to the nearest endpoint past the ends', () => {
    expect(distToSegment(-4, 0, 0, 0, 10, 0)).toBeCloseTo(4, 6);
    expect(distToSegment(14, 0, 0, 0, 10, 0)).toBeCloseTo(4, 6);
  });
  it('handles a degenerate (zero-length) segment', () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });
});

describe('fibLevelPrices', () => {
  it('maps 0→p0 and 1→p1', () => {
    const levels = fibLevelPrices(100, 200);
    expect(levels[0]).toEqual({ level: 0, price: 100 });
    expect(levels[levels.length - 1]).toEqual({ level: 1, price: 200 });
  });
  it('places 0.5 at the midpoint', () => {
    const mid = fibLevelPrices(100, 200).find((l) => l.level === 0.5);
    expect(mid?.price).toBeCloseTo(150, 6);
  });
  it('returns one entry per fib level', () => {
    expect(fibLevelPrices(0, 1).length).toBe(FIB_LEVELS.length);
  });
});

describe('model', () => {
  it('1-point tools need one point, 2-point tools two', () => {
    expect(TOOL_POINTS.horizontal).toBe(1);
    expect(TOOL_POINTS.text).toBe(1);
    expect(TOOL_POINTS.trendline).toBe(2);
    expect(TOOL_POINTS.fib).toBe(2);
  });
  it('validates drawing shape', () => {
    expect(isDrawing({ id: 'a', type: 'trendline', points: [{ time: 1, price: 2 }], color: '#fff' })).toBe(true);
    expect(isDrawing({ id: 'a', type: 'trendline', points: [{ time: 1 }], color: '#fff' })).toBe(false);
    expect(isDrawing({ id: 'a' })).toBe(false);
  });
});
