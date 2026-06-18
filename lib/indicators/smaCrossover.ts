import type { Candle } from '../types';
import type { IndicatorResult, IndicatorPlot, CustomIndicatorConfig } from '../indicatorFramework';
import * as pm from '../pineMath';

export interface SMACrossoverConfig extends CustomIndicatorConfig {
  fastLen?: number;
  slowLen?: number;
  maType?: 'SMA' | 'EMA' | 'WMA' | 'RMA' | 'VWMA';
  useTrendFilter?: boolean;
  useBBFilter?: boolean;
  showBB?: boolean;
  bbLen?: number;
  bbMult?: number;
}

export function computeSMACrossover(candles: Candle[], config?: SMACrossoverConfig): IndicatorResult {
  const fastLen = config?.fastLen ?? 9;
  const slowLen = config?.slowLen ?? 21;
  const maType = config?.maType ?? 'EMA';
  const useTrendFilter = config?.useTrendFilter ?? true;
  const useBBFilter = config?.useBBFilter ?? false;
  const showBB = config?.showBB ?? true;
  const bbLen = config?.bbLen ?? 20;
  const bbMult = config?.bbMult ?? 2.0;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const ma = (src: (number | null)[], len: number, type: string) => {
    switch (type) {
      case 'SMA': return pm.sma(src, len);
      case 'EMA': return pm.ema(src, len);
      case 'WMA': return pm.wma(src, len);
      case 'RMA': return pm.rma(src, len);
      case 'VWMA': return pm.vwma(src, volumes, len);
      default: return pm.sma(src, len);
    }
  };

  const fastMA = ma(closes, fastLen, maType);
  const slowMA = ma(closes, slowLen, maType);

  const bbBasis = pm.sma(closes, bbLen);
  const bbDev = pm.multiply(pm.stdev(closes, bbLen), bbMult);
  const bbUpper = pm.add(bbBasis, bbDev);
  const bbLower = pm.subtract(bbBasis, bbDev);
  const bbWidth = pm.divide(pm.subtract(bbUpper, bbLower), bbBasis);
  const bbWidthAvg = pm.sma(bbWidth, bbLen);

  const rawBuy = pm.crossover(fastMA, slowMA);
  const rawSell = pm.crossunder(fastMA, slowMA);

  const signals = new Array<'buy' | 'sell' | 'neutral'>(candles.length).fill('neutral');

  for (let i = 0; i < candles.length; i++) {
    const close = closes[i];
    const sMA = slowMA[i];
    const width = bbWidth[i];
    const avgWidth = bbWidthAvg[i];

    const trendOK_buy = !useTrendFilter || (close !== null && sMA !== null && close > sMA);
    const trendOK_sell = !useTrendFilter || (close !== null && sMA !== null && close < sMA);
    const bbExpanding = width !== null && avgWidth !== null && width > avgWidth;
    const volOK = !useBBFilter || bbExpanding;

    const buySignal = rawBuy[i] && trendOK_buy && volOK;
    const sellSignal = rawSell[i] && trendOK_sell && volOK;

    if (buySignal) signals[i] = 'buy';
    else if (sellSignal) signals[i] = 'sell';
  }

  const plots: IndicatorPlot[] = [
    {
      id: 'fastMA',
      title: 'Fast MA',
      color: '#2962FF', // color.blue
      type: 'line',
      lineWidth: 2,
      data: fastMA,
    },
    {
      id: 'slowMA',
      title: 'Slow MA',
      color: '#FF9800', // color.orange
      type: 'line',
      lineWidth: 2,
      data: slowMA,
    },
  ];

  if (showBB) {
    const bbBandData = new Array<{ upper: number; lower: number } | null>(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
      if (bbUpper[i] !== null && bbLower[i] !== null) {
        bbBandData[i] = { upper: bbUpper[i]!, lower: bbLower[i]! };
      }
    }
    
    plots.push({
      id: 'bbBasis',
      title: 'BB Basis',
      color: 'rgba(120, 123, 134, 0.5)', // color.gray, 50%
      type: 'line',
      lineWidth: 1,
      data: bbBasis,
    });
    
    plots.push({
      id: 'bbFill',
      title: 'BB Fill',
      color: 'rgba(76, 175, 80, 0.08)', // green 92% transp
      type: 'band',
      data: bbBandData,
    });
  }

  return { plots, signals };
}
