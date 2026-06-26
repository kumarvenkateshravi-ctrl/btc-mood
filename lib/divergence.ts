// Cross-timeframe divergence detection.
//
// The actionable moment a trader cares about: the lower timeframes flipping
// against the higher ones (e.g. 1m–15m turn bearish while 1h–1d hold bullish).
// Reads the already-computed per-TF snapshots; pure + testable.

import type { Timeframe } from './types';
import type { TFSnapshot } from './signals';

export type Bias = 'bullish' | 'bearish' | 'neutral';

export const LOWER_TFS: Timeframe[] = ['5m', '15m'];
export const HIGHER_TFS: Timeframe[] = ['1h', '4h', '1d'];

export interface GroupBias {
  bias: Bias;
  buy: number;
  sell: number;
  neutral: number;
  count: number;
}

export function groupBias(
  snapshots: Record<Timeframe, TFSnapshot | null>,
  tfs: Timeframe[],
): GroupBias {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const tf of tfs) {
    const s = snapshots[tf];
    if (!s) continue;
    const side = s.signal.side;
    if (side === 'buy') buy++;
    else if (side === 'sell') sell++;
    else neutral++;
  }
  const count = buy + sell + neutral;
  const bias: Bias = buy > sell ? 'bullish' : sell > buy ? 'bearish' : 'neutral';
  return { bias, buy, sell, neutral, count };
}

export interface Divergence {
  diverging: boolean;
  lower: Bias;
  higher: Bias;
  /** Plain-language read of the divergence (empty when not diverging). */
  message: string;
}

export function detectDivergence(
  snapshots: Record<Timeframe, TFSnapshot | null>,
): Divergence {
  const lower = groupBias(snapshots, LOWER_TFS);
  const higher = groupBias(snapshots, HIGHER_TFS);

  const diverging =
    (lower.bias === 'bullish' && higher.bias === 'bearish') ||
    (lower.bias === 'bearish' && higher.bias === 'bullish');

  let message = '';
  if (diverging) {
    const watch =
      lower.bias === 'bearish'
        ? 'short-term weakness against the higher-timeframe trend — watch for a pullback'
        : 'short-term strength against the higher-timeframe trend — watch for a bounce';
    message = `Lower timeframes (1m–15m) are ${lower.bias} while higher timeframes (1h–1d) are ${higher.bias}: ${watch}.`;
  }

  return { diverging, lower: lower.bias, higher: higher.bias, message };
}
