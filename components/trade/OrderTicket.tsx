'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { usePaperStore } from '@/lib/paperStore';
import type { PlaceChartOrder, TradingCommandResult } from '@/lib/chartTradingCommands';
import { feedbackForTradingCommand, shouldDismissTradingControl } from '@/lib/tradeCommandFeedback';
import { Tabs, Tab } from '@/components/ui';
import {
  BTC_TICK_SIZE,
  BTC_TICK_VALUE_USD,
  marginFor,
  notionalFor,
  type Side,
} from '@/lib/paper';

interface OrderTicketProps {
  symbol: string;
  midPrice: number;
  leverage: number;
  onLeverageChange: (n: number) => void;
  reduceAvailable: number;
  initialSide?: 'buy' | 'sell';
  active?: boolean;
  /** Called after an order is placed immediately — the modal host
   *  (OrderModal) wires this to its own onClose so the ticket card
   *  closes once the order has been sent to the store. */
  onPlaced?: () => void;
  /** Mode-aware chart command boundary. The ticket never chooses an account. */
  onSubmitOrder: (input: PlaceChartOrder) => TradingCommandResult;
}

/** Tick-offset choices for the Exits (TP/SL) dropdowns, matching the
 *  TV ticket's "75 ticks" / "25 ticks" style selectors. */
// TP/SL default offsets are a PERCENTAGE of entry, not a fixed tick count.
// A fixed tick offset ($0.10/tick) is far too granular for a $60k asset — even
// the largest old option (150 ticks = $15) stacked TP/SL on top of the entry
// line, so they couldn't be told apart or dragged. Percent scales with price.
const PCT_OPTIONS = [0.25, 0.5, 1, 2, 3] as const;

type Tab = 'market' | 'limit' | 'stop';

