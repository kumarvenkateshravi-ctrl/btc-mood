'use client';

import { useState } from 'react';
import { usePaperStore, executeOrder, setPositionOverlay, closePosition } from '@/lib/paperStore';
import { unrealizedPnl } from '@/lib/paper';
import { useMarkPrice } from '@/lib/markPriceStore';
import {
  useReplaySession,
  sessionBalance,
  replayMarketOrder,
  replaySetOverlay,
  replayClose,
} from '@/lib/replaySession';
import { positionSize, riskReward, formatRR } from '@/lib/trading';

const LEVERAGE = 10;

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
  const markTime = mark?.time;

  const setOverlay = (field: 'tp' | 'sl', value: number | null) => {
    if (replay) replaySetOverlay(field, value);
    else setPositionOverlay(field, value, symbol);
  };

  const [qty, setQty] = useState('0.1');
  const [balanceInput, setBalanceInput] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [slDist, setSlDist] = useState('');

  const accountBalance = balanceInput.trim() !== '' ? Number(balanceInput) : balance;
  const recommendedQty = positionSize(accountBalance, Number(riskPct), Number(slDist));

  const place = (side: 'BUY' | 'SELL') => {
    const size = Number(qty);
    if (!(size > 0) || !(markPrice > 0)) return;
    const ts = markTime ?? Math.floor(Date.now() / 1000);
    if (replay) replayMarketOrder(side === 'BUY' ? 'buy' : 'sell', size, markPrice, ts, LEVERAGE);
    else executeOrder({ type: side, size, orderType: 'MARKET', symbol, midPrice: markPrice, leverage: LEVERAGE, ts: markTime });
  };

  const rr = hasPos && pos ? riskReward(pos.side === 'long' ? 'long' : 'short', pos.entryPrice, pos.tp, pos.sl) : null;

  // Live unrealized P&L (tracks the mark price tick-by-tick / replay bar).
  const upnl = hasPos && pos ? unrealizedPnl(pos, markPrice) : 0;
  const upnlPct =
    hasPos && pos && pos.entryPrice > 0
      ? ((markPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'long' ? 1 : -1)
      : 0;

  // Default level distance: the calculator's SL distance, else ~1% of entry/price.
  const baseEntry = hasPos && pos ? pos.entryPrice : markPrice;
  const dist = Number(slDist) > 0 ? Number(slDist) : baseEntry * 0.01;
  const long = pos?.side === 'long';

  const addTp = () => pos && setOverlay('tp', long ? pos.entryPrice + dist * 2 : pos.entryPrice - dist * 2);
  const addSl = () => pos && setOverlay('sl', long ? pos.entryPrice - dist : pos.entryPrice + dist);

  return (
    <div className="panel space-y-3 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-faint">Trade</h3>
        <span className="font-mono text-[11px] text-ink-muted">{symbol}</span>
      </div>

      {replay && (
        <div className="flex items-center justify-between rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-accent">Replay session</span>
          <span className="font-mono tabular-nums text-ink">${balance.toFixed(2)}</span>
        </div>
      )}

      {/* Quantity */}
      <Field label="Quantity">
        <input
          type="number"
          min={0}
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="num-input"
        />
        <span className="px-1 text-[11px] text-ink-faint">units</span>
      </Field>

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => place('BUY')}
          className="focus-ring rounded-md bg-[#089981] py-2 text-sm font-semibold text-white transition hover:bg-[#0aa888]"
        >
          Buy / Long
        </button>
        <button
          onClick={() => place('SELL')}
          className="focus-ring rounded-md bg-[#f23645] py-2 text-sm font-semibold text-white transition hover:bg-[#ff4757]"
        >
          Sell / Short
        </button>
      </div>
      {markPrice > 0 && (
        <p className="text-center font-mono text-[11px] text-ink-faint">≈ market {markPrice.toFixed(1)}</p>
      )}

      {/* Position size calculator */}
      <details className="rounded-lg border border-line bg-base/40 px-2.5 py-2" open>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Position size calculator
        </summary>
        <div className="mt-2 space-y-2">
          <Field label="Account balance">
            <input
              type="number"
              min={0}
              step="any"
              value={balanceInput}
              placeholder={balance.toFixed(0)}
              onChange={(e) => setBalanceInput(e.target.value)}
              className="num-input"
            />
            <span className="px-1 text-[11px] text-ink-faint">$</span>
          </Field>
          <Field label="Risk per trade">
            <input type="number" min={0} step="any" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} className="num-input" />
            <span className="px-1 text-[11px] text-ink-faint">%</span>
          </Field>
          <Field label="Stop-loss distance">
            <input type="number" min={0} step="any" value={slDist} placeholder="price units" onChange={(e) => setSlDist(e.target.value)} className="num-input" />
            <span className="px-1 text-[11px] text-ink-faint">$</span>
          </Field>
          <div className="flex items-center justify-between border-t border-line pt-2">
            <span className="text-[11px] text-ink-faint">Recommended</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-ink">{recommendedQty > 0 ? recommendedQty.toFixed(4) : '—'}</span>
              <button
                onClick={() => recommendedQty > 0 && setQty(recommendedQty.toFixed(4))}
                disabled={recommendedQty <= 0}
                className="focus-ring rounded bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-30"
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
            <span className={['text-xs font-semibold', long ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
              {long ? 'LONG' : 'SHORT'} {pos.units} {symbol.replace('USDT', '')}
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

          <LevelRow
            label="TP"
            value={pos.tp}
            color="text-bull-bright"
            onChange={(v) => setOverlay('tp', v)}
            onAdd={addTp}
            onClear={() => setOverlay('tp', null)}
          />
          <LevelRow
            label="SL"
            value={pos.sl}
            color="text-bear-bright"
            onChange={(v) => setOverlay('sl', v)}
            onAdd={addSl}
            onClear={() => setOverlay('sl', null)}
          />

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

          <button
            onClick={() =>
              replay
                ? replayClose(markPrice, markTime ?? Math.floor(Date.now() / 1000))
                : closePosition(markPrice, symbol)
            }
            className="focus-ring w-full rounded-md bg-surface-2 py-1.5 text-xs text-ink-muted transition hover:text-bear-bright"
          >
            Close position @ market
          </button>
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
    <label className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1.5 text-xs">
      <span className="shrink-0 text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function LevelRow({
  label,
  value,
  color,
  onChange,
  onAdd,
  onClear,
}: {
  label: string;
  value: number | null;
  color: string;
  onChange: (v: number) => void;
  onAdd: () => void;
  onClear: () => void;
}) {
  if (value == null) {
    return (
      <div className="flex items-center justify-between">
        <span className={['text-xs font-semibold', color].join(' ')}>{label}</span>
        <button onClick={onAdd} className="focus-ring rounded bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted transition hover:text-ink">
          Add {label}
        </button>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1 text-xs">
      <span className={['w-6 shrink-0 font-semibold', color].join(' ')}>{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(n);
        }}
        className="num-input"
      />
      <button onClick={onClear} aria-label={`Remove ${label}`} className="text-ink-faint transition hover:text-bear-bright">
        ✕
      </button>
    </label>
  );
}
