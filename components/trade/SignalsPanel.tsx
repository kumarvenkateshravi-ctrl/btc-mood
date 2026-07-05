'use client';

import { useState } from 'react';
import { Panel } from '@/components/ui';
import type { SdSignal } from '@/lib/indicators/signalTypes';

export const confidenceBand = (c: number): string => (c >= 80 ? 'High' : c >= 65 ? 'Medium' : 'Low');

export const STATUS_LABEL: Record<SdSignal['status'], string> = {
  armed: 'Armed', triggered: 'Live', tp1: 'TP1', tp2: 'TP2',
  stopped: 'Stopped', invalidated: 'Void', expired: 'Expired',
};

/** Rows shown in the panel: only signals that actually triggered, newest first. */
export const signalRows = (signals: SdSignal[]): SdSignal[] =>
  signals.filter((s) => s.triggeredIndex != null).slice().reverse();

/** Tally why setups did not become signals — powers the "no signals" explainer. */
export function rejectionSummary(signals: SdSignal[]) {
  const invalid = signals.filter((s) => s.status === 'invalidated');
  return {
    total: signals.length,
    confidence: invalid.filter((s) => s.rejectReason === 'confidence').length,
    riskReward: invalid.filter((s) => s.rejectReason === 'riskReward').length,
    zoneBroken: invalid.filter((s) => s.rejectReason === 'zoneBroken').length,
  };
}

/** Empty state that explains WHETHER/why setups were filtered (req: no-signals explainer). */
export function SignalsEmptyState({ signals }: { signals: SdSignal[] }) {
  const s = rejectionSummary(signals);
  if (s.total === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-ink-muted">
        No qualifying signals found with the current filters. No Supply/Demand zone of the
        required tier was reached — try adding a lower zone timeframe (e.g. 4H) or lowering
        &ldquo;Min zone tier&rdquo;.
      </p>
    );
  }
  const parts: string[] = [];
  if (s.confidence) parts.push(`${s.confidence} by confidence`);
  if (s.riskReward) parts.push(`${s.riskReward} by R:R`);
  if (s.zoneBroken) parts.push(`${s.zoneBroken} by zone break`);
  const filtered = s.confidence + s.riskReward + s.zoneBroken;
  return (
    <div className="px-2 py-5 text-center text-xs text-ink-muted">
      <p className="text-ink">No qualifying signals found with the current filters.</p>
      {filtered > 0 && (
        <p className="mt-1">{filtered} setup{filtered === 1 ? '' : 's'} filtered — {parts.join(' · ')}.</p>
      )}
      <p className="mt-1 text-ink-faint">Try lowering &ldquo;Min confidence&rdquo; or &ldquo;Min R:R&rdquo;.</p>
    </div>
  );
}

/** The expandable body for one signal — summary, levels, factor bars, warnings. */
export function SignalDetails({ signal: s }: { signal: SdSignal }) {
  return (
    <div className="pb-2 pl-1 text-[11px] text-ink-muted">
      <p className="mb-1 text-ink">{s.explanation.summary}</p>
      <div className="grid grid-cols-2 gap-x-3">
        <span>Entry {s.entry.toFixed(1)} · SL {s.stopLoss.toFixed(1)}</span>
        <span>TP1 {s.takeProfit1.toFixed(1)} · TP2 {s.takeProfit2.toFixed(1)}</span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {s.explanation.factors.map((f) => (
          <li key={f.key} className="flex items-center justify-between">
            <span>{f.label}</span>
            <span className="font-mono tabular-nums">+{f.contribution.toFixed(0)}</span>
          </li>
        ))}
      </ul>
      {s.explanation.counterSignals.length > 0 && (
        <p className="mt-1 text-amber-400">⚠ {s.explanation.counterSignals.join(' · ')}</p>
      )}
    </div>
  );
}

export default function SignalsPanel({ signals }: { signals: SdSignal[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = signalRows(signals);

  return (
    <Panel title="Signals">
      <p className="mb-2 text-[10px] text-ink-faint">Paper &amp; educational — not financial advice.</p>
      {rows.length === 0 ? (
        <SignalsEmptyState signals={signals} />
      ) : (
        <ul className="divide-y divide-line text-xs">
          {rows.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={s.id}
                onClick={() => setOpen(open === s.id ? null : s.id)}
                className="focus-ring flex w-full items-center justify-between gap-2 py-2 text-left"
              >
                <span className={s.side === 'buy' ? 'font-semibold text-bull-bright' : 'font-semibold text-bear-bright'}>
                  {s.side === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span className="font-mono tabular-nums text-ink">{s.entry.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink-muted">R{s.riskReward.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink">{Math.round(s.confidence)} · {confidenceBand(s.confidence)}</span>
                <span className="text-ink-faint">{STATUS_LABEL[s.status]}</span>
              </button>
              {open === s.id && <SignalDetails signal={s} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
