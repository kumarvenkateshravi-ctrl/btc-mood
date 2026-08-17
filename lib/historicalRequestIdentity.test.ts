import { describe, expect, it } from 'vitest';
import { HistoricalRequestGate } from './historicalRequestIdentity';

describe('HistoricalRequestGate', () => {
  it('rejects a stale BTC response after the BTC → XAUUSD → BTC ABA sequence', () => {
    const gate = new HistoricalRequestGate();
    const firstBtc = gate.begin('BTCUSDT', '5m', 'lazy');

    gate.invalidate(); // XAUUSD
    gate.begin('XAUUSD', '5m', 'lazy');
    gate.invalidate(); // BTCUSDT again
    const currentBtc = gate.begin('BTCUSDT', '5m', 'lazy');

    expect(firstBtc.signal.aborted).toBe(true);
    expect(firstBtc.isCurrent()).toBe(false);
    expect(currentBtc.isCurrent()).toBe(true);
  });

  it('accepts only the final request during rapid 5m → 15m → 1h switching', () => {
    const gate = new HistoricalRequestGate();
    const fiveMinute = gate.begin('BTCUSDT', '5m', 'history-window');
    gate.invalidate();
    const fifteenMinute = gate.begin('BTCUSDT', '15m', 'history-window');
    gate.invalidate();
    const oneHour = gate.begin('BTCUSDT', '1h', 'history-window');

    const committed: string[] = [];
    oneHour.ifCurrent(() => committed.push('1h'));
    fifteenMinute.ifCurrent(() => committed.push('15m'));
    fiveMinute.ifCurrent(() => committed.push('5m'));

    expect(fiveMinute.isCurrent()).toBe(false);
    expect(fifteenMinute.isCurrent()).toBe(false);
    expect(oneHour.isCurrent()).toBe(true);
    expect(fiveMinute.signal.aborted).toBe(true);
    expect(fifteenMinute.signal.aborted).toBe(true);
    expect(committed).toEqual(['1h']);
  });

  it('supersedes an older request for the same symbol and timeframe, even across operations', () => {
    const gate = new HistoricalRequestGate();
    const lazy = gate.begin('BTCUSDT', '1h', 'lazy');
    const deep = gate.begin('BTCUSDT', '1h', 'deep');

    expect(lazy.signal.aborted).toBe(true);
    expect(lazy.isCurrent()).toBe(false);
    expect(deep.isCurrent()).toBe(true);
  });

  it('never runs a stale deep-load completion that would start Bar Replay', () => {
    const gate = new HistoricalRequestGate();
    const deep = gate.begin('BTCUSDT', '1h', 'deep');
    let replayStarted = false;

    gate.invalidate();
    deep.ifCurrent(() => {
      replayStarted = true;
    });

    expect(replayStarted).toBe(false);
  });
});
