'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeTrades, type Trade, type WSStatus } from '@/lib/ws';
import { emptyDelta, accumulate, delta, type DeltaAccumulator } from '@/lib/orderFlow';
import type { Timeframe } from '@/lib/types';

const MAX_ROWS = 50;
const BUFFER_CAP = 60;
const FLUSH_MS = 150; // batch re-renders; BTC can fire dozens of trades/sec

interface OrderFlowPanelProps {
  symbol: string;
  tf: Timeframe;
}

function fmtPrice(p: number): string {
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(q: number): string {
  if (q >= 1000) return q.toFixed(0);
  if (q >= 1) return q.toFixed(2);
  return q.toFixed(3);
}
function fmtTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour12: false });
}

/**
 * Live order flow — the real-time tape from Binance @aggTrade. Shows recent
 * aggressor trades (buys green / sells red) and the cumulative delta (buy −
 * sell volume) for the current candle. Renders on a fixed interval rather than
 * per-trade so a fast tape never thrashes React.
 */
export default function OrderFlowPanel({ symbol, tf }: OrderFlowPanelProps) {
  const tradesRef = useRef<Trade[]>([]);
  const accRef = useRef<DeltaAccumulator>(emptyDelta());
  const tfRef = useRef<Timeframe>(tf);
  tfRef.current = tf;

  const [, setVersion] = useState(0);
  const [status, setStatus] = useState<WSStatus>('connecting');

  // Reset the candle delta when the timeframe changes (new candle window).
  useEffect(() => {
    accRef.current = emptyDelta();
  }, [tf]);

  // Subscribe to the tape; reset everything when the symbol changes.
  useEffect(() => {
    tradesRef.current = [];
    accRef.current = emptyDelta();
    const dispose = subscribeTrades(
      symbol,
      (t) => {
        accumulate(accRef.current, t, tfRef.current);
        const arr = tradesRef.current;
        arr.unshift(t);
        if (arr.length > BUFFER_CAP) arr.length = BUFFER_CAP;
      },
      setStatus,
    );
    return dispose;
  }, [symbol]);

  // Flush to React on a fixed cadence.
  useEffect(() => {
    const id = setInterval(() => setVersion((v) => v + 1), FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  const acc = accRef.current;
  const d = delta(acc);
  const total = acc.buyVol + acc.sellVol;
  const buyFrac = total > 0 ? acc.buyVol / total : 0.5;
  const base = symbol.replace(/USDT$/, '');
  const rows = tradesRef.current.slice(0, MAX_ROWS);

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Order flow
        </h2>
        <span
          className={[
            'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider',
            status === 'open' ? 'text-bull-bright' : 'text-ink-faint',
          ].join(' ')}
        >
          <span className={['h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-bull-bright' : 'bg-ink-faint'].join(' ')} />
          {status === 'open' ? 'live' : status}
        </span>
      </div>

      {/* Cumulative delta for the current candle */}
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">
            Delta · {tf}
          </span>
          <span
            className={['font-mono text-sm font-semibold tabular-nums', d >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}
          >
            {d >= 0 ? '+' : ''}{fmtQty(d)} {base}
          </span>
        </div>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-base">
          <div className="h-full bg-bull-bright/80" style={{ width: `${buyFrac * 100}%` }} />
          <div className="h-full bg-bear-bright/80" style={{ width: `${(1 - buyFrac) * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-ink-faint">
          <span className="text-bull-bright/80">buy {fmtQty(acc.buyVol)}</span>
          <span className="text-bear-bright/80">sell {fmtQty(acc.sellVol)}</span>
        </div>
      </div>

      {/* Live tape */}
      <div className="max-h-[280px] overflow-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-ink-faint">Waiting for trades…</div>
        ) : (
          <ul className="font-mono text-[11px] tabular-nums">
            {rows.map((t) => (
              <li
                key={t.id}
                className={[
                  'flex items-center justify-between px-3 py-0.5',
                  t.side === 'buy' ? 'bg-bull/[0.06] text-bull-bright' : 'bg-bear/[0.06] text-bear-bright',
                ].join(' ')}
              >
                <span>{fmtPrice(t.price)}</span>
                <span className="text-ink">{fmtQty(t.qty)}</span>
                <span className="text-ink-faint">{fmtTime(t.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
