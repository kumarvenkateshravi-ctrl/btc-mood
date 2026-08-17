// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { placeOrder, reconcileLiveTick, __resetForTest, __getStateForTest as getState } from './paperStore';

// The bug: a freshly-placed market position vanished instantly because the
// live path reconciled against a forming candle's full high/low (incl. the
// daily candle's whole-day range), retroactively filling SL/TP.

function reset() {
  __resetForTest();
}

describe('reconcileLiveTick', () => {
  beforeEach(reset);

  it('does NOT close a fresh position on a tick that only moves slightly', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 66000, sl: 63000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    expect(getState().positions['BTCUSDT']?.side).toBe('long');
    // a normal live tick near entry must not touch the far-away SL/TP
    reconcileLiveTick('BTCUSDT', 65010, 1000);
    reconcileLiveTick('BTCUSDT', 64990, 1001);
    expect(getState().positions['BTCUSDT']?.side).toBe('long');
  });

  it('does NOT retroactively fill from a stale low: SL below entry survives until price actually reaches it', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 66000, sl: 63000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    // simulate the old failure input: the daily forming candle's low was 62000,
    // but we now feed TICKS. Price ticks up, never reaching 63000.
    reconcileLiveTick('BTCUSDT', 65200, 2000);
    reconcileLiveTick('BTCUSDT', 65500, 2001);
    expect(getState().positions['BTCUSDT']?.side).toBe('long');
  });

  it('DOES close when the live price actually ticks down through the stop', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 66000, sl: 63000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    reconcileLiveTick('BTCUSDT', 64000, 3000); // still above stop
    expect(getState().positions['BTCUSDT']?.side).toBe('long');
    reconcileLiveTick('BTCUSDT', 62950, 3001); // ticks through 63000
    const pos = getState().positions['BTCUSDT'];
    expect(pos == null || pos.side === 'flat').toBe(true);
  });

  it('DOES fill take-profit when price ticks up through it', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 66000, sl: 63000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    reconcileLiveTick('BTCUSDT', 66050, 4000); // through TP
    const pos = getState().positions['BTCUSDT'];
    expect(pos == null || pos.side === 'flat').toBe(true);
  });
});
