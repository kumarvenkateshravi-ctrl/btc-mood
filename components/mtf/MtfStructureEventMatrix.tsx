'use client';

import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Droplet, Square } from 'lucide-react';
import type { Timeframe } from '@/lib/types';
import type { MarketStructureSnapshot, TimelineItem, TrendWord } from '@/lib/mtf/structureEngine';
import { Panel } from '@/components/ui';

const TF_LABEL: Record<Timeframe, string> = {
  '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '4h': '4H', '1d': '1D',
};
const EXECUTION_TFS = new Set<Timeframe>(['5m', '15m', '30m']);

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function trendTone(trend: TrendWord | string): string {
  if (trend === 'bullish') return 'text-bull-bright';
  if (trend === 'bearish') return 'text-bear-bright';
  return 'text-neutral';
}

function trendTint(trend: TrendWord): string {
  if (trend === 'bullish') return 'border-bull/30 bg-bull/[0.08]';
  if (trend === 'bearish') return 'border-bear/30 bg-bear/[0.08]';
  return 'border-line bg-surface-2/40';
}

function eventIcon(event: TimelineItem) {
  const className = cx('h-3.5 w-3.5 shrink-0', trendTone(event.direction));
  switch (event.eventType) {
    case 'LIQUIDITY_SWEEP': return <Droplet className={className} />;
    case 'CHOCH': return event.direction === 'bullish' ? <ArrowUpRight className={className} /> : <ArrowDownRight className={className} />;
    case 'BOS': return event.direction === 'bullish' ? <ArrowUp className={className} /> : <ArrowDown className={className} />;
    default: return <Square className={className} />;
  }
}

function ageLabel(barsAgo: number): string {
  if (barsAgo === 0) return 'latest close';
  return `${barsAgo} ${barsAgo === 1 ? 'bar' : 'bars'} ago`;
}

interface GroupSummary {
  trend: TrendWord;
  bullish: number;
  bearish: number;
  neutral: number;
}

function summarize(
  timeframes: Timeframe[],
  snapshots: Partial<Record<Timeframe, MarketStructureSnapshot>>,
): GroupSummary {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  for (const timeframe of timeframes) {
    const trend = snapshots[timeframe]?.structure.data?.trend ?? 'neutral';
    if (trend === 'bullish') bullish += 1;
    else if (trend === 'bearish') bearish += 1;
    else neutral += 1;
  }
  return {
    trend: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    bullish,
    bearish,
    neutral,
  };
}

export interface MtfStructureEventMatrixProps {
  snapshots: Partial<Record<Timeframe, MarketStructureSnapshot>>;
  timeframes: Timeframe[];
  selectedTf: Timeframe;
  onSelectTf: (timeframe: Timeframe) => void;
}

