export type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * Taker-buy base volume for the bar, when the source provides it (Binance
   * klines do). Sell volume is `volume - takerBuyVolume`. Optional because
   * synthetic/WS-merged candles don't carry it. See lib/dailyOrderFlow.ts.
   */
  takerBuyVolume?: number;
}

export interface Signal {
  side: 'buy' | 'sell' | 'neutral';
  source: string;
  fresh?: boolean;
}

export const TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];
