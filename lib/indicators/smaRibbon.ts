import type { Candle } from '../types';
import type { IndicatorResult, IndicatorPlot, CustomIndicatorConfig } from '../indicatorFramework';
import * as pm from '../pineMath';

export interface SMARibbonConfig extends CustomIndicatorConfig {
  strictness?: number;
  showFlipOnly?: boolean;
}

export function computeSMARibbon(candles: Candle[], config?: SMARibbonConfig): IndicatorResult {
  const strictness = config?.strictness ?? 9;
  const showFlipOnly = config?.showFlipOnly ?? true;

  const lengths = [20, 50, 100, 150, 200, 250, 300, 400, 500, 600];
  const closes = candles.map((c) => c.close);

  const smas = lengths.map(len => pm.sma(closes, len));

  const signals = new Array<'buy' | 'sell' | 'neutral'>(candles.length).fill('neutral');
  const isBullArr = new Array<boolean>(candles.length).fill(false);
  const isBearArr = new Array<boolean>(candles.length).fill(false);
  
  // Lightweight charts takes rgba or hex.
  const cBull = 'rgba(76, 175, 80, 0.7)'; // green 30 transp
  const cBear = 'rgba(244, 67, 54, 0.7)'; // red 30 transp
  const cNeutral = 'rgba(158, 158, 158, 0.6)'; // gray 40 transp
  const ribbonColors = new Array<string>(candles.length).fill(cNeutral);

  for (let i = 0; i < candles.length; i++) {
    let bullCount = 0;
    let bearCount = 0;

    for (let j = 0; j < smas.length - 1; j++) {
      const a = smas[j][i];
      const b = smas[j + 1][i];
      if (a !== null && b !== null) {
        if (a > b) bullCount++;
        else if (a < b) bearCount++;
      }
    }

    const isBull = bullCount >= strictness;
    const isBear = bearCount >= strictness;
    isBullArr[i] = isBull;
    isBearArr[i] = isBear;

    ribbonColors[i] = isBull ? cBull : isBear ? cBear : cNeutral;

    const prevBull = i > 0 ? isBullArr[i - 1] : false;
    const prevBear = i > 0 ? isBearArr[i - 1] : false;

    const buySignal = showFlipOnly ? (isBull && !prevBull) : isBull;
    const sellSignal = showFlipOnly ? (isBear && !prevBear) : isBear;

    if (buySignal) signals[i] = 'buy';
    else if (sellSignal) signals[i] = 'sell';
  }

  const plots: IndicatorPlot[] = [];
  const lineWidths = [1, 2, 1, 1, 3, 1, 2, 1, 1, 3];

  for (let j = 0; j < smas.length; j++) {
    // We map data to include the color per segment
    // But IndicatorPlot signature is (number | null)[]. We need to update it!
    // Wait, let's update IndicatorPlot in indicatorFramework.ts to support { value, color }
    const coloredData = smas[j].map((val, i) => {
      if (val === null) return null;
      return { value: val, color: ribbonColors[i] };
    });

    plots.push({
      id: `sma_${lengths[j]}`,
      title: `SMA ${lengths[j]}`,
      color: cNeutral, // Base color
      type: 'line',
      lineWidth: lineWidths[j],
      data: coloredData as any, // Cast to any for now until we update the interface
    });
  }

  return { plots, signals };
}
