'use client';

import { usePaperStore } from '@/lib/paperStore';
import { useReplaySession } from '@/lib/replaySession';
import { computeStats } from '@/lib/performance';
import EquitySparkline from './EquitySparkline';

const money = (n: number | null) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

export default function BacktestStats() {
  const paper = usePaperStore();
  const session = useReplaySession();
  const s = computeStats(session.active ? session.trades : paper.trades);

  const pf = !Number.isFinite(s.profitFactor) ? '∞' : s.profitFactor.toFixed(2);

  return (
    <section className="panel rounded-2xl p-4">
      <h2 className="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
        <span>Backtest statistics</span>
        <span className={session.active ? 'text-accent' : 'text-ink-faint'}>
          {session.active ? 'Replay session' : 'Live'}
        </span>
      </h2>

      {s.empty ? (
        <div className="py-6 text-center text-xs text-ink-faint">
          Stats appear once trades close.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Stat label="Total trades" value={String(s.count)} />
            <Stat
              label="Win rate"
              value={`${s.winRatePct.toFixed(1)}%`}
              tone={s.winRatePct >= 50 ? 'up' : 'down'}
            />
            <Stat label="Avg win" value={money(s.avgWin)} tone="up" />
            <Stat label="Avg loss" value={money(s.avgLoss)} tone="down" />
            <Stat label="Profit factor" value={pf} tone={s.profitFactor >= 1 ? 'up' : 'down'} />
            <Stat label="Expectancy" value={money(s.expectancy)} tone={s.expectancy >= 0 ? 'up' : 'down'} />
            <Stat label="Largest win" value={money(s.bestTrade)} tone="up" />
            <Stat label="Largest loss" value={money(s.worstTrade)} tone="down" />
            <Stat label="Max drawdown" value={`-${s.maxDrawdown.toFixed(2)}`} tone="down" />
            <Stat
              label="Net P&L"
              value={money(s.totalPnl)}
              tone={s.totalPnl >= 0 ? 'up' : 'down'}
            />
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-ink-faint">Equity curve</span>
              <span
                className={['font-mono text-[11px] tabular-nums', s.totalPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}
              >
                {money(s.totalPnl)}
              </span>
            </div>
            <EquitySparkline curve={s.equityCurve} width={260} height={56} />
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      <span
        className={[
          'font-mono text-sm font-semibold tabular-nums',
          tone === 'up' ? 'text-bull-bright' : tone === 'down' ? 'text-bear-bright' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
