'use client';

// Step 1-2 of the replay trading simulator (spec: replayBar.md): configure
// the paper account before trading — currency, balance, commission, leverage
// (1x / 5x / 10x only, per product rule) and risk % per trade.

import { useState } from 'react';
import {
  SESSION_CURRENCIES,
  SESSION_LEVERAGES,
  SESSION_RISK_PRESETS,
  currencySymbol,
  type SessionConfig,
  type SessionLeverage,
} from '@/lib/replay/sessionSim';

export default function SessionSetupCard({
  initial,
  onStart,
  onSkip,
}: {
  initial: SessionConfig;
  onStart: (cfg: SessionConfig) => void;
  onSkip: () => void;
}) {
  const [cfg, setCfg] = useState<SessionConfig>(initial);
  const [customRisk, setCustomRisk] = useState(false);
  const sym = currencySymbol(cfg.currency);
  const riskAmount = (cfg.startBalance * cfg.riskPct) / 100;

  const chip = (active: boolean) =>
    `focus-ring rounded-lg border px-2.5 py-1 text-[11px] transition ${
      active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-base text-ink-muted hover:text-ink'
    }`;

  return (
    <div className="rounded-xl border border-accent/30 bg-surface-1 p-3 text-xs">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">Start Trading Session</p>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Currency</span>
          <div className="mt-1 flex gap-1">
            {SESSION_CURRENCIES.map((c) => (
              <button key={c.code} type="button" className={chip(cfg.currency === c.code)} onClick={() => setCfg({ ...cfg, currency: c.code })}>
                {c.symbol} {c.code}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Starting balance</span>
          <input
            type="number"
            min={10}
            step={100}
            value={cfg.startBalance}
            onChange={(e) => setCfg({ ...cfg, startBalance: Math.max(10, Number(e.target.value) || 0) })}
            className="focus-ring mt-1 h-7 w-24 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Commission %</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={cfg.commissionRate * 100}
            onChange={(e) => setCfg({ ...cfg, commissionRate: Math.max(0, Number(e.target.value) || 0) / 100 })}
            className="focus-ring mt-1 h-7 w-16 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Leverage</span>
          <div className="mt-1 flex gap-1">
            {SESSION_LEVERAGES.map((lv) => (
              <button key={lv} type="button" className={chip(cfg.leverage === lv)} onClick={() => setCfg({ ...cfg, leverage: lv as SessionLeverage })}>
                {lv}x
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Risk per trade</span>
          <div className="mt-1 flex items-center gap-1">
            {SESSION_RISK_PRESETS.map((r) => (
              <button
                key={r}
                type="button"
                className={chip(!customRisk && cfg.riskPct === r)}
                onClick={() => {
                  setCustomRisk(false);
                  setCfg({ ...cfg, riskPct: r });
                }}
              >
                {r}%
              </button>
            ))}
            <button type="button" className={chip(customRisk)} onClick={() => setCustomRisk(true)}>
              Custom
            </button>
            {customRisk && (
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={cfg.riskPct}
                onChange={(e) => setCfg({ ...cfg, riskPct: Math.min(10, Math.max(0.1, Number(e.target.value) || 0.1)) })}
                className="focus-ring h-7 w-14 rounded-lg border border-line bg-base px-2 font-mono text-[11px] text-ink"
              />
            )}
          </div>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-ink-faint">
            Risk amount <span className="font-mono text-ink">{sym}{riskAmount.toFixed(2)}</span>
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="focus-ring rounded-lg border border-line bg-base px-2.5 py-1.5 text-[11px] text-ink-muted hover:text-ink"
          >
            Watch only
          </button>
          <button
            type="button"
            onClick={() => onStart(cfg)}
            className="focus-ring rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black hover:opacity-90"
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  );
}
