import { Num } from '@/components/ui';
import type { ActiveFvgCounts, ActiveFvgCountsByTimeframe } from '@/lib/mtf/fvgActivity';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';

const TF_LABEL: Record<Timeframe, string> = {
  '5m': '5M',
  '15m': '15M',
  '30m': '30M',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
};

export type FvgBalanceLabel = 'Bull' | 'Bear' | 'Mixed' | 'None';

export function fvgBalanceLabel(counts: ActiveFvgCounts): FvgBalanceLabel {
  if (counts.bullish > counts.bearish) return 'Bull';
  if (counts.bearish > counts.bullish) return 'Bear';
  return counts.total === 0 ? 'None' : 'Mixed';
}

function balanceTone(label: FvgBalanceLabel): string {
  if (label === 'Bull') return 'text-bull-bright';
  if (label === 'Bear') return 'text-bear-bright';
  if (label === 'Mixed') return 'text-regime-hot';
  return 'text-ink-faint';
}

export default function FvgMatrixRow({ counts }: { counts: ActiveFvgCountsByTimeframe }) {
  return (
    <tr className="group" title="Active Fair Value Gaps created on the latest closed candle's UTC day. Counts are Bullish/Bearish.">
      <td className="border-b border-line/50 px-3 py-2 transition-colors group-hover:bg-surface-2/30">
        <div className="font-medium text-ink">FVG</div>
        <div className="text-[10px] text-ink-faint">Active today Bullish / Bearish</div>
      </td>
      {TIMEFRAMES.map((timeframe) => {
        const timeframeCounts = counts[timeframe];
        if (!timeframeCounts) {
          return (
            <td key={timeframe} className="border-b border-line/50 px-2 py-2 text-center text-ink-faint" aria-label={`${TF_LABEL[timeframe]} FVG data waiting`}>
              <div className="num whitespace-nowrap text-[13px]">—/—</div>
              <div className="mt-0.5 text-[10px] font-semibold">Waiting</div>
            </td>
          );
        }

        const label = fvgBalanceLabel(timeframeCounts);
        return (
          <td
            key={timeframe}
            className="border-b border-line/50 px-2 py-2 text-center"
            aria-label={`${TF_LABEL[timeframe]}: ${timeframeCounts.bullish} bullish FVGs, ${timeframeCounts.bearish} bearish FVGs. ${label}.`}
          >
            <div className="whitespace-nowrap font-mono text-[13px] font-semibold tabular-nums">
              <Num value={timeframeCounts.bullish} precision={0} className="text-bull-bright" />
              <span className="px-0.5 text-ink-faint" aria-hidden="true">/</span>
              <Num value={timeframeCounts.bearish} precision={0} className="text-bear-bright" />
            </div>
            <div className={`mt-0.5 text-[10px] font-semibold ${balanceTone(label)}`}>{label}</div>
          </td>
        );
      })}
    </tr>
  );
}
