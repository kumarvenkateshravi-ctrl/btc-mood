import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computePocMrpZones } from './pocMrpZones';

function hourlyCandles(hours: number, start = Date.UTC(2026, 0, 5) / 1000): Candle[] {
  return Array.from({ length: hours }, (_, index) => {
    const dayWave = Math.sin(index / 11) * 12;
    const base = 1000 + index * 0.4 + dayWave;
    return {
      time: start + index * 3600,
      open: base,
      high: base + 8 + (index % 3),
      low: base - 7 - (index % 2),
      close: base + 2,
      volume: 10 + (index % 5),
    };
  });
}

function numberAt(plotData: ReturnType<typeof computePocMrpZones>['plots'][number]['data'], index: number) {
  const value = plotData[index];
  return typeof value === 'number' ? value : null;
}

describe('POC & MRP + Demand & Supply Zones', () => {
  it('resets the developing daily MRP at UTC midnight', () => {
    const candles: Candle[] = [
      { time: Date.UTC(2026, 0, 5, 22) / 1000, open: 90, high: 110, low: 90, close: 100, volume: 1 },
      { time: Date.UTC(2026, 0, 5, 23) / 1000, open: 100, high: 130, low: 100, close: 130, volume: 3 },
      { time: Date.UTC(2026, 0, 6, 0) / 1000, open: 200, high: 210, low: 190, close: 200, volume: 2 },
    ];
    const result = computePocMrpZones(candles);
    const mrp = result.plots.find((plot) => plot.id === 'mrp')!;
    expect(numberAt(mrp.data, 0)).toBe(100);
    expect(numberAt(mrp.data, 1)).toBe(115);
    expect(numberAt(mrp.data, 2)).toBe(200);
  });

  it('uses confirmed native blocks for exact 1H and 4H POC segments', () => {
    const result = computePocMrpZones(hourlyCandles(96), {
      id: 'poc_mrp_zones',
      settings: { inputs: { oneHourPocHistoryDays: 2 }, styles: {}, visibility: {} },
    });
    const oneHour = result.lineSegments!.filter((segment) => segment.styleId === 'one_hour_poc');
    const fourHour = result.lineSegments!.filter((segment) => segment.styleId === 'four_hour_poc');
    expect(oneHour).toHaveLength(48);
    expect(oneHour.at(-1)!.endTime - oneHour.at(-1)!.startTime).toBe(3600);
    expect(fourHour.length).toBeGreaterThan(0);
    expect(fourHour.at(-1)!.endTime - fourHour.at(-1)!.startTime).toBe(14400);
    expect(oneHour.at(-1)!.startValue).toBe(oneHour.at(-1)!.endValue);
  });

  it('warms up confirmed 4H, Daily, and Weekly ATR zones without using the current block range', () => {
    const candles = hourlyCandles(24 * 55);
    const first = computePocMrpZones(candles);
    const h4 = first.plots.find((plot) => plot.id === 'h4_strong_demand_lower')!;
    const daily = first.plots.find((plot) => plot.id === 'daily_strong_demand_lower')!;
    const weekly = first.plots.find((plot) => plot.id === 'weekly_strong_demand_lower')!;
    expect(numberAt(h4.data, -1 + candles.length)).not.toBeNull();
    expect(numberAt(daily.data, -1 + candles.length)).not.toBeNull();
    expect(numberAt(weekly.data, -1 + candles.length)).not.toBeNull();

    const changed = candles.map((candle) => ({ ...candle }));
    changed.at(-1)!.high += 5000;
    changed.at(-1)!.low -= 5000;
    const second = computePocMrpZones(changed);
    const changedH4 = second.plots.find((plot) => plot.id === 'h4_strong_demand_lower')!;
    expect(numberAt(changedH4.data, changed.length - 1)).toBe(numberAt(h4.data, candles.length - 1));
  });

  it('keeps lower-timeframe layers off on a daily chart', () => {
    const candles = hourlyCandles(24 * 30).filter((_, index) => index % 24 === 0);
    const result = computePocMrpZones(candles, undefined, undefined, {
      rawCandles: candles,
      displayCandles: candles,
      closedCandles: candles,
      hasFormingBar: false,
      symbol: 'BTCUSDT',
      timeframe: '1d',
      mode: 'live',
      transform: 'candlestick',
      sourceRevision: 'test',
      provenance: { raw: 'market', display: 'raw' },
    });
    expect(result.lineSegments).toHaveLength(0);
    expect(result.plots.find((plot) => plot.id === 'h4_strong_demand_lower')!.data.every((value) => value == null)).toBe(true);
  });
});
