'use client';

import { useEffect, useState } from 'react';
import {
  loadRules,
  newRuleId,
  saveRules,
  type AlertRule,
  type AlertSide,
} from '@/lib/alerts';
import type { Timeframe } from '@/lib/types';
import { TIMEFRAMES } from '@/lib/types';
import { Bell, Plus, Trash2 } from 'lucide-react';

interface AlertsPanelProps {
  defaultTf: Timeframe;
}

const SELECT_CLASS =
  'focus-ring rounded-lg border border-line bg-base px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-line-strong';

export default function AlertsPanel({ defaultTf }: AlertsPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [newTf, setNewTf] = useState<Timeframe>(defaultTf);
  const [newSide, setNewSide] = useState<AlertSide>('buy');
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');

  // Load persisted rules + notification permission after mount (avoids a
  // hydration mismatch between server [] and client localStorage).
  useEffect(() => {
    setRules(loadRules());
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  function update(next: AlertRule[]) {
    setRules(next);
    saveRules(next);
  }

  function addRule() {
    const next: AlertRule = {
      id: newRuleId(),
      tf: newTf,
      side: newSide,
      enabled: true,
      createdAt: Date.now(),
      lastFiredAt: null,
    };
    update([next, ...rules]);
  }

  function toggleRule(id: string) {
    update(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function removeRule(id: string) {
    update(rules.filter((r) => r.id !== id));
  }

  async function requestPerm() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }

  return (
    <section className="panel rounded-2xl p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Bell className="h-4 w-4 text-accent" />
          Alerts
        </h2>
        {permission === 'default' && (
          <button
            onClick={requestPerm}
            className="focus-ring rounded text-[11px] text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            Enable browser notifications
          </button>
        )}
        {permission === 'granted' && (
          <span className="inline-flex items-center gap-1.5 text-[10px] text-bull-bright">
            <span className="h-1.5 w-1.5 rounded-full bg-bull" />
            notifications on
          </span>
        )}
        {permission === 'denied' && (
          <span className="text-[10px] text-bear-bright">notifications blocked</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={newTf}
          onChange={(e) => setNewTf(e.target.value as Timeframe)}
          aria-label="Alert timeframe"
          className={SELECT_CLASS}
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
        <select
          value={newSide}
          onChange={(e) => setNewSide(e.target.value as AlertSide)}
          aria-label="Alert side"
          className={SELECT_CLASS}
        >
          <option value="buy">BUY</option>
          <option value="sell">SELL</option>
        </select>
        <button
          onClick={addRule}
          className="focus-ring inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/30 transition hover:bg-accent/25"
        >
          <Plus className="h-3 w-3" /> Add rule
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="mt-3 text-xs text-ink-faint">
          No rules yet. Add one to be notified the moment a timeframe flips to a side.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2"
            >
              <label className="flex items-center gap-2.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => toggleRule(r.id)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="font-mono uppercase tracking-wider text-ink-muted">{r.tf}</span>
                <span
                  className={[
                    'inline-flex items-center gap-1 font-semibold',
                    r.side === 'buy' ? 'text-bull-bright' : 'text-bear-bright',
                    r.enabled ? '' : 'opacity-45',
                  ].join(' ')}
                >
                  <span aria-hidden>{r.side === 'buy' ? '▲' : '▼'}</span>
                  {r.side.toUpperCase()}
                </span>
              </label>
              <button
                onClick={() => removeRule(r.id)}
                className="focus-ring rounded p-1 text-ink-faint transition-colors hover:text-bear-bright"
                aria-label={`Remove ${r.tf} ${r.side} rule`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
