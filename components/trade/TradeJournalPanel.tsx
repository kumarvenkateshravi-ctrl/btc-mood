'use client';

import { useMemo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { usePaperStore } from '@/lib/paperStore';
import { computeStats } from '@/lib/performance';
import type { PaperTrade } from '@/lib/paper';
import EquitySparkline from './EquitySparkline';

export default function TradeJournalPanel() {
  const trades = usePaperStore().trades;
  const stats = useMemo(() => computeStats(trades), [trades]);

  if (stats.empty) return null;

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between border-b border-line bg-surface-2/40 px-3.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Journal
        </h2>
        <span className="font-mono text-[10px] text-ink-muted">
          {stats.count} trade{stats.count !== 1 ? 's' : ''}
        </span>
      </header>

      <div className="p-3.5">
        {/* Top-line P&L */}
        <div className="mb-2 flex items-center justify-between rounded-lg border border-line bg-surface-1/40 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Total P&L
          </span>
          <span
            className={[
              'font-mono text-sm font-semibold tabular-nums',
              stats.totalPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright',
            ].join(' ')}
          >
            {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(2)}
          </span>
        </div>

        {/* Equity sparkline */}
        {stats.equityCurve.length >= 2 && (
          <div className="mb-3 flex justify-center">
            <EquitySparkline curve={stats.equityCurve} width={240} height={36} />
          </div>
        )}

        {/* Win rate + profit factor in a compact row */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <StatChip label="Win rate" value={`${stats.winRatePct.toFixed(1)}%`} />
          <StatChip
            label="Profit factor"
            value={
              Number.isFinite(stats.profitFactor)
                ? stats.profitFactor.toFixed(2)
                : '∞'
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <StatChip
            label="Avg win"
            value={stats.avgWin != null ? `+$${stats.avgWin.toFixed(2)}` : '—'}
            tone="bull"
          />
          <StatChip
            label="Avg loss"
            value={stats.avgLoss != null ? `-$${Math.abs(stats.avgLoss!).toFixed(2)}` : '—'}
            tone="bear"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <StatChip
            label="Profit factor"
            value={
              Number.isFinite(stats.profitFactor)
                ? stats.profitFactor.toFixed(2)
                : '∞'
            }
          />
          <StatChip
            label="Max drawdown"
            value={`-$${stats.maxDrawdown.toFixed(2)}`}
            tone="bear"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <StatChip
            label="Best"
            value={stats.bestTrade != null ? `+$${stats.bestTrade.toFixed(2)}` : '—'}
            tone="bull"
          />
          <StatChip
            label="Worst"
            value={stats.worstTrade != null ? `-$${Math.abs(stats.worstTrade!).toFixed(2)}` : '—'}
            tone="bear"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <StatChip
            label="W / L / B"
            value={`${stats.wins} / ${stats.losses} / ${stats.breakevens}`}
          />
          <StatChip label="Fees" value={`$${stats.totalFees.toFixed(2)}`} />
        </div>

        {/* Recent trades mini-list */}
        {trades.length > 0 && (
          <RecentTrades trades={trades.slice(0, 5)} />
        )}
      </div>
    </section>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'bull' | 'bear';
}) {
  const toneColor =
    tone === 'bull'
      ? 'text-bull-bright'
      : tone === 'bear'
      ? 'text-bear-bright'
      : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-surface-1/40 px-2.5 py-2">
      <dt className="text-[10px] text-ink-faint">{label}</dt>
      <dd className={['mt-0.5 font-mono text-xs tabular-nums', toneColor].join(' ')}>
        {value}
      </dd>
    </div>
  );
}

function RecentTrades({ trades }: { trades: PaperTrade[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Recent
      </h3>
      <div className="space-y-1">
        {trades.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-md border border-line bg-surface-1/30 px-2 py-1 text-[10px]"
          >
            <span className="flex items-center gap-1.5">
              {t.side === 'buy' ? (
                <TrendingUp className="h-3 w-3 text-bull-bright" />
              ) : (
                <TrendingDown className="h-3 w-3 text-bear-bright" />
              )}
              <span className="font-mono text-ink-muted">
                {t.units.toFixed(4)} @ {t.price.toFixed(1)}
              </span>
            </span>
            <span
              className={[
                'font-mono tabular-nums',
                t.realizedPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright',
              ].join(' ')}
            >
              {t.realizedPnl >= 0 ? '+' : ''}{t.realizedPnl.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
