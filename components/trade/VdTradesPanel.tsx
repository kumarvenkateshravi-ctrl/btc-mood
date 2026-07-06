'use client';

// Volume Distribution Zones — trade table (execution layer Phase 2): every
// tracked trade with its EXACT entry / SL / TP1-3, grade, context score,
// status and realized R, plus a performance header (win rate, avg R, profit
// factor, per-grade rollup). Clicking a row focuses that trade on the chart.

import { useState } from 'react';
import { Panel } from '@/components/ui';
import {
  latestVdTrades, latestVdDecisions, selectVdTrade, selectedVdTradeId, vdTradeId,
} from '@/lib/context/contextStore';
import type { VdTrade } from '@/lib/indicators/vdEngine';
import type { Decision, SignalGrade } from '@/lib/context/types';

const STATUS_LABEL: Record<VdTrade['status'], string> = {
  active: 'Active', tp1: 'TP1 ✓', tp2: 'TP2 ✓', tp3: 'TP3 ✓', stopped: 'Stopped', exit: 'Exit',
};

const fmtTime = (unixSec: number): string =>
  new Date(unixSec * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

/** Signed price points captured (or currently in favor for open trades). */
export function tradePoints(t: VdTrade): { points: number; open: boolean } {
  const dir = t.signal.side === 'buy' ? 1 : -1;
  if (t.exitPrice != null) return { points: dir * (t.exitPrice - t.signal.entry), open: false };
  const risk = Math.abs(t.signal.entry - t.signal.stopLoss);
  return { points: t.mfeR * risk, open: true };
}

export interface VdStats {
  trades: number; resolved: number; winRate: number; avgR: number;
  expectancy: number; profitFactor: number; avgMfeR: number; avgMaeR: number;
  byGrade: Partial<Record<SignalGrade, { n: number; winRate: number }>>;
  byTf: Record<string, { n: number; winRate: number }>;
}

export function vdStats(trades: VdTrade[], gradeOfTrade: (t: VdTrade) => SignalGrade | null): VdStats {
  const resolved = trades.filter((t) => t.realizedR != null);
  const rs = resolved.map((t) => t.realizedR as number);
  const wins = rs.filter((r) => r > 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  const byGrade: VdStats['byGrade'] = {};
  const byTf: VdStats['byTf'] = {};
  for (const t of resolved) {
    const win = (t.realizedR as number) > 0 ? 1 : 0;
    const g = gradeOfTrade(t);
    if (g) {
      const slot = (byGrade[g] ??= { n: 0, winRate: 0 });
      slot.n++; slot.winRate += win;
    }
    const tfSlot = (byTf[t.signal.tf] ??= { n: 0, winRate: 0 });
    tfSlot.n++; tfSlot.winRate += win;
  }
  for (const g of Object.keys(byGrade) as SignalGrade[]) byGrade[g]!.winRate /= byGrade[g]!.n || 1;
  for (const tf of Object.keys(byTf)) byTf[tf].winRate /= byTf[tf].n || 1;
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0;
  return {
    trades: trades.length,
    resolved: resolved.length,
    winRate: rs.length ? wins.length / rs.length : 0,
    avgR,
    expectancy: avgR, // R per trade
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgMfeR: resolved.length ? resolved.reduce((s, t) => s + t.mfeR, 0) / resolved.length : 0,
    avgMaeR: resolved.length ? resolved.reduce((s, t) => s + t.maeR, 0) / resolved.length : 0,
    byGrade, byTf,
  };
}

export default function VdTradesPanel({ symbol, tf }: { symbol?: string; tf?: string } = {}) {
  const [selected, setSelected] = useState<string | null>(selectedVdTradeId());
  const trades = latestVdTrades() ?? [];
  const decisions = latestVdDecisions()?.decisions ?? [];
  const decisionFor = (t: VdTrade): Decision | undefined =>
    decisions.find((d) => d.signal === t.signal);
  const stats = vdStats(trades, (t) => decisionFor(t)?.grade ?? null);
  const rows = [...trades].reverse();

  const pick = (t: VdTrade) => {
    const id = vdTradeId(t);
    const next = selected === id ? null : id;
    selectVdTrade(next);
    setSelected(next);
  };

  return (
    <Panel title="VD Trades" sym={symbol && tf ? `(${symbol} · ${tf})` : undefined}>
      <p className="mb-1 text-[10px] text-ink-faint">Paper &amp; educational — not financial advice.</p>
      {stats.resolved > 0 && (
        <div className="mb-2 space-y-0.5 font-mono text-[10px] tabular-nums text-ink-muted">
          <p>
            {stats.resolved} closed · win {(stats.winRate * 100).toFixed(0)}% · exp {stats.expectancy.toFixed(2)}R · PF{' '}
            {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
            {' '}· MFE {stats.avgMfeR.toFixed(1)}R · MAE {stats.avgMaeR.toFixed(1)}R
          </p>
          <p className="text-ink-faint">
            {Object.entries(stats.byGrade).map(([g, v]) => `${g} ${(v.winRate * 100).toFixed(0)}% (${v.n})`).join(' · ')}
            {Object.keys(stats.byTf).length > 1 &&
              ' · ' + Object.entries(stats.byTf).map(([t, v]) => `${t}-zone ${(v.winRate * 100).toFixed(0)}% (${v.n})`).join(' · ')}
          </p>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-5 text-center text-xs text-ink-muted">
          No trades yet — signals appear when a zone rejection passes the MTF context gate.
        </p>
      ) : (
        <ul className="divide-y divide-line text-[11px]">
          {rows.map((t) => {
            const d = decisionFor(t);
            const id = vdTradeId(t);
            const s = t.signal;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-label={id}
                  onClick={() => pick(t)}
                  className={[
                    'focus-ring w-full py-1.5 text-left transition',
                    selected === id ? 'bg-surface-2' : 'hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={s.side === 'buy' ? 'font-semibold text-bull-bright' : 'font-semibold text-bear-bright'}>
                      {s.side === 'buy' ? 'BUY' : 'SELL'}{d ? ` · ${d.grade}` : ''}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-ink-muted">{fmtTime(t.entryTime)}</span>
                    <span className="text-ink-faint">{STATUS_LABEL[t.status]}</span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-2 gap-x-2 font-mono text-[10px] tabular-nums text-ink-faint">
                    <span>Entry {s.entry.toFixed(1)} · SL {s.stopLoss.toFixed(1)}</span>
                    <span>TP1 {s.tp1.toFixed(1)} · TP2 {s.tp2.toFixed(1)} · TP3 {s.tp3.toFixed(1)}</span>
                  </div>
                  {(() => {
                    const { points, open } = tradePoints(t);
                    if (open) {
                      return (
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          Open · best +{points.toFixed(1)} pts so far
                          {d ? ` · ctx ${Math.round(d.contextScore)} · ${d.riskProfile} risk` : ''}
                        </div>
                      );
                    }
                    const win = points >= 0;
                    const label = win ? 'Profit' : t.status === 'exit' ? 'Loss (context exit)' : 'Loss (SL hit)';
                    return (
                      <div className={`mt-0.5 text-[10px] font-medium ${win ? 'text-bull-bright' : 'text-bear-bright'}`}>
                        {label} {points >= 0 ? '+' : ''}{points.toFixed(1)} pts
                        ({t.realizedR! >= 0 ? '+' : ''}{t.realizedR!.toFixed(2)}R)
                        {t.exitPrice != null ? ` · exit ${t.exitPrice.toFixed(1)}` : ''}
                        {t.resolvedTime ? ` · ${fmtTime(t.resolvedTime)}` : ''} · {t.barsHeld} bars
                      </div>
                    );
                  })()}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
