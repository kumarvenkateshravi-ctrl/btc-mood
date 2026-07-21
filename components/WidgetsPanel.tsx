'use client';

// Widgets section of the right rail — a small manager for optional widgets the
// trader can switch on. Enabling one makes it appear inside its home panel
// (e.g. the Active Trade widget shows below the Mood infographics). Extensible:
// add an entry to WIDGETS and a render site keyed off the same pref.

import { Boxes, Activity, Check } from 'lucide-react';
import { cx } from '@/components/ui/util';

export type WidgetKey = 'activeTrade' | 'marketContext';

export interface WidgetPrefs {
  activeTrade: boolean;
  marketContext: boolean;
}

export const DEFAULT_WIDGET_PREFS: WidgetPrefs = { activeTrade: false, marketContext: false };

interface WidgetMeta {
  key: WidgetKey;
  name: string;
  desc: string;
  home: string; // where it appears when enabled
  Icon: typeof Activity;
  /** Live status line shown under the widget (optional). */
  statusKey?: 'trade';
}

const WIDGETS: WidgetMeta[] = [
  {
    key: 'activeTrade',
    name: 'Active Trade',
    desc: 'Live P&L, R-multiple, risk/reward, leverage, liquidation and one-tap trade management for your open position.',
    home: 'Shows below the Mood panel',
    Icon: Activity,
    statusKey: 'trade',
  },
  {
    key: 'marketContext',
    name: 'Market Context',
    desc: 'Compact real-time bias and trend scoring overlay across multiple timeframes.',
    home: 'Shows on the Chart panel',
    Icon: Boxes,
  },
];

export default function WidgetsPanel({
  prefs,
  onToggle,
  hasActiveTrade,
}: {
  prefs: WidgetPrefs;
  onToggle: (key: WidgetKey) => void;
  hasActiveTrade: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink">Widgets</h2>
      </div>
      <p className="text-[11px] leading-snug text-ink-faint">
        Turn on the panels you want. Enabled widgets appear inside their home
        section so your dashboards stay together.
      </p>

      <div className="mt-1 space-y-2">
        {WIDGETS.map((w) => {
          const on = prefs[w.key];
          const status =
            w.statusKey === 'trade'
              ? hasActiveTrade
                ? { text: 'Position open now', tone: 'bull' as const }
                : { text: 'No open position', tone: 'muted' as const }
              : null;
          return (
            <div key={w.key} className="rounded-xl border border-line bg-surface-1 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                    <w.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{w.name}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{w.desc}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">{w.home}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(w.key)}
                  aria-pressed={on}
                  className={cx(
                    'focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
                    on
                      ? 'bg-accent text-black hover:opacity-90'
                      : 'border border-line bg-base text-ink-muted hover:text-ink',
                  )}
                >
                  {on ? (
                    <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Shown</span>
                  ) : (
                    'Show'
                  )}
                </button>
              </div>
              {status && (
                <p className={cx('mt-2 border-t border-line/60 pt-2 text-[11px]',
                  status.tone === 'bull' ? 'text-bull-bright' : 'text-ink-faint')}>
                  {status.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
