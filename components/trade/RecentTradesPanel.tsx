'use client';

import { usePaperStore } from '@/lib/paperStore';

export default function RecentTradesPanel() {
  const { trades } = usePaperStore();
  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="border-b border-line bg-surface-2/40 px-3.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Recent fills
        </h2>
      </header>
      <div className="p-3.5">
        {trades.length === 0 ? (
          <p className="text-xs text-ink-faint">No fills yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {trades.slice(0, 8).map((t) => {
              const positive = t.realizedPnl >= 0;
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-md border border-line bg-surface-1/30 px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        t.side === 'buy' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright',
                      ].join(' ')}
                    >
                      {t.side}
                    </span>
                    <span className="font-mono text-ink-muted">
                      {t.units.toFixed(4)} @ {t.price.toFixed(1)}
                    </span>
                  </span>
                  <span
                    className={[
                      'font-mono tabular-nums',
                      positive ? 'text-bull-bright' : 'text-bear-bright',
                    ].join(' ')}
                  >
                    {(positive ? '+' : '') + t.realizedPnl.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
