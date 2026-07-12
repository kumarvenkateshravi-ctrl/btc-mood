'use client';

// Market Intelligence home (Strategy Studio M1) — every strategy starts by
// answering "Should I trade today?". Composes the engines that already run
// (market context / Stack Score, SMC screener with its Institutional
// Workflow) into one read: Trade Readiness %, Today's Bias ★ with the
// counter-trend line, the current institutional phase, and a "Why?"
// expander that shows the receipts.

import { useMemo, useRef, useState } from 'react';
import { BookOpenCheck, ChevronDown, ChevronUp, Hammer, Radar, Star, Store } from 'lucide-react';
import Link from 'next/link';
import type { Candle, Timeframe } from '@/lib/types';
import type { MarketContext } from '@/lib/context/types';
import { evaluateSmcScreener, type ScreenerReport } from '@/lib/smc/screener';
import { computeTradeReadiness } from '@/lib/scanner/readiness';
import { cx } from '@/components/ui';

const SIG_TFS: Timeframe[] = ['1d', '4h', '1h', '15m'];

function Stars({ n, dim }: { n: number; dim?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cx('h-3.5 w-3.5', i <= n ? (dim ? 'fill-ink-faint text-ink-faint' : 'fill-regime-hot text-regime-hot') : 'text-ink-faint/40')}
        />
      ))}
    </span>
  );
}

function ScoreTile({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-ink">
        {value}
        {suffix && <span className="text-[11px] text-ink-faint">{suffix}</span>}
      </p>
    </div>
  );
}

export default function IntelligenceHome({
  candlesByTf,
  evalTf,
  marketContext,
  onBuildForMarket,
}: {
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  marketContext: MarketContext;
  onBuildForMarket: (bias: 'long' | 'short' | null) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);

  // Closed-bar cache (indicator tick-perf rule).
  const sig = `${evalTf}:${SIG_TFS.map((tf) => {
    const s = candlesByTf[tf];
    return s && s.length ? `${s.length}.${s[s.length - 1].time}` : '0';
  }).join('|')}`;
  const cacheRef = useRef<{ sig: string; report: ScreenerReport } | null>(null);
  if (!cacheRef.current || cacheRef.current.sig !== sig) {
    cacheRef.current = { sig, report: evaluateSmcScreener(candlesByTf, evalTf) };
  }
  const report = cacheRef.current.report;

  const readiness = useMemo(
    () =>
      computeTradeReadiness({
        institutional: report.score,
        confluence: report.contextChecks.length
          ? Math.round(report.contextChecks.reduce((s, g) => s + g.score, 0) / report.contextChecks.length)
          : 0,
        stackScore: marketContext.contextScore,
        direction: report.direction,
        gatesPassed: report.hardGates.filter((g) => g.pass).length,
        gatesTotal: report.hardGates.length,
      }),
    [report, marketContext.contextScore],
  );

  const stageDone = report.workflow.filter((s) => s.state === 'done').length;
  const biasWord = readiness.bias === 'long' ? 'LONG' : readiness.bias === 'short' ? 'SHORT' : 'STAND ASIDE';
  const counterWord = readiness.bias === 'long' ? 'SHORT' : readiness.bias === 'short' ? 'LONG' : '—';

  return (
    <section className="mb-6 rounded-xl border border-line bg-surface-1/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Radar className="h-4 w-4 text-accent" />
          BTC Intelligence
        </span>
        <span className="text-[11px] text-ink-faint">Should I trade today?</span>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <Link href="/journal" className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-ink-muted transition hover:text-ink">
            <BookOpenCheck className="h-3 w-3" /> Journal
          </Link>
          <span className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-ink-faint" title="Community marketplace — coming soon">
            <Store className="h-3 w-3" /> Marketplace <span className="rounded bg-surface-3 px-1 text-[9px] uppercase">soon</span>
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* Readiness + bias hero */}
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-1 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Trade Readiness</p>
            <p className={cx(
              'font-mono text-3xl font-bold tabular-nums',
              readiness.readiness >= 70 ? 'text-bull-bright' : readiness.readiness >= 50 ? 'text-regime-hot' : 'text-ink-muted',
            )}>
              {readiness.readiness}<span className="text-sm text-ink-faint">%</span>
            </p>
          </div>
          <div className="h-10 w-px bg-line" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Today&apos;s Bias</p>
            <p className="mt-0.5 flex items-center gap-2">
              <Stars n={readiness.stars} />
              <span className={cx(
                'text-[13px] font-bold',
                readiness.bias === 'long' ? 'text-bull-bright' : readiness.bias === 'short' ? 'text-bear-bright' : 'text-ink-muted',
              )}>
                {biasWord}
              </span>
            </p>
            {readiness.bias && (
              <p className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-faint">
                <Stars n={readiness.counterStars} dim /> {counterWord} · advanced only
              </p>
            )}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <ScoreTile label="Trend" value={marketContext.trendScore} />
          <ScoreTile label="Momentum" value={marketContext.momentumScore} />
          <ScoreTile label="Volume" value={marketContext.volumeScore} />
          <ScoreTile label="Stack Score" value={marketContext.contextScore} />
          <ScoreTile label="Institutional" value={report.score} />
          <ScoreTile label="SMC Stage" value={`${stageDone} / ${report.workflow.length}`} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-[12px] text-ink-muted">
          <span className="text-ink-faint">Current phase:</span> <span className="text-ink">{report.currentPhase}</span>
        </p>
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-accent transition hover:bg-accent/10"
        >
          Why? {showWhy ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onBuildForMarket(readiness.bias)}
          className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:bg-accent/25"
        >
          <Hammer className="h-3.5 w-3.5" />
          Build a strategy for this market →
        </button>
      </div>

      {showWhy && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 lg:grid-cols-2">
          <ul className="space-y-1">
            {report.narrative.map((line, i) => (
              <li key={i} className="text-[12px] leading-snug text-ink-muted">{line}</li>
            ))}
          </ul>
          <ul className="space-y-1">
            {report.hardGates.flatMap((g) =>
              g.items.filter((it) => it.status !== 'na').map((it) => (
                <li key={`${g.id}_${it.id}`} className="flex items-center gap-2 text-[12px]">
                  <span className={cx(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    it.status === 'pass' ? 'bg-bull' : it.status === 'warn' ? 'bg-regime-hot' : 'bg-bear',
                  )} />
                  <span className={it.status === 'pass' ? 'text-ink' : 'text-ink-muted'}>{it.label}</span>
                  {it.detail && <span className="font-mono text-[10px] text-ink-faint">{it.detail}</span>}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
