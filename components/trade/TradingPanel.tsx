'use client';

import { useState } from 'react';
import { usePaperStore } from '@/lib/paperStore';
import { unrealizedPnl } from '@/lib/paper';
import { useMarkPrice } from '@/lib/markPriceStore';
import { useReplaySession, sessionBalance } from '@/lib/replaySession';
import { positionSize, riskReward, formatRR } from '@/lib/trading';

export default function TradingPanel({ symbol, midPrice }: { symbol: string; midPrice: number }) {
  const paper = usePaperStore();
  const session = useReplaySession();
  // During an active replay this symbol trades on the ISOLATED session account.
  const replay = session.active && session.symbol === symbol;
  const pos = replay ? session.position : paper.positions[symbol] ?? null;
  const balance = replay ? sessionBalance(session) : paper.balance;
  const hasPos = !!(pos && pos.side !== 'flat' && pos.units > 0);

  // The chart's current mark (tracks replay during Bar Replay), else the prop.
  const mark = useMarkPrice(symbol);
  const markPrice = mark?.price ?? midPrice;

  const [qty, setQty] = useState('0.1');
  const [balanceInput, setBalanceInput] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [slDist, setSlDist] = useState('');

  const accountBalance = balanceInput.trim() !== '' ? Number(balanceInput) : balance;
  const recommendedQty = positionSize(accountBalance, Number(riskPct), Number(slDist));

  const rr = hasPos && pos ? riskReward(pos.side === 'long' ? 'long' : 'short', pos.entryPrice, pos.tp, pos.sl) : null;

  // Live unrealized P&L (tracks the mark price tick-by-tick / replay bar).
  const upnl = hasPos && pos ? unrealizedPnl(pos, markPrice) : 0;
  const upnlPct =
    hasPos && pos && pos.entryPrice > 0
      ? ((markPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'long' ? 1 : -1)
      : 0;

  return (
    <div className="panel space-y-3 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-ink-faint">Trade</h3>
        <span className="font-mono text-sm text-ink-muted">{symbol}</span>
      </div>

      {replay && (
        <div className="flex items-center justify-between rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-accent">Replay session</span>
          <span className="font-mono tabular-nums text-ink">${balance.toFixed(2)}</span>
        </div>
      )}

      <Field label="Quantity">
        <input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="num-input text-base"
        />
        <span className="px-1 text-sm text-ink-faint">units</span>
      </Field>

      {/* Order entry lives on the chart (Buy / Sell pills → order ticket).
          This panel is for planning + managing an open position only. */}
      <p className="rounded-lg border border-line bg-base/40 px-3 py-2.5 text-center text-xs text-ink-faint">
        Place orders from the chart — use the <span className="text-ink-muted">Buy</span> /{' '}
        <span className="text-ink-muted">Sell</span> pills to open the order ticket.
      </p>

      {/* Position size calculator */}
      <details className="rounded-xl border border-line bg-base/40 px-3 py-3" open>
        <summary className="cursor-pointer rounded text-xs font-bold uppercase tracking-wider text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          ▼ Position size calculator
        </summary>
        <div className="mt-3 space-y-3">
          <Field label="Account balance">
            <input
              type="number"
              min={0}
              step="any"
              value={balanceInput}
              placeholder={balance.toFixed(0)}
              onChange={(e) => setBalanceInput(e.target.value)}
              className="num-input text-sm"
            />
            <span className="px-1 text-sm text-ink-faint">$</span>
          </Field>
          <Field label="Risk per trade">
            <input type="number" min={0} step="any" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} className="num-input text-sm" />
            <span className="px-1 text-sm text-ink-faint">%</span>
          </Field>
          <Field label="Stop-loss distance">
            <input type="number" min={0} step="any" value={slDist} placeholder="price units" onChange={(e) => setSlDist(e.target.value)} className="num-input text-sm" />
            <span className="px-1 text-sm text-ink-faint">$</span>
          </Field>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-ink-faint">Recommended</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-base font-semibold text-ink">{recommendedQty > 0 ? recommendedQty.toFixed(4) : '—'}</span>
              <button
                onClick={() => recommendedQty > 0 && setQty(recommendedQty.toFixed(4))}
                disabled={recommendedQty <= 0}
                className="focus-ring rounded bg-surface-2 px-3 py-1 text-xs font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-30"
              >
                Use
              </button>
            </div>
          </div>
        </div>
      </details>

      {/* Open position management */}
      {hasPos && pos && (
        <div className="space-y-2 rounded-lg border border-line bg-base/40 p-2.5">
          <div className="flex items-center justify-between">
            <span className={['text-xs font-semibold', pos.side === 'long' ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
              {pos.side === 'long' ? 'LONG' : 'SHORT'} {pos.units} {symbol.replace('USDT', '')}
            </span>
            <span className="font-mono text-[11px] text-ink-muted">@ {pos.entryPrice.toFixed(1)}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-base/60 px-2 py-1.5 text-xs">
            <span className="text-ink-faint">Entry</span>
            <span className="text-right font-mono tabular-nums text-ink">{pos.entryPrice.toFixed(1)}</span>
            <span className="text-ink-faint">Current</span>
            <span className="text-right font-mono tabular-nums text-ink">{markPrice.toFixed(1)}</span>
            <span className="text-ink-faint">uPnL</span>
            <span className={['text-right font-mono font-semibold tabular-nums', upnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
              {upnl >= 0 ? '+' : ''}{upnl.toFixed(2)}
            </span>
            <span className="text-ink-faint">uPnL %</span>
            <span className={['text-right font-mono font-semibold tabular-nums', upnlPct >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
              {upnlPct >= 0 ? '+' : ''}{upnlPct.toFixed(2)}%
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-faint">Reward : Risk</span>
            <span
              className={[
                'font-mono text-sm font-semibold',
                rr == null ? 'text-ink-faint' : rr >= 2 ? 'text-bull-bright' : rr >= 1 ? 'text-ink' : 'text-bear-bright',
              ].join(' ')}
            >
              {formatRR(rr)}
            </span>
          </div>

          <p className="border-t border-line pt-2 text-center text-[11px] text-ink-faint">
            Edit TP/SL, reverse, or close from the trade overlay on the chart.
          </p>
        </div>
      )}

      <style jsx>{`
        :global(.num-input) {
          min-width: 0;
          flex: 1;
          background: transparent;
          text-align: right;
          font-family: ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
          color: var(--color-ink, #e9eef7);
          outline: none;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-line bg-base px-3 py-2.5 text-sm">
      <span className="shrink-0 font-medium text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
