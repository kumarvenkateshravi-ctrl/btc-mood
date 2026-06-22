'use client';

import { usePaperStore } from '@/lib/paperStore';
import { useReplaySession } from '@/lib/replaySession';
import type { PaperTrade } from '@/lib/paper';

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function direction(t: PaperTrade): 'long' | 'short' {
  if (t.direction === 'long' || t.direction === 'short') return t.direction;
  return t.side === 'sell' ? 'long' : 'short';
}

export default function TradeHistory() {
  const paper = usePaperStore();
  const session = useReplaySession();
  const trades = session.active ? session.trades : paper.trades;

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <h2 className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
        <span>Trade history</span>
        <span className={session.active ? 'text-accent' : 'text-ink-faint'}>
          {session.active ? 'Replay session' : 'Live'}
        </span>
      </h2>

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
                <Th className="text-right">P&L</Th>
                <Th className="text-right">Result</Th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const dir = direction(t);
                const win = t.realizedPnl > 0;
                const flat = t.realizedPnl === 0;
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
                    <Td className={['text-right font-mono font-medium tabular-nums', win ? 'text-bull-bright' : flat ? 'text-ink-muted' : 'text-bear-bright'].join(' ')}>
                      {t.realizedPnl >= 0 ? '+' : ''}
                      {t.realizedPnl.toFixed(2)}
                    </Td>
                    <Td className="text-right">
                      <span
                        className={[
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          flat ? 'bg-surface-2 text-ink-faint' : win ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright',
                        ].join(' ')}
                      >
                        {flat ? 'BE' : win ? 'WIN' : 'LOSS'}
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
