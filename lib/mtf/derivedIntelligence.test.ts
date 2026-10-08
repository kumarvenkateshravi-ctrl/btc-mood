import { describe, expect, it } from 'vitest';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import type { FvgDomainObject } from '../fvg/domain';
import type { Candle } from '../types';
import type { ClosedPocPrimitives, PocPeriodResult } from './primitiveFoundation';
import { createClosedPocPrimitiveEvaluator } from './primitiveFoundation';
import {
  classifyVwapStructure,
  deriveFvgIntelligence,
  derivePocStructure,
  evaluateClosedDerivedIntelligence,
  evaluateClosedFvgIntelligence,
  evaluateClosedVwapStructure,
} from './derivedIntelligence';

const START = Date.UTC(2024, 0, 7, 20) / 1000; // Sunday, before the ISO-week boundary.

function candles(count = 260): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const base = 40_000 + index * 7 + Math.sin(index / 4) * 50;
    return { time: START + index * 3_600, open: base - 8, high: base + 35, low: base - 30, close: base + (index % 4 - 2) * 5, volume: 900 + (index % 9) * 75, takerBuyVolume: 400 + (index % 7) * 40 };
  });
}

function context(source: Candle[], options: { forming?: boolean; replayCutoff?: number } = {}) {
  return createIndicatorEvaluationContext({
    rawCandles: source,
    displayCandles: source,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    mode: options.replayCutoff == null ? 'live' : 'replay',
    hasFormingBar: options.forming ?? false,
    replay: options.replayCutoff == null ? undefined : { sessionId: 'phase-4', cutTime: options.replayCutoff, executionTimeframe: '1h' },
    sourceRevision: 'phase-4-fixture',
  });
}

function gap(direction: 'bullish' | 'bearish', bottom: number, top: number, lifecycle: FvgDomainObject['lifecycle'] = 'active'): FvgDomainObject {
  return { id: direction + bottom, direction, bottom, top, createdIndex: 5, createdTime: 5, endIndex: lifecycle === 'mitigated' ? 8 : null, lifecycle, fillPercent: lifecycle === 'partiallyMitigated' ? 50 : lifecycle === 'mitigated' ? 100 : 0, active: lifecycle !== 'mitigated', source: 'raw' };
}

function poc(period: '4h' | 'daily' | 'weekly', value: number | null): PocPeriodResult {
  return {
    period, availability: value == null ? 'insufficient_data' : 'available', state: value == null ? 'insufficient_data' : 'developing', poc: value, vah: value, val: value,
    startTime: value == null ? null : START, endTime: value == null ? null : START + 3_600, shape: null, source: null, cacheIdentity: 'fixture',
  };
}

function pocs(fourHour: number | null, daily: number | null, weekly: number | null): ClosedPocPrimitives {
  return { fourHour: poc('4h', fourHour), daily: poc('daily', daily), weekly: poc('weekly', weekly), previousDailyShape: null };
}

describe('Phase 4 FVG intelligence', () => {
  it('uses active lifecycle objects only, preserves partial gaps, and chooses nearest deterministically', () => {
    const c = context(candles());
    const result = deriveFvgIntelligence(105, [gap('bullish', 90, 100), gap('bullish', 103, 107, 'partiallyMitigated'), gap('bearish', 130, 140), gap('bearish', 101, 102, 'mitigated')], c);
    expect(result.state).toBe('bullish');
    expect(result.bullish.activeCount).toBe(2);
    expect(result.bearish.activeCount).toBe(1);
    expect(result.bullish.priceInside).toBe(true);
    expect(result.bullish.nearest?.lifecycle).toBe('partiallyMitigated');
    expect(result.bearish.nearest?.id).toBe('bearish130');
    expect(result.bearish.activeCount).not.toBe(2);
  });

  it('distinguishes no-active, one-sided, and conflicting active FVG structures', () => {
    const c = context(candles());
    expect(deriveFvgIntelligence(100, [], c).state).toBe('none');
    expect(deriveFvgIntelligence(100, [gap('bullish', 90, 95)], c).state).toBe('bullish');
    expect(deriveFvgIntelligence(100, [gap('bearish', 105, 110)], c).state).toBe('bearish');
    expect(deriveFvgIntelligence(100, [gap('bullish', 90, 95), gap('bearish', 105, 110)], c).state).toBe('mixed');
  });
});

