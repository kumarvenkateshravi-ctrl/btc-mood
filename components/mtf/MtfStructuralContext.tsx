import type { ActiveTodayFvgCounts } from '@/lib/mtf/fvgActivity';
import type { DerivedStructuralIntelligence } from '@/lib/mtf/derivedIntelligence';
import { Num, Panel } from '@/components/ui';

interface MtfStructuralContextProps {
  timeframeLabel: string;
  derived: DerivedStructuralIntelligence;
  activeToday?: ActiveTodayFvgCounts | null;
}

const humanize = (value: string) => value.replaceAll('_', ' ');

function stateTone(state: string): string {
  if (state.includes('bullish')) return 'text-bull-bright';
  if (state.includes('bearish')) return 'text-bear-bright';
  if (state === 'mixed' || state === 'mixed_range') return 'text-regime-hot';
  return 'text-ink-muted';
}

function Value({ value, precision = 2 }: { value: number | null; precision?: number }) {
  return value == null ? <span className="num text-ink-faint">—</span> : <Num value={value} precision={precision} />;
}

function CrossLabel({ event, barsSince }: { event: 'crossed_above' | 'crossed_below' | 'none'; barsSince: number | null }) {
  if (event === 'none') return <>No daily/weekly crossover in source</>;
  const direction = event === 'crossed_above' ? 'Daily crossed above weekly' : 'Daily crossed below weekly';
  return <>{direction}{barsSince == null ? '' : ` · ${barsSince} bars ago`}</>;
}

/** Context-only display. It never contributes a vote to the legacy matrix. */
export default function MtfStructuralContext({ timeframeLabel, derived, activeToday }: MtfStructuralContextProps) {
  const { fvg, vwap, poc } = derived;
  const fvgBadge = fvg.state === 'insufficient_data' ? 'waiting' : humanize(fvg.state);
  const vwapBadge = vwap.state === 'insufficient_data' ? 'waiting' : humanize(vwap.state);
  const pocBadge = poc.state === 'insufficient_data' ? 'waiting' : humanize(poc.state);

  return (
    <Panel eyebrow title="Structural Context" badge={`${timeframeLabel} · closed bars`}>
      <div className="grid grid-cols-1 divide-y divide-line/70 text-xs lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <section className="py-3 lg:px-3 lg:first:pl-0 lg:py-0" aria-label="Fair value gap context">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">FVG activity</span><span className={`text-[10px] font-semibold uppercase tracking-wide ${stateTone(fvg.state)}`}>{fvgBadge}</span></div>
          <dl className="mt-2 space-y-1 text-ink-muted">
            <div className="flex justify-between gap-3"><dt>Bullish active</dt><dd><Num value={fvg.bullish.activeCount} precision={0} /></dd></div>
            <div className="flex justify-between gap-3"><dt>Bearish active</dt><dd><Num value={fvg.bearish.activeCount} precision={0} /></dd></div>
            {activeToday && <div className="flex justify-between gap-3"><dt>Created today</dt><dd><Num value={activeToday.total} precision={0} /></dd></div>}
          </dl>
          <p className="mt-2 text-[10px] text-ink-faint">{fvg.bullish.priceInside || fvg.bearish.priceInside ? 'Price is inside the nearest active gap.' : 'Only unmitigated gaps are counted.'}</p>
        </section>
        <section className="py-3 lg:px-3 lg:py-0" aria-label="Daily and weekly VWAP context">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Daily / weekly VWAP</span><span className={`text-[10px] font-semibold uppercase tracking-wide ${stateTone(vwap.state)}`}>{vwapBadge}</span></div>
          <dl className="mt-2 space-y-1 text-ink-muted">
            <div className="flex justify-between gap-3"><dt>Daily</dt><dd><Value value={vwap.daily} /></dd></div>
            <div className="flex justify-between gap-3"><dt>Weekly</dt><dd><Value value={vwap.weekly} /></dd></div>
            <div className="flex justify-between gap-3"><dt>Spread</dt><dd>{vwap.dailyWeeklySpreadPct == null ? <span className="num text-ink-faint">—</span> : <Num.Pct value={vwap.dailyWeeklySpreadPct} precision={2} tone />}</dd></div>
          </dl>
          <p className="mt-2 text-[10px] text-ink-faint"><CrossLabel event={vwap.crossover.event} barsSince={vwap.crossover.barsSince} /></p>
        </section>
        <section className="py-3 lg:pl-3 lg:py-0" aria-label="Developing point of control context">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">4H / daily / weekly POC</span><span className={`text-[10px] font-semibold uppercase tracking-wide ${stateTone(poc.state)}`}>{pocBadge}</span></div>
          <dl className="mt-2 space-y-1 text-ink-muted">
            <div className="flex justify-between gap-3"><dt>4H</dt><dd><Value value={poc.fourHour.poc} /></dd></div>
            <div className="flex justify-between gap-3"><dt>Daily</dt><dd><Value value={poc.daily.poc} /></dd></div>
            <div className="flex justify-between gap-3"><dt>Weekly</dt><dd><Value value={poc.weekly.poc} /></dd></div>
          </dl>
          <p className="mt-2 text-[10px] text-ink-faint">{poc.nearest ? <>Nearest: {poc.nearest.timeframe.toUpperCase()} <Value value={poc.nearest.price} /></> : 'Waiting for enough profile data.'}</p>
        </section>
      </div>
      <p className="mt-3 border-t border-line/70 pt-2 text-[10px] text-ink-faint">Context only. The original matrix score and decision path remain unchanged.</p>
    </Panel>
  );
}
