import { describe, expect, it, vi } from 'vitest';
import { writeIndicatorSeries, type IndicatorSeriesSnapshot } from './indicatorSeriesWrites';

type Point = { time: number; value: number; color?: string };
const candles = [
  { time: 10, open: 1, high: 2, low: 0, close: 1, volume: 1 },
  { time: 20, open: 2, high: 3, low: 1, close: 2, volume: 1 },
  { time: 30, open: 3, high: 4, low: 2, close: 3, volume: 1 },
];

function mockSeries() {
  return { setData: vi.fn(), update: vi.fn() };
}

function write(series: ReturnType<typeof mockSeries>, raw: unknown[], snapshot?: IndicatorSeriesSnapshot, structural = false) {
  return writeIndicatorSeries<Point>({
    series,
    raw,
    candles,
    structural,
    timeOf: (point) => point.time,
    format: (value, index) => typeof value === 'number' ? { time: candles[index].time, value } : null,
  }, snapshot);
}

describe('writeIndicatorSeries', () => {
  it('uses setData for an initial structural replacement', () => {
    const series = mockSeries();
    const result = write(series, [1, 2, 3]);
    expect(series.setData).toHaveBeenCalledWith([{ time: 10, value: 1 }, { time: 20, value: 2 }, { time: 30, value: 3 }]);
    expect(series.update).not.toHaveBeenCalled();
    expect(result.wrote).toBe('full');
  });

  it('uses update for a compatible forming tail and single-bar append', () => {
    const series = mockSeries();
    let snapshot = write(series, [1, 2, 3]).snapshot;
    series.setData.mockClear();
    snapshot = write(series, [1, 2, 4], snapshot).snapshot;
    expect(series.update).toHaveBeenLastCalledWith({ time: 30, value: 4 });
    expect(series.setData).not.toHaveBeenCalled();

    const appendCandles = [...candles, { ...candles[2], time: 40 }];
    const append = writeIndicatorSeries<Point>({
      series,
      raw: [1, 2, 4, 5],
      candles: appendCandles,
      structural: false,
      timeOf: (point) => point.time,
      format: (value, index) => typeof value === 'number' ? { time: appendCandles[index].time, value } : null,
    }, snapshot);
    expect(append.wrote).toBe('tail');
    expect(series.update).toHaveBeenLastCalledWith({ time: 40, value: 5 });
    expect(series.setData).not.toHaveBeenCalled();
  });

  it('does not write unchanged outputs', () => {
    const series = mockSeries();
    const snapshot = write(series, [1, 2, 3]).snapshot;
    series.setData.mockClear();
    const result = write(series, [1, 2, 3], snapshot);
    expect(result.wrote).toBe('none');
    expect(series.setData).not.toHaveBeenCalled();
    expect(series.update).not.toHaveBeenCalled();
  });

  it('falls back to full replacement for structural, repainting, and gap-removal changes', () => {
    const series = mockSeries();
    const snapshot = write(series, [1, 2, 3]).snapshot;
    series.setData.mockClear();
    expect(write(series, [1, 9, 4], snapshot).wrote).toBe('full');
    expect(series.setData).toHaveBeenCalledTimes(1);

    series.setData.mockClear();
    expect(write(series, [1, 2, 3], snapshot, true).wrote).toBe('full');
    expect(series.setData).toHaveBeenCalledTimes(1);

    const gapSnapshot = write(mockSeries(), [1, 2, 3]).snapshot;
    expect(write(series, [1, 2, null], gapSnapshot).wrote).toBe('full');
  });

  it('preserves histogram colors and uses a full replacement when history has changed', () => {
    const series = mockSeries();
    const format = (value: unknown, index: number) => value && typeof value === 'object'
      ? { time: candles[index].time, value: (value as { value: number }).value, color: (value as { color: string }).color }
      : null;
    const initial = writeIndicatorSeries<Point>({ series, raw: [{ value: 1, color: 'red' }, { value: 2, color: 'blue' }, { value: 3, color: 'green' }], candles, structural: false, timeOf: (point) => point.time, format });
    series.setData.mockClear();
    const updated = writeIndicatorSeries<Point>({ series, raw: [{ value: 1, color: 'red' }, { value: 2, color: 'blue' }, { value: 4, color: 'yellow' }], candles, structural: false, timeOf: (point) => point.time, format }, initial.snapshot);
    expect(updated.wrote).toBe('tail');
    expect(series.update).toHaveBeenCalledWith({ time: 30, value: 4, color: 'yellow' });
  });
});