describe('Phase 4 VWAP structure state table', () => {
  it('classifies each strict Price/Daily/Weekly ordering', () => {
    expect(classifyVwapStructure(3, 2, 1)).toBe('strong_bullish'); // P>D>W
    expect(classifyVwapStructure(3, 1, 2)).toBe('bullish'); // P>W>D
    expect(classifyVwapStructure(2, 3, 1)).toBe('mixed'); // D>P>W
    expect(classifyVwapStructure(1, 3, 2)).toBe('bearish'); // D>W>P
    expect(classifyVwapStructure(2, 1, 3)).toBe('mixed'); // W>P>D
    expect(classifyVwapStructure(1, 2, 3)).toBe('strong_bearish'); // W>D>P
  });

  it('treats equality within the documented tolerance as structure, not repeated crossovers', () => {
    expect(classifyVwapStructure(100, 100 + 1e-7, 99)).toBe('bullish');
    expect(classifyVwapStructure(100, 100, 100)).toBe('mixed');
    const result = evaluateClosedVwapStructure(context(candles()));
    expect(result.crossover.event).toMatch(/crossed_above|crossed_below|none/);
    if (result.crossover.time == null) expect(result.crossover.barsSince).toBeNull();
    else expect(typeof result.crossover.barsSince).toBe('number');
  });
});

describe('Phase 4 POC structure state table', () => {
  it('classifies complete, partial, range, nearest, and insufficient stacks', () => {
    const c = context(candles());
    expect(derivePocStructure(110, pocs(100, 101, 102), c).state).toBe('fully_bullish');
    expect(derivePocStructure(90, pocs(100, 101, 102), c).state).toBe('fully_bearish');
    expect(derivePocStructure(103, pocs(100, 101, 110), c).state).toBe('bullish');
    expect(derivePocStructure(98, pocs(100, 101, 90), c).state).toBe('bearish');
    const range = derivePocStructure(102, pocs(100, 102, 110), c);
    expect(range.state).toBe('mixed_range');
    expect(range.nearest?.timeframe).toBe('daily');
    expect(derivePocStructure(100, pocs(null, 101, 102), c).state).toBe('insufficient_data');
  });
});

describe('Phase 4 closed/replay/prefix safety', () => {
  it('ignores forming mutations across all three engines', () => {
    const closed = candles();
    const a = context([...closed, { ...closed.at(-1)!, time: closed.at(-1)!.time + 3_600, close: 90_000, high: 91_000, volume: 9_000 }], { forming: true });
    const b = context([...closed, { ...closed.at(-1)!, time: closed.at(-1)!.time + 3_600, close: 10, low: 1, volume: 1 }], { forming: true });
    expect(evaluateClosedDerivedIntelligence(a)).toEqual(evaluateClosedDerivedIntelligence(b));
  });

  it('is replay and prefix invariant, including FVG mitigation, VWAP event, and developing POC', () => {
    const source = candles(300);
    const cutoff = source[239].time;
    const prefix = source.filter((candle) => candle.time <= cutoff);
    const replay = context(source, { replayCutoff: cutoff });
    const expected = context(prefix, { replayCutoff: cutoff });
    expect(evaluateClosedDerivedIntelligence(replay)).toEqual(evaluateClosedDerivedIntelligence(expected));
    expect(evaluateClosedFvgIntelligence(replay)).toEqual(evaluateClosedFvgIntelligence(expected));
  });
});

describe('Phase 4 UTC session boundaries', () => {
  it('resets daily and weekly VWAP at the project UTC boundaries', () => {
    const sunday = Date.UTC(2024, 0, 7, 23) / 1000;
    const monday = Date.UTC(2024, 0, 8) / 1000;
    const mondayLate = Date.UTC(2024, 0, 8, 23) / 1000;
    const tuesday = Date.UTC(2024, 0, 9) / 1000;
    const bar = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5 });
    const weekReset = evaluateClosedVwapStructure(context([bar(sunday, 10), bar(monday, 20)]));
    expect(weekReset.daily).toBe(20);
    expect(weekReset.weekly).toBe(20);
    const dayReset = evaluateClosedVwapStructure(context([bar(monday, 10), bar(mondayLate, 10), bar(tuesday, 20)]));
    expect(dayReset.daily).toBe(20);
    expect(dayReset.weekly).toBeCloseTo(40 / 3, 8);
  });

  it('keeps 4H/daily/weekly developing POCs inside their own UTC sessions', () => {
    const source = candles(200);
    const pocs = createClosedPocPrimitiveEvaluator()(context(source));
    expect(pocs.fourHour.startTime! % (4 * 3_600)).toBe(0);
    expect(pocs.daily.startTime! % 86_400).toBe(0);
    expect((pocs.weekly.startTime! + 259_200) % 604_800).toBe(0);
    expect(pocs.fourHour.state).toBe('developing');
    expect(pocs.daily.state).toBe('developing');
    expect(pocs.weekly.state).toBe('developing');
  });
});
