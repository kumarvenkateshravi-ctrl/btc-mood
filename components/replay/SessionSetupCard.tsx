'use client';

import { useState, type ReactNode } from 'react';
import { ShieldCheck, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/util';
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
    cx(
      'focus-ring rounded-md border px-2.5 py-1 text-[11px] transition',
      active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-base text-ink-muted hover:bg-surface-2 hover:text-ink',
    );

  return (
    <div className="elev-1 rounded-xl p-4 text-xs">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-[220px] flex-1 items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] font-semibold text-ink">Set up the practice account</p>
              <Badge tone="accent">Isolated</Badge>
            </div>
            <p className="mt-1 max-w-[62ch] text-[11px] leading-snug text-ink-faint">
              This replay uses a separate balance. Your live paper account stays unchanged when the drill ends.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-base px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Risk preview</p>
          <p className="mt-1 font-mono text-[13px] tabular-nums text-ink">
            {sym}{formatMoney(riskAmount)} per trade
          </p>
          <p className="mt-0.5 text-[10px] text-ink-faint">{cfg.riskPct}% risk, {cfg.leverage}x leverage</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_0.85fr_0.9fr_1fr]">
        <Field label="Currency">
          <div className="flex flex-wrap gap-1">
            {SESSION_CURRENCIES.map((c) => (
              <button key={c.code} type="button" className={chip(cfg.currency === c.code)} onClick={() => setCfg({ ...cfg, currency: c.code })}>
                {c.symbol} {c.code}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Starting balance">
          <div className="flex items-center rounded-lg border border-line bg-base px-2">
            <span className="text-[11px] text-ink-faint">{sym}</span>
            <input
              type="number"
              min={10}
              step={100}
              value={cfg.startBalance}
              onChange={(e) => setCfg({ ...cfg, startBalance: Math.max(10, Number(e.target.value) || 0) })}
              className="focus-ring h-8 w-full bg-transparent px-1 font-mono text-[12px] text-ink outline-none"
            />
          </div>
        </Field>
        <Field label="Leverage">
          <div className="flex flex-wrap gap-1">
            {SESSION_LEVERAGES.map((lv) => (
              <button key={lv} type="button" className={chip(cfg.leverage === lv)} onClick={() => setCfg({ ...cfg, leverage: lv as SessionLeverage })}>
                {lv}x
              </button>
            ))}
          </div>
        </Field>
        <Field label="Risk per trade">
          <div className="flex flex-wrap items-center gap-1">
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
                className="input-field h-8 w-16 rounded-md border border-line bg-base px-2 font-mono text-[12px] text-ink"
                aria-label="Custom risk percent"
              />
            )}
          </div>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
          Commission
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={cfg.commissionRate * 100}
            onChange={(e) => setCfg({ ...cfg, commissionRate: Math.max(0, Number(e.target.value) || 0) / 100 })}
            className="input-field h-7 w-16 rounded-md border border-line bg-base px-2 font-mono text-[11px] text-ink"
            aria-label="Commission percent"
          />
          <span>% per fill</span>
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onSkip} icon={<WalletCards className="h-3.5 w-3.5" />}>
            Watch only
          </Button>
          <Button type="button" variant="solid" size="sm" onClick={() => onStart(cfg)}>
            Start practice
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
