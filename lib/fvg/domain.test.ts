import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeFvgDomain, type FvgPolicy } from './domain';
import { detectFvgs } from '../indicators/maFvg/fvg';
import { createFvgEngine } from '../smc/fvg';
import { resolveSmcConfig, type SmcEvent } from '../smc/types';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { computeMaFvg } from '../indicators/maFvg';

const bar = (open: number, high: number, low: number, close: number, time: number): Candle => ({
  time, open, high, low, close, volume: 100,
});

const bullish = (tail: Candle[] = []): Candle[] => [
  bar(100, 101, 99, 100, 0),
  bar(101, 104, 100.5, 103, 60),
  bar(104, 106, 103, 105, 120),
  ...tail,
];

const bearish = (tail: Candle[] = []): Candle[] => [
  bar(100, 110, 108, 109, 0),
  bar(108, 109, 105, 106, 60),
  bar(105, 106, 103, 104, 120),
  ...tail,
];

const policy: FvgPolicy = {
  source: 'raw',
  sourceTimeframe: '5m',
  requireClosedBars: true,
  threshold: { method: 'none', value: 0 },
  mitigation: 'wick',
  partialFill: 'track',
  maxAgeBars: 500,
  maxHistory: 100,
};

describe('unified FVG domain characterization', () => {
  it('creates a bullish and bearish gap from raw closed candles', () => {
    expect(computeFvgDomain(bullish(), policy).filter((g) => g.direction === 'bullish')).toHaveLength(1);
    expect(computeFvgDomain(bearish(), policy).filter((g) => g.direction === 'bearish')).toHaveLength(1);
  });

  it('tracks partial fill and then deterministic full mitigation', () => {
    const result = computeFvgDomain(bullish([
      bar(105, 106, 104, 105, 180),
      bar(104, 105, 102.9, 103.5, 240),
      bar(103, 104, 99, 100, 300),
    ]), policy);
    const gap = result[0];
    expect(gap.lifecycle).toBe('mitigated');
    expect(gap.fillPercent).toBe(100);
    expect(gap.active).toBe(false);
  });

  it('does not persist a gap from a forming bar when closed-bar policy is enabled', () => {
    const bars = bullish();
    const closed = computeFvgDomain(bars.slice(0, -1), policy);
    const withForming = computeFvgDomain(bars, policy, { hasFormingBar: true });
    expect(withForming).toEqual(closed);
  });

  it('same candles and same policy are deterministic', () => {
    expect(computeFvgDomain(bullish(), policy)).toEqual(computeFvgDomain(bullish(), { ...policy }));
  });
  it('raw analytical output is unchanged by HA/Renko display candles', () => {
    const raw = bullish();
    const transformed = raw.map((c, i) => ({ ...c, open: c.open + 20, close: c.close + 20, high: c.high + 20, low: c.low + 20, time: c.time + i }));
    const rawResult = computeFvgDomain(raw, policy, { rawCandles: raw, displayCandles: raw });
    const haResult = computeFvgDomain(transformed, policy, { rawCandles: raw, displayCandles: transformed });
    expect(haResult).toEqual(rawResult);
  });

  it('replay evaluation is prefix-causal and does not consume future candles', () => {
    const all = bullish();
    const full = computeFvgDomain(all, policy);
    const prefix = all.slice(0, 3);
    expect(computeFvgDomain(prefix, policy, { rawCandles: prefix })).toEqual(full.filter((g) => g.createdIndex < 3));
  });

  it('MA/FVG adapter is backed by the same deterministic domain shape', () => {
    const result = detectFvgs(bullish(), { thresholdPct: 0, auto: false });
    const domain = computeFvgDomain(bullish(), policy);
    expect(result.fvgs.map((g) => ({ isBull: g.isBull, top: g.top, bottom: g.bottom, startIndex: g.startIndex })))
      .toEqual(domain.map((g) => ({ isBull: g.direction === 'bullish', top: g.top, bottom: g.bottom, startIndex: g.createdIndex })));
  });
  it('SMC and MA/FVG adapters agree when given one explicit policy', () => {
    const shared = { source: 'raw' as const, requireClosedBars: false, threshold: { method: 'none' as const, value: 0 }, mitigation: 'close' as const, partialFill: 'track' as const, mitigationTiming: 'beforeCreation' as const };
    const events: SmcEvent[] = [];
    const smc = createFvgEngine(bullish(), resolveSmcConfig({ fvgAutoThreshold: false }), events, undefined, shared);
    bullish().forEach((_, i) => smc.onBar(i));
    const ma = detectFvgs(bullish(), { thresholdPct: 0, auto: false }, shared);
    expect(smc.gaps.map((g) => ({ direction: g.direction, top: g.top, bottom: g.bottom, state: g.state })))
      .toEqual(ma.fvgs.map((g) => ({ direction: g.isBull ? 'bullish' : 'bearish', top: g.top, bottom: g.bottom, state: g.endIndex == null ? 'active' : 'mitigated' })));
  });
  it('MA/FVG composite stays raw-source invariant across display transforms', () => {
    const raw = bullish();
    const display = raw.map((c) => ({ ...c, open: c.open + 10, close: c.close + 10, high: c.high + 10, low: c.low + 10 }));
    const rawContext = createIndicatorEvaluationContext({ rawCandles: raw, displayCandles: raw, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', sourceRevision: 'fvg-raw' });
    const transformedContext = createIndicatorEvaluationContext({ rawCandles: raw, displayCandles: display, symbol: 'BTCUSDT', timeframe: '5m', mode: 'live', transform: 'heikinAshi', sourceRevision: 'fvg-raw' });
    const fvg = (r: ReturnType<typeof computeMaFvg>) => r.plots.filter((p) => p.id.startsWith('fvg_')).map((p) => p.data);
    expect(fvg(computeMaFvg(raw, undefined, undefined, rawContext))).toEqual(fvg(computeMaFvg(display, undefined, undefined, transformedContext)));
  });
  it('applies wick and close mitigation as explicit policies', () => {
    const wick = computeFvgDomain(bullish([bar(104, 105, 100.9, 103, 180)]), policy);
    expect(wick[0].lifecycle).toBe('mitigated');
    const close = computeFvgDomain(bullish([bar(104, 105, 100.9, 102, 180)]), {
      ...policy, mitigation: 'close',
    });
    expect(close[0].lifecycle).toBe('partiallyMitigated');
    expect(close[0].active).toBe(true);
  });

  it('archives over-age objects through the shared lifecycle policy', () => {
    const result = computeFvgDomain(bullish([
      bar(104, 105, 102, 103, 180),
      bar(103, 104, 102, 103, 240),
    ]), { ...policy, maxAgeBars: 0 });
    expect(result[0].lifecycle).toBe('archived');
    expect(result[0].active).toBe(false);
  });
  it('records raw source and replay provenance on immutable objects', () => {
    const bars = bullish();
    const objects = computeFvgDomain(bars, { ...policy, sourceTimeframe: '1m' }, {
      rawCandles: bars,
      symbol: 'BTCUSDT',
      mode: 'replay',
      sourceRevision: 'rev-7',
      replay: { sessionId: 'session-1', cutTime: 120 },
    });
    expect(objects[0]).toMatchObject({ source: 'raw', sourceTimeframe: '1m', provenance: {
      symbol: 'BTCUSDT', mode: 'replay', sourceRevision: 'rev-7', replay: { sessionId: 'session-1', cutTime: 120 },
    }});
  });
});
