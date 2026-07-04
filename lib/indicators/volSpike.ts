import type { Candle } from '../types';
import type { IndicatorResult, IndicatorMarker, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import * as pm from '../pineMath';
import { resolveInputs } from './itsTemplates';

interface VolSpikeInputs { length: number; mult: number; }
const DEFAULTS: VolSpikeInputs = { length: 20, mult: 1.8 };

const BUY_BLUE = '#2962FF';
const SELL_DARK = '#131722';

/** Marks bars whose volume exceeds `mult × SMA(volume, length)`: blue up-arrow
 *  below an up-close (major buying), dark down-arrow above a down-close. */
export function computeVolSpike(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { length, mult } = resolveInputs<VolSpikeInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const volMa = pm.sma(candles.map((c) => c.volume), length);
  const markers: IndicatorMarker[] = [];

  for (let i = 0; i < n; i++) {
    const ma = volMa[i];
    if (ma === null || ma <= 0) continue;
    if (candles[i].volume > ma * mult) {
      const up = candles[i].close >= candles[i].open;
      markers.push({
        index: i,
        position: up ? 'belowBar' : 'aboveBar',
        color: up ? BUY_BLUE : SELL_DARK,
        shape: up ? 'arrowUp' : 'arrowDown',
        text: up ? 'B' : 'S',
      });
    }
  }
  return { plots: [], signals, markers };
}