const TABS: { id: Tab; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

export default function OrderTicket(p: OrderTicketProps) {
  const { lastError, balance } = usePaperStore();
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [tab, setTab] = useState<Tab>('market');
  const [side, setSide] = useState<Side>(p.initialSide ?? 'buy');
  const [units, setUnits] = useState<string>('0.10');
  const [price, setPrice] = useState<string>(p.midPrice.toFixed(1));
  // TP/SL on by default (TradingView-style). The actual price falls
  // back to the suggested defaults (suggestTp / suggestSl) when the
  // user hasn't typed an explicit value.
  const [tpEnabled, setTpEnabled] = useState(true);
  const [slEnabled, setSlEnabled] = useState(true);
  const [tp, setTp] = useState<string>('');
  const [sl, setSl] = useState<string>('');
  // Tick-offset dropdowns (TV: "75 ticks" / "25 ticks") — drive the
  // seeded TP/SL price when the toggle turns on or the offset changes.
  const [tpPct, setTpPct] = useState<number>(1);   // +1% default TP
  const [slPct, setSlPct] = useState<number>(0.5); // -0.5% default SL
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const [riskPct, setRiskPct] = useState('');
  const [ocoEnabled, setOcoEnabled] = useState(false);
  const ocoGroupRef = useRef<string | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  // Re-sync the side toggle when the modal reopens with a different
  // clicked side (e.g. SELL pill after a prior BUY-prefilled ticket).
  useEffect(() => {
    if (!p.initialSide) return;
    setSide(p.initialSide);
    // Intentionally keyed on initialSide only: this must fire when the
    // ticket reopens with a different pill, not on every local-state
    // change (e.g. the in-ticket side toggle).
  }, [p.initialSide]);

  const autoPrice = priceTouched ? null : p.midPrice.toFixed(1);
  const effectivePrice = priceTouched ? price : (autoPrice ?? price);

  const unitsN = Number(units) || 0;
  const priceN = Number(effectivePrice) || 0;
  const fillPrice =
    tab === 'market' ? p.midPrice + (side === 'buy' ? BTC_TICK_SIZE : -BTC_TICK_SIZE) : priceN;

  // Seed rule (TV parity): TP/SL offset from the ENTRY line, not the
  // synthetic bid/ask fill. For market the entry pins to mid; for
  // limit/stop the entry is the working price. Using fillPrice here would
  // add the ±1 slippage tick and drift the seed off the locked formula.
  const entryBase = tab === 'market' ? p.midPrice : priceN;

  // Seed rule: TP = entry ± pct%, + for buy, mirrored (−) for sell; SL is the
  // opposite sign. Percentage keeps the two exit lines visibly separated from
  // the entry line (and each other) at any price, so they can be grabbed and
  // dragged independently.
  const suggestTp = useMemo(() => {
    if (unitsN <= 0 || !Number.isFinite(entryBase) || entryBase <= 0) return null;
    const dir = side === 'buy' ? 1 : -1;
    return Number((entryBase * (1 + dir * tpPct / 100)).toFixed(1));
  }, [side, entryBase, unitsN, tpPct]);
  const suggestSl = useMemo(() => {
    if (unitsN <= 0 || !Number.isFinite(entryBase) || entryBase <= 0) return null;
    const dir = side === 'buy' ? -1 : 1;
    return Number((entryBase * (1 + dir * slPct / 100)).toFixed(1));
  }, [side, entryBase, unitsN, slPct]);

  // Resolve TP/SL: explicit user value > suggested default.
  const resolveLevel = (
    enabled: boolean,
    typed: string,
    suggested: number | null,
  ): number | null => {
    if (!enabled) return null;
    const n = Number(typed);
    if (n > 0) return n;
    return suggested != null && suggested > 0 ? suggested : null;
  };

  // Risk-based units: auto-compute from risk % and SL distance.
  const resolvedSl = resolveLevel(slEnabled, sl, suggestSl);
  const riskUnits = useMemo(() => {
    const rp = Number(riskPct);
    if (!rp || rp <= 0 || rp > 100) return null;
    if (!resolvedSl || !Number.isFinite(fillPrice) || fillPrice <= 0) return null;
    const riskPerUnit = Math.abs(fillPrice - resolvedSl);
    if (riskPerUnit <= 0) return null;
    const riskAmount = balance * (rp / 100);
    return riskAmount / riskPerUnit;
  }, [riskPct, resolvedSl, fillPrice, balance]);

  const canSubmit =
    (riskUnits ?? unitsN) > 0 && (tab === 'market' || priceN > 0) && Number.isFinite(fillPrice) && fillPrice > 0;

  const effectiveUnits = riskUnits ?? unitsN;
  const margin = useMemo(
    () => marginFor(effectiveUnits, fillPrice, p.leverage),
    [effectiveUnits, fillPrice, p.leverage],
  );
  const notional = useMemo(() => notionalFor(effectiveUnits, fillPrice), [effectiveUnits, fillPrice]);

  const displayUnits = riskUnits != null ? riskUnits.toFixed(4) : units;

  const displayedTp = resolveLevel(tpEnabled, tp, suggestTp);
  const displayedSl = resolveLevel(slEnabled, sl, suggestSl);
  const displayedPrice = priceN;
  const effectiveTpEnabled = displayedTp != null;
  const effectiveSlEnabled = displayedSl != null;

  const handleUnitsChange = (v: string) => {
    setUnits(v);
    setRiskPct('');
  };
  const handleRiskPctChange = (v: string) => {
    setRiskPct(v);
  };
  const handlePriceChange = (v: string) => {
    setPriceTouched(true);
    setPrice(v);
  };
  const handleTpChange = (v: string) => {
    setTp(v);
  };
  const handleSlChange = (v: string) => {
    setSl(v);
  };
  // Changing the percent-offset dropdown re-seeds the exit price off the entry.
  const handleTpPctChange = (pct: number) => {
    setTpPct(pct);
    if (!tpEnabled || !Number.isFinite(entryBase) || entryBase <= 0) return;
    const dir = side === 'buy' ? 1 : -1;
    handleTpChange((entryBase * (1 + dir * pct / 100)).toFixed(1));
  };
  const handleSlPctChange = (pct: number) => {
    setSlPct(pct);
    if (!slEnabled || !Number.isFinite(entryBase) || entryBase <= 0) return;
    const dir = side === 'buy' ? -1 : 1;
    handleSlChange((entryBase * (1 + dir * pct / 100)).toFixed(1));
  };
  const handleReduceOnlyChange = (v: boolean) => {
    setReduceOnly(v);
  };
  const handlePostOnlyChange = (v: boolean) => {
    setPostOnly(v);
  };
  const handleSideChange = (s: Side) => {
    setSide(s);
  };
  const handleTabChange = (t: Tab) => {
    setTab(t);
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      setCommandError('Enter a valid order size and price before submitting.');
      return;
    }
    if (submittingRef.current) {
      setCommandError('Duplicate or in-flight trading command was ignored');
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = p.onSubmitOrder({
        symbol: p.symbol,
        side,
        type: tab,
        units: effectiveUnits,
        price: tab === 'market' ? null : priceN,
        tp: resolveLevel(tpEnabled, tp, suggestTp),
        sl: resolveLevel(slEnabled, sl, suggestSl),
        reduceOnly,
        postOnly,
        leverage: p.leverage,
        midPrice: p.midPrice,
        ocoGroup: ocoEnabled ? (ocoGroupRef.current ?? (ocoGroupRef.current = `oco_${crypto.randomUUID().slice(0, 10)}`)) : null,
      });
      if (shouldDismissTradingControl(res)) {
        setCommandError(null);
        p.onPlaced?.();
      } else {
        setCommandError(feedbackForTradingCommand(res).message);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Keyboard trading: B/S flips side, Enter submits.
  // We DO listen for B/S even when an input is focused — these are
  // common single-letter keys that are unlikely to clash with normal
  // typing. We only intercept B/S outside of inputs; for arrow keys
  // we DO handle them inside number inputs as a step shortcut.
  useEffect(() => {
    if (p.active === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const k = e.key;
      // B / S — flip side. These letters are unlikely to be typed
      // meaningfully into a numeric field, but we still skip when
      // an input is focused so a stray "b" doesn't ruin a value.
      if (!inField) {
        if (k === 'b' || k === 'B') {
          handleSideChange('buy');
          e.preventDefault();
          return;
        }
        if (k === 's' || k === 'S') {
          handleSideChange('sell');
          e.preventDefault();
          return;
        }
      }
      // Enter — submit. Only when nothing is focused (a focused
      // <button> would also trigger, and an input's Enter should
      // pass through for IME commit etc.).
      if (k === 'Enter' && !inField) {
        if (!e.repeat && canSubmit && !submittingRef.current) {
          handleSubmit();
          e.preventDefault();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // We intentionally re-bind on canSubmit so the closure sees the latest
  // value. The handlers are stable enough. Gated on p.active so the
  // listener is only attached while the modal is open — otherwise these
  // hotkeys (incl. Enter-to-market-order) would be live app-wide even
  // with the ticket hidden behind a permanently-mounted modal. Escape is
  // left unhandled here — the Modal primitive already closes on Escape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.active, canSubmit]);

  // Arrow-key nudges inside the price + units fields. We use a
  // capture-phase listener on the inputs themselves so the default
  // caret-jump is suppressed.
  const unitsInputRef = useRef<HTMLInputElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const stepField = (
      e: KeyboardEvent,
      ref: HTMLInputElement | null,
      step: number,
      isInt: boolean,
    ) => {
      if (!ref) return;
      if (e.target !== ref) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = Number(ref.value) || 0;
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const next = cur + dir * step;
      const formatted = isInt ? String(Math.round(next)) : next.toFixed(step < 1 ? 2 : 0);
      ref.value = formatted;
      // Fire the React change so the value flows through state.
      ref.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const onKey = (e: KeyboardEvent) => {
      stepField(e, unitsInputRef.current, 0.01, false);
      stepField(e, priceInputRef.current, 0.1, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-2.5">
        <Tabs
          value={tab}
          onChange={(v) => handleTabChange(v as Tab)}
          className="w-full"
          aria-label="Order type"
        >
          {TABS.map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}
        </Tabs>

        <SideToggle
          value={side}
          onChange={handleSideChange}
          bid={p.midPrice - BTC_TICK_SIZE}
          ask={p.midPrice + BTC_TICK_SIZE}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Units (BTC)"
            value={displayUnits}
            onChange={handleUnitsChange}
            step={0.01}
            suffix="BTC"
            inputRef={unitsInputRef}
            readOnly={riskUnits != null}
          />
          <RiskField
            value={riskPct}
            onChange={handleRiskPctChange}
            balance={balance}
            computedUnits={riskUnits}
          />
        </div>

        <div
          key={tab}
          className="animate-[fade-in_180ms_ease-out]"
          aria-hidden={tab === 'market'}
          style={tab === 'market' ? { display: 'none' } : undefined}
        >
          <NumberField
            label={tab === 'limit' ? 'Limit price' : 'Stop price'}
            value={effectivePrice}
            onChange={handlePriceChange}
            step={0.1}
            suffix="USD"
            inputRef={priceInputRef}
            quickTicks={[
              { label: 'Bid', value: (p.midPrice - BTC_TICK_SIZE).toFixed(1) },
              { label: 'Mid', value: p.midPrice.toFixed(1) },
              { label: 'Ask', value: (p.midPrice + BTC_TICK_SIZE).toFixed(1) },
            ]}
            onPick={(v) => handlePriceChange(v.toFixed(1))}
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
          <div className="flex divide-x divide-line text-xs">
            <ToggleChip
              label="TP"
              enabled={effectiveTpEnabled}
              onToggle={() => {
                const next = !effectiveTpEnabled;
                if (next && suggestTp != null && !tp) setTp(suggestTp.toFixed(1));
                setTpEnabled(next);
                if (!next) setTp('');
              }}
            />
            <ToggleChip
              label="SL"
              enabled={effectiveSlEnabled}
              onToggle={() => {
                const next = !effectiveSlEnabled;
                if (next && suggestSl != null && !sl) setSl(suggestSl.toFixed(1));
                setSlEnabled(next);
                if (!next) setSl('');
              }}
            />
          </div>
          {(effectiveTpEnabled || effectiveSlEnabled) && (
            <div
              className={[
                'grid gap-2 border-t border-line p-2',
                effectiveTpEnabled && effectiveSlEnabled ? 'grid-cols-2' : 'grid-cols-1',
              ].join(' ')}
            >
              {effectiveTpEnabled && (
                <NumberField
                  label="Take profit"
                  labelRight={<PctSelect value={tpPct} onChange={handleTpPctChange} />}
                  value={tp}
                  onChange={handleTpChange}
                  step={0.1}
                  suffix="USD"
                />
              )}
              {effectiveSlEnabled && (
                <NumberField
                  label="Stop loss"
                  labelRight={<PctSelect value={slPct} onChange={handleSlPctChange} />}
                  value={sl}
                  onChange={handleSlChange}
                  step={0.1}
                  suffix="USD"
                />
              )}
            </div>
          )}
        </div>

        {tab !== 'market' && (
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs">
            <span className="text-ink-muted">OCO group (cancel other on fill)</span>
            <input
              type="checkbox"
              checked={ocoEnabled}
              onChange={(e) => {
                setOcoEnabled(e.target.checked);
                if (!e.target.checked) ocoGroupRef.current = null;
              }}
              className="h-3.5 w-3.5 accent-accent"
            />
          </label>
        )}

        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          className="rounded-lg border border-line bg-surface-2 text-xs"
        >
          <summary className="cursor-pointer select-none px-3 py-1.5 text-ink-muted">
            <span className="font-medium text-ink-muted">More</span>
            <span className="ml-2 text-ink-faint">reduce-only · post-only</span>
          </summary>
          <div className="space-y-1.5 px-3 py-2">
            <label className="flex items-center justify-between gap-2">
              <span className="text-ink-muted">Reduce-only</span>
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => handleReduceOnlyChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-ink-muted">Post-only</span>
              <input
                type="checkbox"
                checked={postOnly}
                onChange={(e) => handlePostOnlyChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
            </label>
          </div>
        </details>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px]">
          <MarginRow margin={margin} balance={balance} />
          <Row label="Leverage" value={`${p.leverage}:1`} />
          <Row label="Tick value" value={BTC_TICK_VALUE_USD.toFixed(2)} unit="USD" />
          <Row label="Trade value" value={fmt(notional, 2)} unit="USD" />
          <Row
            label="Est. fill"
            value={fmt(fillPrice, 1)}
            unit="USD"
            tone={canSubmit ? 'neutral' : 'muted'}
          />
          <Row label="Reduce avail." value={fmt(p.reduceAvailable, 4)} unit="BTC" />
        </dl>

        {(commandError ?? lastError) && (
          <p className="rounded-md border border-bear/30 bg-bear/10 px-2 py-1 text-xs text-bear-bright">
            {commandError ?? lastError}
          </p>
        )}

        {tab === 'market' ? (
          <button
            ref={ctaRef}
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className={[
              'focus-ring relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-200',
              side === 'buy'
                ? 'bg-gradient-to-b from-bull-bright to-bull-dim text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_rgba(0,0,0,0.4),0_8px_24px_rgba(40,185,161,0.2)] border border-bull/70 hover:brightness-105 active:scale-95'
                : 'bg-gradient-to-b from-bear-bright to-bear-dim text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_0_rgba(0,0,0,0.4),0_8px_24px_rgba(242,54,69,0.22)] border border-bear/70 hover:brightness-105 active:scale-95',
              (!canSubmit || isSubmitting) ? 'cursor-not-allowed opacity-50 grayscale' : '',
            ].join(' ')}
            aria-label={`${side === 'buy' ? 'Buy' : 'Sell'} ${effectiveUnits} ${p.symbol} at market`}
          >
            {side === 'buy' ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span>
              {side === 'buy' ? 'Buy' : 'Sell'} {effectiveUnits.toFixed(4)} {p.symbol}
            </span>
            <span className="text-xs font-normal uppercase tracking-wide opacity-80">market</span>
            <kbd className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-current/30 px-1 text-[10px] font-medium opacity-70">
              ⏎
            </kbd>
          </button>
        ) : (
          <button
            ref={ctaRef}
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className={[
              'focus-ring relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-3 py-3 text-sm font-semibold transition-all duration-200',
              side === 'buy'
                ? 'bg-gradient-to-b from-bull-bright to-bull-dim text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_rgba(0,0,0,0.4),0_8px_24px_rgba(40,185,161,0.2)] border border-bull/70 hover:brightness-105 active:scale-95'
                : 'bg-gradient-to-b from-bear-bright to-bear-dim text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_0_rgba(0,0,0,0.4),0_8px_24px_rgba(242,54,69,0.22)] border border-bear/70 hover:brightness-105 active:scale-95',
              (!canSubmit || isSubmitting) ? 'cursor-not-allowed opacity-50 grayscale' : '',
            ].join(' ')}
            aria-label={`${side === 'buy' ? 'Buy' : 'Sell'} ${effectiveUnits} ${p.symbol} at ${tab} ${priceN}`}
          >
            <span>
              {side === 'buy' ? 'Buy' : 'Sell'} {effectiveUnits.toFixed(4)} {p.symbol} @ {priceN > 0 ? priceN : '—'}
            </span>
            <span className="text-xs font-normal uppercase tracking-wide opacity-80">{tab}</span>
          </button>
        )}

        <p className="flex items-center gap-1.5 text-[10px] text-ink-faint">
          <ShieldCheck className="h-3 w-3" />
          Paper — fills simulated against live bars; nothing is sent to any exchange.
        </p>
    </div>
  );
}

function fmt(n: number, dp: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function SideToggle({
  value,
  onChange,
  bid,
  ask,
}: {
  value: Side;
  onChange: (s: Side) => void;
  bid: number;
  ask: number;
}) {
  const idx = value === 'buy' ? 0 : 1;
  return (
    <div className="relative grid grid-cols-2 rounded-lg border border-line bg-surface-2 p-1 text-xs">
      <span
        aria-hidden
        className={[
          'absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-md transition-transform',
          value === 'buy'
            ? 'bg-gradient-to-b from-bull-bright to-bull-dim shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_var(--bull)]'
            : 'bg-gradient-to-b from-bear-bright to-bear-dim shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_var(--bear)]',
        ].join(' ')}
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
      {/* Spread badge — bridges the Sell/Buy split, TV-style
          "Sell 61,965.99 | 0.01 | Buy 61,966.00". */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[9px] text-ink-faint"
      >
        {fmt(ask - bid, 2)}
      </span>
      <button
        type="button"
        onClick={() => onChange('buy')}
        aria-pressed={value === 'buy'}
        className={[
          'focus-ring relative z-10 inline-flex flex-col items-center justify-center gap-1 rounded-md py-1.5 font-semibold transition',
          value === 'buy' ? 'text-ink' : 'text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>Buy</span>
        </div>
        <span className="text-[10px] font-mono font-normal opacity-80">
          {fmt(ask, 1)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange('sell')}
        aria-pressed={value === 'sell'}
        className={[
          'focus-ring relative z-10 inline-flex flex-col items-center justify-center gap-1 rounded-md py-1.5 font-semibold transition',
          value === 'sell' ? 'text-ink' : 'text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <div className="flex items-center gap-1.5">
          <TrendingDown className="h-3.5 w-3.5" />
          <span>Sell</span>
        </div>
        <span className="text-[10px] font-mono font-normal opacity-80">
          {fmt(bid, 1)}
        </span>
      </button>
    </div>
  );
}

function NumberField({
  label,
  labelRight,
  value,
  onChange,
  step,
  suffix,
  className = '',
  quickTicks,
  onPick,
  inputRef,
  readOnly = false,
}: {
  label: string;
  labelRight?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  step: number;
  suffix?: string;
  className?: string;
  quickTicks?: { label: string; value: string }[];
  onPick?: (v: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
}) {
  return (
    <label className={['block', className].join(' ')}>
      <span className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        <span>{label}</span>
        {labelRight}
      </span>
      <div className={[
        'relative flex items-center rounded-md border border-line bg-base transition focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/40',
        readOnly ? 'opacity-75' : '',
      ].join(' ')}>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent px-2.5 py-1.5 pr-12 text-sm font-mono text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 text-xs text-ink-faint">
            {suffix}
          </span>
        )}
      </div>
      {quickTicks && quickTicks.length > 0 && (
        <div className="mt-1 flex gap-1 text-[10px]">
          {quickTicks.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onPick?.(Number(q.value))}
              className="focus-ring rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-ink-muted transition hover:border-accent/40 hover:text-ink"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function RiskField({
  value,
  onChange,
  balance,
  computedUnits,
}: {
  value: string;
  onChange: (v: string) => void;
  balance: number;
  computedUnits: number | null;
}) {
  const riskAmount = value ? balance * (Number(value) / 100) : 0;
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider">
        <span className="text-ink-faint">Risk %</span>
        {computedUnits != null && (
          <span className="font-mono text-ink-muted">
            {computedUnits.toFixed(4)} BTC
          </span>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="relative flex flex-1 items-center rounded-md border border-line bg-base transition focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/40">
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0}
            max={100}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            className="w-full bg-transparent px-2.5 py-1.5 pr-10 text-sm font-mono text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute right-2.5 text-xs text-ink-faint">%</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          ≈${riskAmount.toFixed(0)}
        </span>
      </div>
    </label>
  );
}

function PctSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Offset percent"
      className="focus-ring rounded border border-line bg-base px-1 py-0.5 text-[10px] font-mono normal-case tracking-normal text-ink-muted"
    >
      {PCT_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}%
        </option>
      ))}
    </select>
  );
}

function ToggleChip({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={[
        'focus-ring flex flex-1 items-center justify-between px-3 py-1.5 text-left text-ink-muted transition',
        enabled ? 'text-ink' : 'hover:text-ink',
      ].join(' ')}
    >
      <span className="font-medium">{label}</span>
      <span
        aria-hidden
        className={[
          'inline-flex h-3.5 w-7 items-center rounded-full p-0.5 transition',
          enabled ? 'bg-accent/40' : 'bg-surface-3',
        ].join(' ')}
      >
        <span
          className={[
            'h-2.5 w-2.5 rounded-full bg-ink transition-transform',
            enabled ? 'translate-x-3.5' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

/** Margin `X / Y` (used / available balance) + a usage progress bar —
 *  TV shows this as the first line of the order-info block. */
function MarginRow({ margin, balance }: { margin: number; balance: number }) {
  const pct = balance > 0 && Number.isFinite(margin) ? Math.min(100, (margin / balance) * 100) : 0;
  const danger = pct >= 90;
  return (
    <div className="col-span-2 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-ink-faint">Margin</dt>
        <dd className="font-mono tabular-nums text-ink">
          {fmt(margin, 2)}
          <span className="text-[10px] text-ink-faint"> / {fmt(balance, 2)} USD</span>
        </dd>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={['h-full rounded-full transition-all', danger ? 'bg-bear' : 'bg-accent'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  unit,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'neutral' | 'muted';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd
        className={[
          'font-mono tabular-nums',
          tone === 'muted' ? 'text-ink-muted' : 'text-ink',
        ].join(' ')}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] text-ink-faint">{unit}</span>}
      </dd>
    </div>
  );
}
