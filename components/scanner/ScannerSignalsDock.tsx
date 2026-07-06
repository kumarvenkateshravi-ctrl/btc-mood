'use client';

// Technical Scanner — interactive signal dock on the chart. Each signal gets
// a clickable chip; clicking opens the details card (strategy + version, the
// Why? checklist, entry/SL/TP1-3, current R, trade status, event timeline)
// and focuses that trade's levels/boxes on the chart via the selection store.

import { useState } from 'react';
import type { ScannerSnapshot } from '@/lib/scanner/engine';
import { selectScannerSignal } from '@/lib/scanner/scannerUiStore';
import type { ScannerSignal } from '@/lib/scanner/signals';
import type { VdTrade } from '@/lib/indicators/vdEngine';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', tp1: 'TP1 ✓', tp2: 'TP2 ✓', tp3: 'TP3 ✓', stopped: 'Stopped', exit: 'Exit',
};

const fmtTime = (unixSec: number): string =>
  new Date(unixSec * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Signed current R for an open trade at midPrice; realized R when resolved. */
export function currentR(t: VdTrade<ScannerSignal>, midPrice?: number): number | null {
  if (t.realizedR != null) return t.realizedR;
  if (midPrice == null) return null;
  const risk = Math.abs(t.signal.entry - t.signal.stopLoss);
  if (risk <= 0) return null;
  const dir = t.signal.side === 'buy' ? 1 : -1;
  return (dir * (midPrice - t.signal.entry)) / risk;
}

export default function ScannerSignalsDock({
  snapshot,
  midPrice,
}: {
  snapshot: ScannerSnapshot | null;
  midPrice?: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!snapshot || snapshot.trades.length === 0) return null;
  const visible = snapshot.trades.filter((t) => snapshot.byStrategy[t.signal.strategyId]?.chartVisible !== false);
  if (visible.length === 0) return null;
  const chips = visible.slice(-5);
  const open = openId ? visible.find((t) => t.signal.id === openId) : undefined;

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    selectScannerSignal(next);
  };

  return (
    <div className="pointer-events-none absolute bottom-10 left-14 z-20 flex flex-col items-start gap-1.5">
      {open && <SignalCard trade={open} snapshot={snapshot} midPrice={midPrice} onClose={() => toggle(open.signal.id)} />}
      <div className="pointer-events-auto flex flex-wrap gap-1">
        {chips.map((t) => {
          const s = t.signal;
          const buy = s.side === 'buy';
          return (
            <button
              key={s.id}
              type="button"
              aria-label={`signal ${s.id}`}
              onClick={() => toggle(s.id)}
              className={[
                'focus-ring rounded-md border px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition',
                openId === s.id ? 'border-accent/60 bg-surface-2 text-ink' : 'border-line bg-surface-1/90 text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              <span className={buy ? 'text-bull-bright' : 'text-bear-bright'}>{buy ? '▲' : '▼'}</span>{' '}
              {fmtTime(s.barTime)} · {STATUS_LABEL[t.status]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SignalCard({
  trade: t, snapshot, midPrice, onClose,
}: {
  trade: VdTrade<ScannerSignal>;
  snapshot: ScannerSnapshot;
  midPrice?: number;
  onClose: () => void;
}) {
  const s = t.signal;
  const name = snapshot.byStrategy[s.strategyId]?.name ?? s.strategyId;
  const version = s.strategyVersionId.split('@')[1] ?? '';
  const r = currentR(t, midPrice);
  const timeline = snapshot.events.filter((e) => e.signalId === s.id);

  return (
    <div className="pointer-events-auto w-[248px] rounded-lg border border-line bg-surface-1 p-2.5 text-[11px] shadow-lg">
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${s.side === 'buy' ? 'text-bull-bright' : 'text-bear-bright'}`}>
          {s.side === 'buy' ? 'BUY' : 'SELL'} · {name} {version}
        </span>
        <button type="button" onClick={onClose} aria-label="Close signal card" className="focus-ring px-1 text-ink-faint hover:text-ink">✕</button>
      </div>
      <p className="mt-0.5 text-[10px] text-ink-faint">{fmtTime(s.barTime)} · confidence {s.confidence} · {STATUS_LABEL[t.status]}</p>

      <div className="mt-1.5 grid grid-cols-2 gap-x-2 font-mono text-[10px] tabular-nums text-ink-muted">
        <span>Entry {s.entry.toFixed(1)}</span>
        <span>SL {t.slCurrent.toFixed(1)}</span>
        <span>TP1 {s.tp1.toFixed(1)} · TP2 {s.tp2.toFixed(1)}</span>
        <span>TP3 {s.tp3.toFixed(1)}</span>
      </div>
      {r != null && (
        <p className={`mt-1 font-mono text-[10px] tabular-nums ${r >= 0 ? 'text-bull-bright' : 'text-bear-bright'}`}>
          {t.realizedR != null ? 'Realized' : 'Current'} R {r >= 0 ? '+' : ''}{r.toFixed(2)}
        </p>
      )}

      <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Why it triggered</p>
      <ul className="mt-0.5 space-y-0.5 text-[10px] text-ink-muted">
        {s.why.map((w, i) => (
          <li key={i}>
            <span className={w.pass ? 'text-bull-bright' : 'text-bear-bright'}>{w.pass ? '✓' : '✕'}</span>{' '}
            {w.label} {w.expect}{w.value != null ? ` (= ${w.value.toFixed(1)})` : ''}
          </li>
        ))}
      </ul>

      {timeline.length > 0 && (
        <>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Timeline</p>
          <ul className="mt-0.5 space-y-0.5 font-mono text-[10px] tabular-nums text-ink-faint">
            {timeline.map((e) => (
              <li key={e.eventId}>{fmtTime(e.barTime)} · {e.eventType}{e.price != null ? ` @ ${e.price.toFixed(1)}` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
