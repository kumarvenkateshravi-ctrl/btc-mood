'use client';

// Active Position widget — the live cockpit for an open trade, docked in the
// right drawer. Everything is derived by deriveActivePosition (pure, tested);
// this file is layout + the four quick actions. Colour follows DESIGN.md's
// orthogonal channels: P&L colour encodes OUTCOME only; direction gets its own
// label+hue; liquidation owns a danger channel that intensifies near the line.

import {
  ArrowRightCircle, TrendingUp, ShieldCheck, Target, Scale, Box, Wallet,
  PieChart, XCircle, Clock, Zap,
} from 'lucide-react';
import { cx } from '@/components/ui/util';
import type { ActivePositionView } from '@/lib/trade/activePosition';
import { formatHeld } from '@/lib/trade/activePosition';

interface Props {
  /** Identifies the authoritative execution account behind `view`. */
  mode: 'live' | 'replay';
  view: ActivePositionView;
  onMoveBreakEven: () => void;
  onClosePartial: (fraction: number) => void;
  onToggleTrailing: () => void;
  onCloseFull: () => void;
}

const usd = (v: number, signed = false) => {
  const s = v < 0 ? '-' : signed ? '+' : '';
  return `${s}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const price = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number, signed = true) => `${signed && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export default function ActivePositionWidget({
  mode, view, onMoveBreakEven, onClosePartial, onToggleTrailing, onCloseFull,
}: Props) {
  const up = view.pnlUsd >= 0;
  const isLong = view.side === 'long';
  const pnlColor = up ? 'text-bull-bright' : 'text-bear-bright';
  const openedDate = new Date(view.openedAt * 1000);
  // Liquidation danger ramps up as price nears the line (<8% = hot).
  const liqDanger = view.liqDistancePct < 8;

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3.5 text-ink">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line/70 pb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Active Position</span>
        <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider', mode === 'replay' ? 'text-accent' : 'text-bull-bright')}>
          <span className={cx('h-1.5 w-1.5 animate-pulse rounded-full', mode === 'replay' ? 'bg-accent' : 'bg-bull-bright')} />
          {mode === 'replay' ? 'Replay' : 'Live'}
        </span>
      </div>

      {/* Direction + symbol */}
      <div className="flex items-center gap-2 py-2.5">
        <span className={cx('text-lg font-bold tracking-wide', isLong ? 'text-bull-bright' : 'text-bear-bright')}>
          {isLong ? 'LONG' : 'SHORT'}
        </span>
        <span className="text-lg font-bold text-ink">{view.symbol}</span>
      </div>

      {/* P&L hero + amount used */}
      <div className="grid grid-cols-[1.4fr_1px_1fr] gap-3 border-y border-line/70 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-faint">P&amp;L (Live)</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className={cx('font-mono text-2xl font-bold tabular-nums', pnlColor)}>{usd(view.pnlUsd, true)}</span>
            {view.pnlR != null && (
              <span className={cx('font-mono text-sm font-semibold', pnlColor)}>
                ({view.pnlR >= 0 ? '+' : ''}{view.pnlR.toFixed(2)}R)
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">{usd(view.pnlUsd, true)} (USD)</span>
            <span className={cx('rounded px-1.5 py-px font-mono text-[11px] tabular-nums', up ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright')}>
              {pct(view.pnlPct)}
            </span>
          </div>
        </div>
        <div className="bg-line/70" />
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-faint">Amount Used</p>
          <p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-ink">{usd(view.marginUsed)}</p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-faint">{view.qty.toFixed(6)} BTC · {view.leverage}x</p>
        </div>
      </div>

      {/* Price / risk / reward grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line/60 bg-base/40 p-3">
        <Tile icon={<ArrowRightCircle className="h-3.5 w-3.5 text-accent" />} label="Entry Price" value={price(view.entry)} />
        <Tile icon={<ShieldCheck className="h-3.5 w-3.5 text-bear-bright" />} label="Stop Loss"
          value={view.stopLoss != null ? price(view.stopLoss) : '—'} tone={view.stopLoss != null ? 'bear' : undefined} />
        <Tile icon={<TrendingUp className="h-3.5 w-3.5 text-accent" />} label="Current Price" value={price(view.mark)} tone={up ? 'bull' : 'bear'} />
        <Tile icon={<Target className="h-3.5 w-3.5 text-bull-bright" />} label="Take Profit"
          value={view.takeProfit != null ? price(view.takeProfit) : '—'} tone={view.takeProfit != null ? 'bull' : undefined} />
        <Tile icon={<ShieldCheck className="h-3.5 w-3.5 text-bear-bright" />} label="Risk"
          value={view.riskUsd != null ? usd(view.riskUsd) : '—'} tone={view.riskUsd != null ? 'bear' : undefined} />
        <Tile icon={<Target className="h-3.5 w-3.5 text-bull-bright" />} label="Reward"
          value={view.rewardUsd != null ? usd(view.rewardUsd, true) : '—'} tone={view.rewardUsd != null ? 'bull' : undefined} />
      </div>

      {/* Secondary stats incl. leverage + liquidation */}
      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3">
        <Tile icon={<Scale className="h-3.5 w-3.5 text-accent-2" />} label="Risk : Reward" value={view.rr != null ? `1 : ${view.rr.toFixed(1)}` : '—'} />
        <Tile icon={<Box className="h-3.5 w-3.5 text-regime-hot" />} label="Position Size" value={`${view.qty.toFixed(3)} BTC`} sub={usd(view.notional)} />
        <Tile icon={<Zap className="h-3.5 w-3.5 text-accent-2" />} label="Leverage" value={`${view.leverage}x`} />
        <Tile icon={<Wallet className={cx('h-3.5 w-3.5', liqDanger ? 'text-bear-bright' : 'text-ink-faint')} />}
          label="Liquidation" value={price(view.liqPrice)} sub={`${view.liqDistancePct.toFixed(1)}% away`} tone={liqDanger ? 'bear' : undefined} />
        <Tile icon={<Clock className="h-3.5 w-3.5 text-ink-faint" />} label="Trade Time" value={formatHeld(view.heldMs)}
          sub={openedDate.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} />
        <Tile icon={<PieChart className="h-3.5 w-3.5 text-bull-bright" />} label="Equity Change" value={usd(view.pnlUsd, true)} sub={pct(view.pnlPct)} tone={up ? 'bull' : 'bear'} />
      </div>

      {/* Quick actions */}
      <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Quick Actions</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <ActionBtn onClick={onMoveBreakEven} className="border-accent/40 hover:bg-accent/10" icon={<ShieldCheck className="h-4 w-4 text-accent" />}>
          Move SL &rarr; BE
        </ActionBtn>
        <ActionBtn onClick={() => onClosePartial(0.25)} className="border-regime-hot/40 hover:bg-regime-hot/10" icon={<PieChart className="h-4 w-4 text-regime-hot" />}>
          Close 25%
        </ActionBtn>
        <ActionBtn onClick={onToggleTrailing} className={cx('border-accent-2/40 hover:bg-accent-2/10', view.trailing && 'bg-accent-2/15')} icon={<TrendingUp className="h-4 w-4 text-accent-2" />}>
          {view.trailing ? 'Trailing On' : 'Activate Trailing'}
        </ActionBtn>
        <ActionBtn onClick={onCloseFull} className="border-bear/40 hover:bg-bear/10" icon={<XCircle className="h-4 w-4 text-bear-bright" />}>
          Close Full
        </ActionBtn>
      </div>

      {/* Protection footer */}
      <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-2.5 text-[11px]">
        {view.protected ? (
          <>
            <ShieldCheck className="h-3.5 w-3.5 text-bull-bright" />
            <span className="text-bull-bright">Protected</span>
            <span className="text-ink-faint">· SL is active{view.trailing ? ' (trailing)' : ''}</span>
          </>
        ) : (
          <>
            <ShieldCheck className="h-3.5 w-3.5 text-regime-hot" />
            <span className="text-regime-hot">Unprotected</span>
            <span className="text-ink-faint">· no stop loss set</span>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone?: 'bull' | 'bear';
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="truncate text-[11px] text-ink-muted">{label}</span>
      </div>
      <p className={cx('mt-0.5 font-mono text-[15px] font-semibold tabular-nums',
        tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink')}>
        {value}
      </p>
      {sub && <p className="font-mono text-[10px] tabular-nums text-ink-faint">{sub}</p>}
    </div>
  );
}

function ActionBtn({ onClick, className, icon, children }: {
  onClick: () => void; className?: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('focus-ring flex items-center justify-center gap-2 rounded-lg border bg-base px-2 py-2.5 text-[12px] font-medium text-ink transition', className)}
    >
      {icon}
      {children}
    </button>
  );
}
