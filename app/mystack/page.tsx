'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, ArrowDown, Info, RotateCcw, ChevronRight, Lightbulb, Check, ShieldCheck, BarChart3, ArrowLeft } from 'lucide-react';
import { analyzeTrade, type TradeSide, type TradeInput } from '@/lib/tradeAnalysis';
import { executeOrder, setPositionOverlay } from '@/lib/paperStore';

const SYMBOL = 'BTCUSDT';
const QUICK_RISK = [0.25, 0.5, 1, 2, 3];

// ---- formatting helpers ----
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const pct = (n: number, d = 2) => `${Number.isFinite(n) ? n.toFixed(d) : '—'}%`;

export default function MyStackPage() {
  const [side, setSide] = useState<TradeSide>('long');
  const [entry, setEntry] = useState('62713.7');
  const [stopLoss, setStopLoss] = useState('62100');
  const [takeProfit, setTakeProfit] = useState('64600');
  const [balance, setBalance] = useState('10000');
  const [riskPct, setRiskPct] = useState('1');
  const [leverage, setLeverage] = useState('10');
  const [placed, setPlaced] = useState<string | null>(null);

  const input: TradeInput = useMemo(
    () => ({
      balance: Number(balance) || 0,
      riskPct: Number(riskPct) || 0,
      entry: Number(entry) || 0,
      stopLoss: stopLoss.trim() === '' ? null : Number(stopLoss),
      takeProfit: takeProfit.trim() === '' ? null : Number(takeProfit),
      leverage: Number(leverage) || 1,
      side,
    }),
    [balance, riskPct, entry, stopLoss, takeProfit, leverage, side],
  );

  const a = useMemo(() => analyzeTrade(input), [input]);

  const reset = () => {
    setSide('long');
    setEntry('62713.7');
    setStopLoss('62100');
    setTakeProfit('64600');
    setBalance('10000');
    setRiskPct('1');
    setLeverage('10');
    setPlaced(null);
  };

  const placeOrder = () => {
    if (!(a.positionSize > 0) || !(input.entry > 0)) return;
    executeOrder({
      type: side === 'long' ? 'BUY' : 'SELL',
      size: Number(a.positionSize.toFixed(4)),
      orderType: 'MARKET',
      symbol: SYMBOL,
      midPrice: input.entry,
      leverage: input.leverage,
    });
    if (input.takeProfit != null) setPositionOverlay('tp', input.takeProfit, SYMBOL);
    if (input.stopLoss != null) setPositionOverlay('sl', input.stopLoss, SYMBOL);
    setPlaced(`${side === 'long' ? 'Long' : 'Short'} ${a.positionSize.toFixed(4)} ${SYMBOL} placed on your paper account.`);
  };

  const long = side === 'long';

  return (
    <div className="min-h-[100dvh] w-full bg-base text-ink">
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        {/* ---- Top bar ---- */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Chart
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">MyStack</h1>
            <span className="rounded-md border border-line bg-surface-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Paper · Educational
            </span>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2 text-base font-semibold">
              {SYMBOL}
              <span className="h-2 w-2 rounded-full bg-bull" />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-faint">Perpetual</div>
          </div>
        </div>

        {/* ---- Main grid ---- */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
          {/* ===== LEFT COLUMN ===== */}
          <div className="space-y-4">
            {/* Order type / qty / side */}
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <Labeled label="Order Type">
                  <div className="flex h-11 items-center rounded-lg border border-line bg-base px-3 text-sm text-ink">
                    Market
                  </div>
                </Labeled>
                <Labeled label="Position Size (calc)">
                  <div className="flex h-11 items-center justify-between rounded-lg border border-line bg-base px-3">
                    <span className="font-mono tabular-nums text-ink">{a.positionSize > 0 ? a.positionSize.toFixed(4) : '—'}</span>
                    <span className="text-xs text-ink-faint">BTC</span>
                  </div>
                </Labeled>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSide('long')}
                  className={[
                    'focus-ring flex items-center justify-center gap-2 rounded-lg py-3 text-base font-bold transition',
                    long ? 'bg-[#089981] text-white shadow-sm' : 'border border-line bg-surface-1 text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  <ArrowUp className="h-4 w-4" /> Buy / Long
                </button>
                <button
                  onClick={() => setSide('short')}
                  className={[
                    'focus-ring flex items-center justify-center gap-2 rounded-lg py-3 text-base font-bold transition',
                    !long ? 'bg-[#f23645] text-white shadow-sm' : 'border border-line bg-surface-1 text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  <ArrowDown className="h-4 w-4" /> Sell / Short
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-ink-faint">≈ Entry {num(input.entry)} USDT</p>
            </Card>

            {/* 1. Entry & Exit */}
            <Card>
              <SectionTitle n={1}>Entry &amp; Exit</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Entry Price" suffix="USDT" value={entry} onChange={setEntry} />
                <NumField label="Stop Loss" suffix="USDT" value={stopLoss} onChange={setStopLoss} tone="bear" />
                <NumField label="Take Profit" suffix="USDT" value={takeProfit} onChange={setTakeProfit} tone="bull" />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <MiniStat label="Distance" value={`${num(a.slDistance)} USDT`} sub={pct(a.slDistancePct)} tone="bear" />
                <ChevronRight className="h-5 w-5 text-ink-faint" />
                <MiniStat label="Reward" value={`${num(a.reward)} USDT`} sub={pct(a.rewardPct)} tone="bull" />
              </div>
            </Card>

            {/* 2. Risk management */}
            <Card>
              <SectionTitle n={2} hint="Set how much you're willing to risk on this trade.">Risk Management</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Account Balance" prefix="$" value={balance} onChange={setBalance} />
                <Labeled label="Risk Per Trade">
                  <div className="flex h-11 items-center rounded-lg border border-line bg-base px-3">
                    <input
                      type="number" min={0} step="any" value={riskPct}
                      onChange={(e) => setRiskPct(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-right font-mono tabular-nums text-ink outline-none"
                    />
                    <span className="pl-1 text-xs text-ink-faint">%</span>
                  </div>
                </Labeled>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-base px-3 py-2">
                <span className="text-sm text-ink-faint">Risk Amount</span>
                <span className="font-mono text-base font-semibold text-bull-bright">{usd(a.riskAmount)}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-ink-faint">Quick Select</span>
                <div className="flex flex-1 gap-1.5">
                  {QUICK_RISK.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRiskPct(String(r))}
                      className={[
                        'focus-ring flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition',
                        Number(riskPct) === r ? 'border-accent text-accent' : 'border-line text-ink-muted hover:text-ink',
                      ].join(' ')}
                    >
                      {r}%
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* 3. Position size */}
            <Card>
              <SectionTitle n={3} hint="(Calculated)">Position Size</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-base px-3 py-2.5">
                  <div className="text-xs text-ink-faint">Position Size</div>
                  <div className="font-mono text-xl font-semibold text-ink">{a.positionSize > 0 ? a.positionSize.toFixed(4) : '—'} <span className="text-sm text-ink-faint">BTC</span></div>
                  <div className="text-xs text-ink-faint">≈ {usd(a.positionValue)}</div>
                </div>
                <div className="rounded-lg border border-line bg-base px-3 py-2.5">
                  <Row label="Position Value" value={usd(a.positionValue)} />
                  <Row label="% of Account" value={pct(a.pctOfAccount)} />
                </div>
              </div>
              <ExposureBar level={a.exposure.level} ratio={a.exposure.ratio} />
            </Card>

            {/* 4. Leverage & margin */}
            <Card>
              <SectionTitle n={4}>Leverage &amp; Margin</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Labeled label="Leverage">
                  <div className="flex h-11 items-center rounded-lg border border-line bg-base px-3">
                    <input
                      type="number" min={1} step={1} value={leverage}
                      onChange={(e) => setLeverage(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent font-mono tabular-nums text-ink outline-none"
                    />
                    <span className="pl-1 text-xs text-ink-faint">x</span>
                  </div>
                </Labeled>
                <MiniStat label="Margin Required" value={usd(a.marginRequired)} />
                <MiniStat label="Liquidation" value={`${num(a.liquidationPrice)}`} sub={`${pct(a.liqDistancePct)} away`} tone="bear" />
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-surface-1/60 px-3 py-2 text-xs text-ink-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <span>Your liquidation price is <span className="font-semibold text-ink">{pct(a.liqDistancePct)}</span> away from entry. Keep enough margin to avoid liquidation.</span>
              </div>
            </Card>
          </div>

          {/* ===== RIGHT COLUMN ===== */}
          <div className="space-y-4">
            {/* Trade risk summary */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold tracking-wide text-accent">TRADE RISK SUMMARY</h3>
              <div className="space-y-2 text-sm">
                <Row label="Account Balance" value={usd(input.balance)} />
                <Row label="Risk Amount" value={usd(a.riskAmount)} tone="bear" />
                <Row label="Position Size" value={`${a.positionSize > 0 ? a.positionSize.toFixed(4) : '—'} BTC`} />
                <Row label="Position Value" value={usd(a.positionValue)} />
                <Row label="Potential Loss (SL)" value={usd(a.potentialLoss)} tone="bear" />
                <Row label="Potential Profit (TP)" value={usd(a.potentialProfit)} tone="bull" />
                <div className="my-2 h-px bg-line" />
                <Row label="Risk / Reward" value={a.rr == null ? '—' : `1 : ${a.rr.toFixed(2)}`} tone={a.rr != null && a.rr >= 2 ? 'bull' : undefined} />
                <Row label="Break-even Win Rate" value={a.breakEvenWinRate == null ? '—' : pct(a.breakEvenWinRate * 100)} />
                {a.breakEvenWinRate != null && (
                  <p className="text-xs text-ink-faint">You only need to win {pct(a.breakEvenWinRate * 100)} of trades to break even.</p>
                )}
              </div>
            </Card>

            {/* Risk meter */}
            <Card>
              <h3 className="mb-2 text-sm font-semibold tracking-wide text-accent">RISK METER</h3>
              <Gauge zone={a.riskZone} />
              <p className="mt-2 text-center text-xs text-ink-muted">
                You're risking {pct(input.riskPct)} of your account.
              </p>
            </Card>

            {/* What if SL hits */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold tracking-wide text-accent">IF STOP LOSS HITS</h3>
              <div className="space-y-2 text-sm">
                <Row label="Account Before" value={usd(a.whatIfStopLoss.before)} />
                <Row label="Loss" value={`-${usd(a.whatIfStopLoss.loss)}`} tone="bear" />
                <div className="my-1 h-px bg-line" />
                <Row label="Account After" value={usd(a.whatIfStopLoss.after)} />
                <Row label="Change" value={pct(a.whatIfStopLoss.changePct)} tone="bear" />
              </div>
            </Card>
          </div>
        </div>

        {/* ===== BOTTOM ROW ===== */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Health score */}
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-accent"><BarChart3 className="h-4 w-4" /> TRADE HEALTH SCORE</h3>
            <div className="flex items-center gap-4">
              <ScoreRing score={a.health.score} />
              <div>
                <div className="text-lg font-bold text-ink">{a.health.rating}</div>
                <div className="text-xs text-ink-faint">Composite of your risk checklist.</div>
              </div>
            </div>
          </Card>

          {/* Checklist */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-accent">TRADE CHECKLIST</h3>
            <ul className="space-y-1.5">
              {a.health.checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  <span className={['flex h-4 w-4 items-center justify-center rounded-full', c.pass ? 'bg-bull/20 text-bull-bright' : 'bg-bear/20 text-bear-bright'].join(' ')}>
                    {c.pass ? <Check className="h-3 w-3" /> : '✕'}
                  </span>
                  <span className={c.pass ? 'text-ink-muted' : 'text-ink'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Tips */}
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-accent"><Lightbulb className="h-4 w-4" /> EDUCATIONAL TIPS</h3>
            <ul className="space-y-2">
              {a.health.tips.map((t, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                  <span className="text-accent">•</span> {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row">
          {placed && (
            <div className="flex-1 rounded-lg border border-bull/30 bg-bull/10 px-3 py-2 text-sm text-bull-bright">{placed}</div>
          )}
          <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
            <button onClick={reset} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-4 py-2.5 text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
            <button
              onClick={placeOrder}
              disabled={!(a.positionSize > 0)}
              className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 sm:flex-none"
            >
              Review &amp; Place Order <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint">
          <Info className="h-3 w-3" /> Educational paper trading. Not financial advice. Trade responsibly.
        </p>
      </div>
    </div>
  );
}

// ---- presentational helpers ----

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-surface-1 p-4">{children}</div>;
}

function SectionTitle({ n, hint, children }: { n: number; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">{n}</span>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">{children}</h3>
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-ink-faint">{label}</div>
      {children}
    </label>
  );
}

function NumField({
  label, value, onChange, prefix, suffix, tone,
}: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; tone?: 'bull' | 'bear';
}) {
  const toneClass = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return (
    <Labeled label={label}>
      <div className="flex h-11 items-center rounded-lg border border-line bg-base px-3">
        {prefix && <span className="pr-1 text-xs text-ink-faint">{prefix}</span>}
        <input
          type="number" min={0} step="any" value={value}
          onChange={(e) => onChange(e.target.value)}
          className={['min-w-0 flex-1 bg-transparent text-right font-mono tabular-nums outline-none', toneClass].join(' ')}
        />
        {suffix && <span className="pl-1 text-xs text-ink-faint">{suffix}</span>}
      </div>
    </Labeled>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bull' | 'bear' }) {
  const toneClass = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-base px-3 py-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={['font-mono text-sm font-semibold tabular-nums', toneClass].join(' ')}>{value}</div>
      {sub && <div className="text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  const toneClass = tone === 'bull' ? 'text-bull-bright' : tone === 'bear' ? 'text-bear-bright' : 'text-ink';
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-faint">{label}</span>
      <span className={['font-mono tabular-nums', toneClass].join(' ')}>{value}</span>
    </div>
  );
}

function ExposureBar({ level, ratio }: { level: 'low' | 'moderate' | 'high'; ratio: number }) {
  const fill = Math.max(4, Math.min(100, ratio * 33)); // ~3× = full
  const label = level === 'low' ? 'Low' : level === 'moderate' ? 'Moderate' : 'High';
  const labelColor = level === 'low' ? 'text-bull-bright' : level === 'moderate' ? 'text-regime-hot' : 'text-bear-bright';
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="text-xs text-ink-faint">Exposure</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-gradient-to-r from-bull via-regime-hot to-bear" style={{ width: `${fill}%` }} />
      </div>
      <span className={['text-xs font-semibold', labelColor].join(' ')}>{label}</span>
    </div>
  );
}

function Gauge({ zone }: { zone: 'low' | 'moderate' | 'high' }) {
  // Needle angle: low → left, high → right (−90°..+90° across the semicircle).
  const angle = zone === 'low' ? -55 : zone === 'moderate' ? 0 : 55;
  const label = zone === 'low' ? 'LOW RISK' : zone === 'moderate' ? 'MODERATE RISK' : 'HIGH RISK';
  const labelColor = zone === 'low' ? 'text-bull-bright' : zone === 'moderate' ? 'text-regime-hot' : 'text-bear-bright';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-44">
        <path d="M10 100 A 90 90 0 0 1 190 100" fill="none" stroke="#2a3247" strokeWidth="14" strokeLinecap="round" />
        <path d="M10 100 A 90 90 0 0 1 100 10" fill="none" stroke="#26A69A" strokeWidth="14" strokeLinecap="round" />
        <path d="M100 10 A 90 90 0 0 1 150 24" fill="none" stroke="#f0a020" strokeWidth="14" />
        <path d="M150 24 A 90 90 0 0 1 190 100" fill="none" stroke="#f23645" strokeWidth="14" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="32" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="6" fill="#e9eef7" />
        </g>
      </svg>
      <div className={['-mt-1 text-base font-bold', labelColor].join(' ')}>{label}</div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const color = score >= 85 ? '#26A69A' : score >= 70 ? '#9acd32' : score >= 50 ? '#f0a020' : '#f23645';
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#2a3247" strokeWidth="8" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-ink">{score}</span>
        <span className="text-[9px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}
