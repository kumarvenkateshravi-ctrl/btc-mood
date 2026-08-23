import { describe, expect, it } from 'vitest';
import { createLatestFrameQueue } from './marketDataBatching';

describe('forming market-data frame queue', () => {
  it('keeps only the latest forming candle for each timeframe', () => {
    const flushed: Array<Record<string, number>> = [];
    const queue = createLatestFrameQueue<number>((updates) => flushed.push(updates));

    queue.enqueue('5m', 1);
    queue.enqueue('5m', 2);
    queue.enqueue('15m', 7);
    expect(queue.pending()).toEqual({ '5m': 2, '15m': 7 });
    expect(flushed).toEqual([]);

    queue.flush();
    expect(flushed).toEqual([{ '5m': 2, '15m': 7 }]);
    expect(queue.pending()).toEqual({});
  });

  it('schedules one frame for many updates and preserves a later frame', () => {
    const scheduled: Array<() => void> = [];
    const flushed: Array<Record<string, number>> = [];
    const queue = createLatestFrameQueue<number>((updates) => flushed.push(updates), (cb) => scheduled.push(cb));

    queue.enqueue('5m', 1);
    queue.enqueue('5m', 2);
    queue.enqueue('5m', 3);
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(flushed).toEqual([{ '5m': 3 }]);

    queue.enqueue('5m', 4);
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(flushed).toEqual([{ '5m': 3 }, { '5m': 4 }]);
  });
});
