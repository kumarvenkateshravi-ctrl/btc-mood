import type { PriceWeeklyVwapCross, PriceWeeklyVwapCrossByTimeframe } from '@/lib/mtf/vwapCrossover';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';

const TF_LABEL: Record<Timeframe, string> = {
  '5m': '5M',
  '15m': '15M',
  '30m': '30M',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
};

type CrossLabel = 'Bull' | 'Bear' | 'None' | 'Waiting';

export function vwapCrossLabel(cross: PriceWeeklyVwapCross | null): CrossLabel {
  if (!cross || cross.relationship === 'unavailable') return 'Waiting';
  if (cross.relationship === 'above') return 'Bull';
  if (cross.relationship === 'below') return 'Bear';
  return 'None';
}

function labelTone(label: CrossLabel): string {
  if (label === 'Bull') return 'text-bull-bright';
  if (label === 'Bear') return 'text-bear-bright';
  return 'text-ink-faint';
}

function supportingLabel(cross: PriceWeeklyVwapCross | null): string {
  if (!cross || cross.relationship === 'unavailable') return 'Loading';
  if (cross.lastCross === 'none' || cross.barsSinceCross == null) {
    if (cross.relationship === 'above') return 'Price above';
    if (cross.relationship === 'below') return 'Price below';
    return 'At Weekly VWAP';
  }
  if (cross.barsSinceCross === 0) return 'Latest close';
  return `${cross.barsSinceCross} ${cross.barsSinceCross === 1 ? 'bar' : 'bars'} ago`;
}

function accessibleLabel(timeframe: Timeframe, cross: PriceWeeklyVwapCross | null): string {
  if (!cross || cross.relationship === 'unavailable') return `${TF_LABEL[timeframe]} price and Weekly VWAP data waiting.`;
  if (cross.lastCross === 'none') return `${TF_LABEL[timeframe]}: no confirmed price and Weekly VWAP crossover this week. Price is ${cross.relationship} Weekly VWAP.`;
  const direction = cross.lastCross === 'bullish' ? 'price crossed above' : 'price crossed below';
  const timing = cross.barsSinceCross === 0
    ? 'on the latest closed bar'
    : `${cross.barsSinceCross} ${cross.barsSinceCross === 1 ? 'bar' : 'bars'} ago`;
  return `${TF_LABEL[timeframe]}: ${direction} Weekly VWAP ${timing}. Price is currently ${cross.relationship} Weekly VWAP.`;
}

export default function VwapCrossMatrixRow({ crosses }: { crosses: PriceWeeklyVwapCrossByTimeframe }) {
  return (
    <tr className="group" title="Latest confirmed close relative to Weekly VWAP. The live forming candle is excluded.">
      <td className="border-b border-line/50 px-3 py-2 transition-colors group-hover:bg-surface-2/30">
        <div className="font-medium text-ink">VWAP Cross</div>
        <div className="text-[10px] text-ink-faint">Price / Weekly · closed bars</div>
      </td>
      {TIMEFRAMES.map((timeframe) => {
        const cross = crosses[timeframe];
        const label = vwapCrossLabel(cross);
        return (
          <td
            key={timeframe}
            className="border-b border-line/50 px-2 py-2 text-center"
            aria-label={accessibleLabel(timeframe, cross)}
          >
            <div className={`text-[13px] font-semibold ${labelTone(label)}`}>{label}</div>
            <div className="mt-0.5 whitespace-nowrap text-[10px] text-ink-faint">{supportingLabel(cross)}</div>
          </td>
        );
      })}
    </tr>
  );
}
