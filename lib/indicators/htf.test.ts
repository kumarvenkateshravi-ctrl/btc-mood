import { describe, it, expect } from 'vitest';
import { periodKey, priorPeriodOHLC, HTF_PERIOD_SECONDS } from './htf';
import type { Candle } from '../types';

const c = (timeSec: number, o: number, h: number, l: number, cl: number, v = 1): Candle =>
  ({ time: timeSec, open: o, high: h, low: l, close: cl, volume: v });

const DAY = 86400;

describe('periodKey', () => {
  it('4H buckets every 14400s', () => {
    expect(periodKey(0, '4H')).toBe(0);
    expect(periodKey(14399, '4H')).toBe(0);
    expect(periodKey(14400, '4H')).toBe(1);
  });
  it('D buckets per UTC day', () => {
    expect(periodKey(0, 'D')).toBe(0);
    expect(periodKey(DAY - 1, 'D')).toBe(0);
    expect(periodKey(DAY, 'D')).toBe(1);
  });
  it('W buckets Monday-start (epoch day 0 is Thursday)', () => {
    // 1970-01-01 Thu .. 1970-01-04 Sun => week 0; 1970-01-05 Mon => week 1
    expect(periodKey(0, 'W')).toBe(periodKey(3 * DAY, 'W'));
    expect(periodKey(4 * DAY, 'W')).toBe(periodKey(0, 'W') + 1);
  });
  it('M buckets per UTC calendar month', () => {
    const jan = Date.UTC(2021, 0, 15) / 1000;
    const feb = Date.UTC(2021, 1, 3) / 1000;
    expect(periodKey(feb, 'M')).toBe(periodKey(jan, 'M') + 1);
  });
});

describe('priorPeriodOHLC', () => {
  it('empty input returns []', () => {
    expect(priorPeriodOHLC([], 'D')).toEqual([]);
  });
  it('is null within the first period, then the prior completed period', () => {
    // Day 0: two bars; Day 1: one bar; Day 2: one bar.
    const candles = [
      c(0, 10, 12, 9, 11, 5),        // day 0
      c(3600, 11, 15, 10, 14, 7),    // day 0  -> day0 OHLC: o10 h15 l9 c14 v12
      c(DAY, 14, 16, 13, 15, 3),     // day 1  -> prior = day0
      c(2 * DAY, 15, 15, 8, 9, 4),   // day 2  -> prior = day1 (o14 h16 l13 c15 v3)
    ];
    const prior = priorPeriodOHLC(candles, 'D');
    expect(prior[0]).toBeNull();
    expect(prior[1]).toBeNull();
    expect(prior[2]).toEqual({ open: 10, high: 15, low: 9, close: 14, volume: 12, startTime: 0 });
    expect(prior[3]).toEqual({ open: 14, high: 16, low: 13, close: 15, volume: 3, startTime: DAY });
  });
  it('never looks ahead: a bar only sees periods that closed before its period', () => {
    const candles = [c(0, 1, 2, 0, 1, 1), c(DAY, 5, 9, 4, 8, 1)];
    const prior = priorPeriodOHLC(candles, 'D');
    // bar 1 (day 1) must NOT see its own day; only day 0.
    expect(prior[1]).toEqual({ open: 1, high: 2, low: 0, close: 1, volume: 1, startTime: 0 });
  });
});

describe('intraday periods', () => {
  it('periodKey buckets 15M/30M/1H/2H on fixed boundaries', () => {
    const t = Date.UTC(2026, 0, 1, 10, 44) / 1000; // 10:44 UTC
    expect(periodKey(t, '15M')).toBe(Math.floor(t / 900));
    expect(periodKey(t, '15M')).toBe(periodKey(t - 14 * 60, '15M')); // same 15m bucket as 10:30
    expect(periodKey(t, '15M')).not.toBe(periodKey(t + 60, '15M')); // 10:45 = next bucket
    expect(periodKey(t, '1H')).toBe(periodKey(Date.UTC(2026, 0, 1, 10, 0) / 1000, '1H'));
    expect(periodKey(t, '1H')).not.toBe(periodKey(Date.UTC(2026, 0, 1, 11, 0) / 1000, '1H'));
    expect(periodKey(t, '2H')).toBe(periodKey(Date.UTC(2026, 0, 1, 10, 1) / 1000, '2H'));
    expect(periodKey(t, '30M')).toBe(periodKey(Date.UTC(2026, 0, 1, 10, 31) / 1000, '30M'));
  });

  it('HTF_PERIOD_SECONDS covers every fixed-width period', () => {
    expect(HTF_PERIOD_SECONDS['15M']).toBe(900);
    expect(HTF_PERIOD_SECONDS['30M']).toBe(1800);
    expect(HTF_PERIOD_SECONDS['1H']).toBe(3600);
    expect(HTF_PERIOD_SECONDS['2H']).toBe(7200);
    expect(HTF_PERIOD_SECONDS['4H']).toBe(14400);
    expect(HTF_PERIOD_SECONDS.D).toBe(86400);
    expect(HTF_PERIOD_SECONDS.W).toBeUndefined(); // calendar periods
  });
});
