import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import {
  canStartReplayFromIntegrity,
  captureReplayDataset,
  clearReplayDataset,
  clearReplayDatasetForSymbol,
  getReplayDataset,
} from './replayDataset';
import { replayActions } from './replayState';

const candle = (time: number, close: number): Candle => ({
  time, open: close - 1, high: close + 2, low: close - 2, close, volume: 10,
});

function source(): Partial<Record<Timeframe, Candle[]>> {
  return {
    '5m': [candle(0, 100), candle(300, 101), candle(600, 102)],
    '15m': [candle(0, 100), candle(900, 103)],
    '1h': [candle(0, 100)],
  };
}

describe('immutable replay dataset snapshot', () => {
  beforeEach(() => {
    replayActions.exit();
    clearReplayDataset();
  });

  it('does not change when live data appends after replay starts', () => {
    const live = source();
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: live });
    const capturedLength = getReplayDataset().candlesByTf['5m']!.length;

    live['5m']!.push(candle(900, 104));

    expect(getReplayDataset().candlesByTf['5m']).toHaveLength(capturedLength);
  });

  it('does not change when a live forming candle is updated after capture', () => {
    const live = source();
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: live });

    live['5m']![2].close = 999;
    live['5m']![2].high = 1_000;

    expect(getReplayDataset().candlesByTf['5m']![2]).toMatchObject({ close: 102, high: 104 });
  });

  it('supplies the captured data for replay analytics and visual timeframe changes', () => {
    const live = source();
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: live });
    live['1h']![0].close = 777;

    const snapshot = getReplayDataset();
    expect(snapshot.candlesByTf['5m']![1].close).toBe(101);
    expect(snapshot.candlesByTf['1h']![0].close).toBe(100);
    expect(snapshot.executionTf).toBe('5m');
  });

  it('captures the exact deep-loaded execution-timeframe history available at start', () => {
    const live = source();
    const deepLoaded = [candle(-600, 98), candle(-300, 99), ...live['5m']!];
    captureReplayDataset({
      symbol: 'BTCUSDT',
      executionTf: '5m',
      candlesByTf: { ...live, '5m': deepLoaded },
    });

    expect(getReplayDataset().candlesByTf['5m']![0].time).toBe(-600);
    expect(getReplayDataset().candlesByTf['5m']).toHaveLength(5);
  });

  it('clears on replay exit and rejects unavailable or demo data', () => {
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: source() });
    replayActions.enterSelecting();
    replayActions.startAt(1, 600);
    replayActions.exit();

    expect(getReplayDataset().active).toBe(false);
    captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: source() });
    clearReplayDatasetForSymbol('XAUUSD');
    expect(getReplayDataset().active).toBe(false);
    expect(canStartReplayFromIntegrity('unavailable')).toBe(false);
    expect(canStartReplayFromIntegrity('demo')).toBe(false);
    expect(canStartReplayFromIntegrity('live')).toBe(true);
  });
});
