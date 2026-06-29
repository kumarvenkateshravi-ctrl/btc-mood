// MDS — PositionCard. The card form of a position (PositionRow is the table form).
// Pure composition: Panel + Badge + Num.* + Ring. Zero new formatting, zero new
// presentation rules. Useful as a standalone card and as the mobile collapse of
// the Open Positions table (DESIGN.md §J). See §B5-FREEZE / §H-FREEZE / §C-FREEZE.

import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Panel } from './Panel';
import { Badge } from './Badge';
import Num from './Num';
import { Ring } from './viz';
import { cx, scoreColor, type Tone } from './util';

export interface PositionCardData {
  asset: string;
  symbol?: string;
  direction: string;       // Long | Short
  quantity: number;
  entry: number;
  current: number;
  pnl: number;
  pnlPercent: number;
  rr?: number;
  leverage?: number;
  health?: number;
  action?: string;         // Hold | Watch | Reduce | Exit
}

const dirTone = (d: string): Tone => (d === 'Long' || d === 'Buy' ? 'bull' : d === 'Short' || d === 'Sell' ? 'bear' : 'neutral');
const actionTone = (a: string): Tone => (a === 'Hold' ? 'bull' : a === 'Watch' || a === 'Reduce' ? 'warn' : a === 'Exit' ? 'bear' : 'neutral');

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="text-[9px] uppercase tracking-wider text-ink-faint">{label}</div><div className="font-semibold">{children}</div></div>;
}

export function PositionCard({ asset, symbol, direction, quantity, entry, current, pnl, pnlPercent, rr, leverage, health, action, onClick, className }: PositionCardData & { onClick?: () => void; className?: string }) {
  return (
    <Panel interactive={!!onClick} className={cx(onClick && 'cursor-pointer', className)}>
      <div
        onClick={onClick}
        {...(onClick ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': `${direction} ${symbol ?? `${asset}USDT`} position`,
          onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
          className: 'focus-ring rounded-lg',
        } : {})}
      >
        {/* Header: asset identity + direction + (optional) health ring */}
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-[9px] font-bold text-ink-muted">{asset.slice(0, 1)}</span>
          <span className="font-semibold">{symbol ?? `${asset}USDT`}</span>
          <Badge tone={dirTone(direction)}>{direction}</Badge>
          {leverage != null && <span className="text-[10px] text-ink-faint">{leverage}x</span>}
          {health != null && (
            <span className="ml-auto">
              <Ring value={health} size={32} color={scoreColor(health)} glow>
                <span className="num text-[8px] font-bold" style={{ color: scoreColor(health) }}>{Math.round(health)}</span>
              </Ring>
            </span>
          )}
        </div>

        {/* P&L hero */}
        <div className="mt-2 flex items-baseline gap-2">
          <Num.Pnl value={pnl} className="text-2xl" />
          <Num.Pct value={pnlPercent} tone className="text-sm" />
        </div>

        {/* Detail grid */}
        <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line/60 pt-2 text-[11px]">
          <Field label="Entry"><Num.Price value={entry} currency="none" /></Field>
          <Field label="Current"><Num.Price value={current} currency="none" /></Field>
          <Field label="Quantity"><Num.Qty value={quantity} unit={asset} /></Field>
          {rr != null && <Field label="R:R"><Num.RR ratio={rr} /></Field>}
        </div>

        {action && <div className="mt-2"><Badge tone={actionTone(action)}>{action}</Badge></div>}
      </div>
    </Panel>
  );
}
