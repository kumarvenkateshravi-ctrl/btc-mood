'use client';

import { Download } from 'lucide-react';
import { usePaperStore } from '@/lib/paperStore';
import { useReplaySession } from '@/lib/replaySession';
import { tradeDirection, tradePnlPct, tradeRR, tradeOutcome, formatRR } from '@/lib/trading';
import { tradesToCsv, downloadCsv } from '@/lib/csv';

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OUTCOME_CLASS: Record<string, string> = {
  TP: 'bg-bull/15 text-bull-bright',
  WIN: 'bg-bull/15 text-bull-bright',
  SL: 'bg-bear/15 text-bear-bright',
  LOSS: 'bg-bear/15 text-bear-bright',
  BE: 'bg-surface-2 text-ink-faint',
};

export default function TradeHistory() {
  const paper = usePaperStore();
  const session = useReplaySession();
  const trades = session.active ? session.trades : paper.trades;

  const exportCsv = () => {
    if (trades.length === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`backtest_trades_${date}.csv`, tradesToCsv(trades));
  };

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          <span>Trade history</span>
          <span className={session.active ? 'text-accent' : 'text-ink-faint'}>
            · {session.active ? 'Replay session' : 'Live'}
          </span>
        </h2>
        <button
          onClick={exportCsv}
          disabled={trades.length === 0}
          title="Export trades to CSV"
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-line bg-surface-1 px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
        >
          <Download className="h-3 w-3" />
          CSV
        </button>
      </div>

      {trades.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-ink-faint">
          No closed trades yet. Open a position and let TP/SL fill (live or in Bar Replay).
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-2/80 text-[10px] uppercase tracking-wider text-ink-faint backdrop-blur">
              <tr>
                <Th>Dir</Th>
                <Th>Qty</Th>
                <Th className="text-right">Entry</Th>
                <Th className="text-right">Exit</Th>
                <Th>Opened</Th>
                <Th>Closed</Th>
                <Th className="text-right">R:R</Th>
                <Th className="text-right">P&L</Th>
                <Th className="text-right">P&L %</Th>
                <Th className="text-right">Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const dir = tradeDirection(t);
                const win = t.realizedPnl > 0;
                const flat = t.realizedPnl === 0;
                const rr = tradeRR(t);
                const pct = tradePnlPct(t);
                const outcome = tradeOutcome(t);
                const pnlClass = win ? 'text-bull-bright' : flat ? 'text-ink-muted' : 'text-bear-bright';
                return (
                  <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-surface-1/40">
                    <Td>
                      <span className={dir === 'long' ? 'text-bull-bright' : 'text-bear-bright'}>
                        {dir === 'long' ? 'LONG' : 'SHORT'}
                      </span>
                    </Td>
                    <Td className="font-mono tabular-nums text-ink-muted">{t.units}</Td>
                    <Td className="text-right font-mono tabular-nums text-ink-muted">
                      {t.entryPrice != null ? t.entryPrice.toFixed(1) : '—'}
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-ink-muted">
                      {(t.exitPrice ?? t.price).toFixed(1)}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-faint">{fmtTime(t.entryTs)}</Td>
                    <Td className="whitespace-nowrap text-ink-faint">{fmtTime(t.ts)}</Td>
                    <Td className="text-right font-mono tabular-nums text-ink-muted">{formatRR(rr)}</Td>
                    <Td className={['text-right font-mono font-medium tabular-nums', pnlClass].join(' ')}>
                      {t.realizedPnl >= 0 ? '+' : ''}
                      {t.realizedPnl.toFixed(2)}
                    </Td>
                    <Td className={['text-right font-mono tabular-nums', pnlClass].join(' ')}>
                      {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                    </Td>
                    <Td className="text-right">
                      <span className={['rounded px-1.5 py-0.5 text-[10px] font-semibold', OUTCOME_CLASS[outcome]].join(' ')}>
                        {outcome}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 ${className}`}>{children}</td>;
}
