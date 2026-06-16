'use client';

import { useMemo } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { usePaperStore } from '@/lib/paperStore';
import { unrealizedPnl, type PaperOrder, type PaperPosition } from '@/lib/paper';

interface PositionsPanelProps {
  markPrice: number;
  onEditTp?: () => void;
  onEditSl?: () => void;
}

export default function PositionsPanel({ markPrice, onEditTp, onEditSl }: PositionsPanelProps) {
  const {
    positions, pending, closePosition, partialClose, cancelOrder, cancelAll,
    setPositionOverlay, toggleTrailingSl, resetAll, balance, initialBalance,
  } = usePaperStore();

  const openPositions: [string, PaperPosition][] = useMemo(
    () => Object.entries(positions).filter(([, p]) => p && p.side !== 'flat' && p.units > 0) as [string, PaperPosition][],
    [positions],
  );

  const hasPending = pending.length > 0;

  // Aggregate unrealized PnL across all positions.
  const totalUPnL = useMemo(
    () => openPositions.reduce((sum, [, p]) => sum + unrealizedPnl(p, markPrice), 0),
    [openPositions, markPrice],
  );

  const totalPnl = balance + totalUPnL - initialBalance;
  const pnlSign = totalPnl >= 0 ? '+' : '';
  const pnlColor = totalPnl >= 0 ? 'text-bull-bright' : 'text-bear-bright';

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between border-b border-line bg-surface-2/40 px-3.5 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Positions · Orders
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={resetAll}
            className="focus-ring rounded-md border border-line bg-surface-2/40 px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
            title="Reset paper account — clear positions, trades, and orders"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          {hasPending && (
            <button
              onClick={cancelAll}
              className="focus-ring rounded-md border border-line bg-surface-2/40 px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
            >
              Cancel all
            </button>
          )}
        </div>
      </header>

      <div className="p-3.5">
        {/* Balance summary */}
        <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-surface-1/40 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Balance</span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-ink">${balance.toFixed(2)}</span>
            <span className={['font-mono text-xs tabular-nums', pnlColor].join(' ')}>
              {pnlSign}${Math.abs(totalPnl).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Open positions */}
        {openPositions.length === 0 && !hasPending && (
          <p className="rounded-lg border border-line bg-surface-1/40 px-3 py-3 text-xs text-ink-faint">
            No open positions. Use the order ticket to place a paper trade.
          </p>
        )}
        {openPositions.map(([sym, position]) => (
          <PositionCard
            key={sym}
            symbol={sym}
            position={position}
            markPrice={markPrice}
            onClose={() => closePosition(markPrice, sym)}
            onPartialClose={(f) => partialClose(sym, f, markPrice)}
            onClearTp={() => setPositionOverlay('tp', null, sym)}
            onClearSl={() => setPositionOverlay('sl', null, sym)}
            onToggleTrail={() => toggleTrailingSl(sym, !position.trailingSl)}
            onEditTp={onEditTp}
            onEditSl={onEditSl}
          />
        ))}

        {/* Working orders */}
        {hasPending && (
          <div className="mt-3">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Working ({pending.length})
            </h3>
            <ul className="space-y-1.5">
              {pending.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded-md border border-line bg-surface-1/30 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        o.side === 'buy' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright',
                      ].join(' ')}
                    >
                      {o.side}
                    </span>
                    <span className="text-ink-muted">
                      {o.symbol.replace('USDT', '')} {o.type} {o.units} @ {o.price?.toFixed(1) ?? '—'}
                    </span>
                  </span>
                  <button
                    onClick={() => cancelOrder(o.id)}
                    className="focus-ring rounded-md border border-line bg-surface-2/40 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
                    aria-label="Cancel order"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function PositionCard({
  symbol,
  position,
  markPrice,
  onClose,
  onPartialClose,
  onClearTp,
  onClearSl,
  onToggleTrail,
  onEditTp,
  onEditSl,
}: {
  symbol: string;
  position: PaperPosition;
  markPrice: number;
  onClose: () => void;
  onPartialClose: (fraction: number) => void;
  onClearTp: () => void;
  onClearSl: () => void;
  onToggleTrail: () => void;
  onEditTp?: () => void;
  onEditSl?: () => void;
}) {
  const upnl = unrealizedPnl(position, markPrice);
  const label = symbol.replace('USDT', '');
  return (
    <div className="mb-2 rounded-lg border border-line bg-surface-1/40">
      <div className="space-y-1.5 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              position.side === 'long'
                ? 'bg-bull/15 text-bull-bright'
                : 'bg-bear/15 text-bear-bright',
            ].join(' ')}
          >
            {position.side === 'long' ? 'Long' : 'Short'} {position.units.toFixed(4)} {label}
          </span>
          <button
            onClick={onClose}
            className="focus-ring inline-flex items-center gap-1 rounded-md border border-line bg-surface-2/40 px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink"
            aria-label={`Close ${symbol} position`}
          >
            <X className="h-3 w-3" /> Close
          </button>
        </div>
        <Row label="Entry" value={position.entryPrice.toFixed(1)} unit="USD" />
        <Row label="Mark" value={markPrice.toFixed(1)} unit="USD" />
        <Row
          label="Unrealized P&L"
          value={(upnl >= 0 ? '+' : '') + upnl.toFixed(2)}
          unit="USD"
          tone={upnl >= 0 ? 'bull' : 'bear'}
          emphasis
        />
        <Row label="Realized" value={position.realizedPnl.toFixed(2)} unit="USD" />
        <Row label="Fees" value={position.feesPaid.toFixed(2)} unit="USD" />
        <div className="flex items-center gap-1 pt-1">
          <span className="text-[10px] text-ink-faint">Close</span>
          {[0.25, 0.5, 0.75].map((f) => (
            <button
              key={f}
              onClick={() => onPartialClose(f)}
              className="rounded border border-line bg-surface-2/40 px-1.5 py-0.5 text-[10px] font-mono font-medium text-ink-muted transition hover:border-accent/40 hover:text-ink"
              title={`Close ${(f * 100).toFixed(0)}% of ${position.units.toFixed(4)} ${label}`}
            >
              {(f * 100).toFixed(0)}%
            </button>
          ))}
        </div>
        {position.tp != null && (
          <button
            onClick={onClearTp}
            onContextMenu={(e) => {
              e.preventDefault();
              onEditTp?.();
            }}
            className="group flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-surface-2/50"
            title="Click to remove TP, right-click to focus on chart"
          >
            <span className="text-ink-faint">TP</span>
            <span className="font-mono tabular-nums text-bull-bright">
              {position.tp.toFixed(1)}
              <span className="ml-1 text-[10px] text-ink-faint">USD</span>
            </span>
          </button>
        )}
        {position.sl != null && (
          <div className="flex items-baseline justify-between gap-2">
            <button
              onClick={onClearSl}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditSl?.();
              }}
              className="group flex flex-1 items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-surface-2/50"
              title="Click to remove SL, right-click to focus on chart"
            >
              <span className="text-ink-faint">SL</span>
              <span className="font-mono tabular-nums text-bear-bright">
                {position.sl.toFixed(1)}
                <span className="ml-1 text-[10px] text-ink-faint">USD</span>
              </span>
            </button>
            <button
              onClick={onToggleTrail}
              aria-pressed={position.trailingSl}
              className={[
                'rounded border px-1.5 py-0.5 text-[10px] font-medium transition',
                position.trailingSl
                  ? 'border-accent/40 bg-accent/15 text-ink'
                  : 'border-line bg-surface-2/40 text-ink-muted hover:text-ink',
              ].join(' ')}
              title="Toggle trailing stop loss"
            >
              {position.trailingSl ? 'Trail ON' : 'Trail'}
            </button>
          </div>
        )}
        {(position.tp == null || position.sl == null) && (
          <p className="text-[10px] text-ink-faint">
            Drag the lines on the chart to set TP/SL.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  unit,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'bull' | 'bear';
  emphasis?: boolean;
}) {
  const toneClass =
    tone === 'bull'
      ? 'text-bull-bright'
      : tone === 'bear'
      ? 'text-bear-bright'
      : 'text-ink';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd
        className={[
          'font-mono tabular-nums',
          toneClass,
          emphasis ? 'text-sm font-semibold' : '',
        ].join(' ')}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] text-ink-faint">{unit}</span>}
      </dd>
    </div>
  );
}

export type { PaperOrder };