export default function MtfStructureEventMatrix({
  snapshots,
  timeframes,
  selectedTf,
  onSelectTf,
}: MtfStructureEventMatrixProps) {
  const executionTfs = timeframes.filter((timeframe) => EXECUTION_TFS.has(timeframe));
  const contextTfs = timeframes.filter((timeframe) => !EXECUTION_TFS.has(timeframe));
  const execution = summarize(executionTfs, snapshots);
  const context = summarize(contextTfs, snapshots);
  const aligned = execution.trend !== 'neutral' && execution.trend === context.trend;
  const alignmentLabel = aligned
    ? `${cap(execution.trend)} structure aligned`
    : execution.trend === 'neutral' || context.trend === 'neutral'
      ? 'Structure is mixed'
      : 'Execution and context differ';

  return (
    <Panel eyebrow title="SMC Structure by Timeframe" badge="confirmed closed bars">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Execution · 5M–30M', execution],
          ['Context · 1H–1D', context],
        ] as const).map(([label, group]) => (
          <div key={label} className={cx('rounded-lg border px-3 py-2', trendTint(group.trend))}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
              <span className={cx('text-xs font-bold', trendTone(group.trend))}>{cap(group.trend)}</span>
            </div>
            <div className="mt-1 font-mono text-[10px] tabular-nums text-ink-muted">
              <span className="text-bull-bright">{group.bullish} bull</span>
              <span className="px-1 text-ink-faint">·</span>
              <span className="text-bear-bright">{group.bearish} bear</span>
              {group.neutral > 0 && <><span className="px-1 text-ink-faint">·</span><span>{group.neutral} neutral</span></>}
            </div>
          </div>
        ))}
      </div>

      <div className={cx('mb-3 rounded-md border px-3 py-2 text-xs font-semibold', aligned ? trendTint(execution.trend) : 'border-line bg-surface-2/40 text-ink-muted')}>
        <span className={aligned ? trendTone(execution.trend) : undefined}>{alignmentLabel}</span>
        <span className="ml-1 font-normal text-ink-faint">· use the event rows to confirm sequence and location</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="border-b border-line px-2 py-2">TF</th>
              <th className="border-b border-line px-2 py-2">Current structure</th>
              <th className="border-b border-line px-2 py-2">Latest SMC event</th>
              <th className="border-b border-line px-2 py-2">Location</th>
              <th className="border-b border-line px-2 py-2 text-right">Quality</th>
            </tr>
          </thead>
          <tbody>
            {timeframes.map((timeframe) => {
              const snapshot = snapshots[timeframe];
              const structure = snapshot?.structure.data;
              const latestEvent = snapshot?.timeline.data?.items.at(-1) ?? null;
              const zone = snapshot?.premiumDiscount.data?.zone;
              const quality = snapshot?.quality.data;
              const selected = timeframe === selectedTf;

              return (
                <tr
                  key={timeframe}
                  onClick={() => onSelectTf(timeframe)}
                  className={cx('cursor-pointer transition hover:bg-surface-2/60', selected && 'bg-accent/[0.07]')}
                  aria-selected={selected}
                >
                  <td className="border-b border-line/60 px-2 py-2.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectTf(timeframe);
                      }}
                      className={cx('rounded px-2 py-1 font-bold', selected ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-ink')}
                      aria-label={`Show ${TF_LABEL[timeframe]} market structure details`}
                    >
                      {TF_LABEL[timeframe]}
                    </button>
                  </td>
                  <td className="border-b border-line/60 px-2 py-2.5">
                    {structure ? (
                      <div>
                        <div className={cx('font-semibold', trendTone(structure.trend))}>{cap(structure.trend)}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-ink-faint">
                          {structure.sequence.length > 0 ? structure.sequence.join(' → ') : 'Sequence forming'}
                        </div>
                      </div>
                    ) : <span className="text-ink-faint">Warming up</span>}
                  </td>
                  <td className="border-b border-line/60 px-2 py-2.5">
                    {latestEvent ? (
                      <div>
                        <div className={cx('flex items-center gap-1.5 font-medium', trendTone(latestEvent.direction))}>
                          {eventIcon(latestEvent)}
                          <span>{latestEvent.label}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-ink-faint">{ageLabel(latestEvent.barsAgo)}</div>
                      </div>
                    ) : <span className="text-ink-faint">No confirmed event</span>}
                  </td>
                  <td className="border-b border-line/60 px-2 py-2.5">
                    {zone ? <span className={cx('font-medium', zone === 'discount' ? 'text-bull-bright' : zone === 'premium' ? 'text-bear-bright' : 'text-neutral')}>{cap(zone)}</span> : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="border-b border-line/60 px-2 py-2.5 text-right">
                    {quality ? (
                      <div>
                        <div className="font-semibold text-ink">{quality.classification}</div>
                        <div className="font-mono text-[10px] tabular-nums text-ink-faint">{quality.confidence}%</div>
                      </div>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-ink-faint">
        Click a timeframe to inspect its liquidity, FVGs, order blocks, premium/discount zone, and full event timeline below.
      </p>
    </Panel>
  );
}
