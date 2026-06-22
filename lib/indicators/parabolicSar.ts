import * as its from 'indicatorts';
import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import { alignRight, cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface PsarInputs {
  step: number;
  max: number;
}

const DEFAULTS: PsarInputs = { step: 0.02, max: 0.2 };

const RISING = '#26A69A';
const FALLING = '#F23645';

/**
 * Parabolic SAR — trailing stop-and-reverse dots on the price pane. Bucket A:
 * `indicatorts.psar`. Each point is colored by trend (dot at or below close =
 * rising/green, above close = falling/red).
 *
 * NOTE: the framework renders 'line' as a connected series; PSAR is really a
 * scatter of dots. It reads fine but a dedicated point-marker plot type would
 * be a future refinement.
 */
export function computeParabolicSar(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { step, max } = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  if (n < 2) {
    return {
      plots: [{ id: 'psar', title: 'PSAR', color: RISING, type: 'line', pane: 'overlay', data: new Array(n).fill(null) }],
      signals: neutralSignals(n),
    };
  }

  const r = its.psar(cols.high(candles), cols.low(candles), cols.close(candles), {
    step,
    max,
  });
  const vals = alignRight(r.psarResult, n);
  const colored = vals.map((v, i) =>
    v === null ? null : { value: v, color: v <= candles[i].close ? RISING : FALLING },
  );

  const plots: IndicatorPlot[] = [
    { id: 'psar', title: 'PSAR', color: RISING, type: 'line', pane: 'overlay', lineWidth: 2, data: colored as IndicatorPlot['data'] },
  ];

  return { plots, signals: neutralSignals(n) };
}
