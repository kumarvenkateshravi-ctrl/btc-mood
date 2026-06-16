'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react';
import styles from './OrderTicket.module.css';
import { usePaperStore } from '@/lib/paperStore';
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
}

type Tab = 'market' | 'limit' | 'stop';

const TABS: { id: Tab; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'limit', label: 'Limit' },
  { id: 'stop', label: 'Stop' },
];

export default function OrderTicket(p: OrderTicketProps) {
  const {
    placeOrder,
    lastError,
    activeOrder,
    setActiveOrder,
    updateActiveOverlay,
    clearActiveOrder,
    confirmActiveOrder,
    toggleActiveOverlay,
    balance,
  } = usePaperStore();
  const [tab, setTab] = useState<Tab>('market');
  const [side, setSide] = useState<Side>('buy');
  const [units, setUnits] = useState<string>('0.10');
  const [price, setPrice] = useState<string>(p.midPrice.toFixed(1));
  // TP/SL on by default so a freshly-staged order shows all three
  // draggable lines on the chart (TradingView-style). The actual price
  // falls back to the suggested defaults (suggestTp / suggestSl) when
  // the user hasn't typed an explicit value.
  const [tpEnabled, setTpEnabled] = useState(true);
  const [slEnabled, setSlEnabled] = useState(true);
  const [tp, setTp] = useState<string>('');
  const [sl, setSl] = useState<string>('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pulseToken, setPulseToken] = useState(0);
  const [priceTouched, setPriceTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [riskPct, setRiskPct] = useState('');
  const [ocoEnabled, setOcoEnabled] = useState(false);
  const ocoGroupRef = useRef<string | null>(null);
  const stagedIdRef = useRef<string | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  const autoPrice = priceTouched ? null : p.midPrice.toFixed(1);
  const effectivePrice = priceTouched ? price : (autoPrice ?? price);

  const unitsN = Number(units) || 0;
  const priceN = Number(effectivePrice) || 0;
  const fillPrice =
    tab === 'market' ? p.midPrice + (side === 'buy' ? BTC_TICK_SIZE : -BTC_TICK_SIZE) : priceN;

  const suggestTp = useMemo(() => {
    if (unitsN <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) return null;
    const pct = side === 'buy' ? 0.01 : -0.01;
    return Number((fillPrice * (1 + pct)).toFixed(1));
  }, [side, fillPrice, unitsN]);
  const suggestSl = useMemo(() => {
    if (unitsN <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) return null;
    const pct = side === 'buy' ? -0.01 : 0.01;
    return Number((fillPrice * (1 + pct)).toFixed(1));
  }, [side, fillPrice, unitsN]);

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

  // Render-time derivation: when the staged activeOrder matches the
  // current ticket (symbol/side/type/units), the chart is the source
  // of truth and the ticket mirrors it. No setState-in-effect needed.
  const activeMatches =
    activeOrder != null &&
    activeOrder.symbol === p.symbol &&
    activeOrder.side === side &&
    activeOrder.type === tab &&
    activeOrder.units === effectiveUnits;
  const displayedTp = tpEnabled && activeMatches
    ? activeOrder!.tp
    : resolveLevel(tpEnabled, tp, suggestTp);
  const displayedSl = slEnabled && activeMatches
    ? activeOrder!.sl
    : resolveLevel(slEnabled, sl, suggestSl);
  const displayedPrice = activeMatches ? activeOrder!.entry : priceN;
  const effectiveTpEnabled = displayedTp != null;
  const effectiveSlEnabled = displayedSl != null;

  // User typed -> push to the staged order (event-handler only, no
  // setState in effects). Called from onChange handlers below.
  // The staged order carries the entry line unconditionally but only
  // carries TP/SL when the user has explicitly enabled the toggle —
  // matches TradingView's behavior where Buy/Sell drops a single line
  // and TP/SL show up only after the user turns them on.
  const stageFromInputs = () => {
    if (!canSubmit) {
      if (
        activeOrder &&
        activeOrder.symbol === p.symbol &&
        activeOrder.side === side &&
        activeOrder.type === tab
      ) {
        clearActiveOrder();
        stagedIdRef.current = null;
      }
      return;
    }
    if (!stagedIdRef.current) {
      stagedIdRef.current = `stg_${crypto.randomUUID().slice(0, 12)}`;
    }
    setActiveOrder({
      id: stagedIdRef.current,
      symbol: p.symbol,
      side,
      type: tab,
      units: effectiveUnits,
      entry: displayedPrice,
      tp: tpEnabled ? displayedTp : null,
      sl: slEnabled ? displayedSl : null,
      reduceOnly,
      postOnly,
      ocoGroup: ocoEnabled ? (ocoGroupRef.current ?? (ocoGroupRef.current = `oco_${crypto.randomUUID().slice(0, 10)}`)) : null,
    });
  };

  const handleUnitsChange = (v: string) => {
    setUnits(v);
    setRiskPct('');
    setConfirming(false);
    stageFromInputs();
  };
  const handleRiskPctChange = (v: string) => {
    setRiskPct(v);
    stageFromInputs();
  };
  const handlePriceChange = (v: string) => {
    setPriceTouched(true);
    setPrice(v);
    setConfirming(false);
    stageFromInputs();
  };
  const handleTpChange = (v: string) => {
    setTp(v);
    const n = Number(v);
    updateActiveOverlay('tp', n > 0 ? n : null);
  };
  const handleSlChange = (v: string) => {
    setSl(v);
    const n = Number(v);
    updateActiveOverlay('sl', n > 0 ? n : null);
  };
  const handleReduceOnlyChange = (v: boolean) => {
    setReduceOnly(v);
    stageFromInputs();
  };
  const handlePostOnlyChange = (v: boolean) => {
    setPostOnly(v);
    stageFromInputs();
  };
  const handleSideChange = (s: Side) => {
    setSide(s);
    stageFromInputs();
  };
  const handleTabChange = (t: Tab) => {
    setTab(t);
    stageFromInputs();
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (tab === 'market' && !confirming) {
      setConfirming(true);
      return;
    }
    setPulseToken((tok) => tok + 1);
    if (tab === 'market') {
      setConfirming(false);
      placeOrder({
        symbol: p.symbol,
        side,
        type: 'market',
        units: effectiveUnits,
        price: null,
        tp: resolveLevel(tpEnabled, tp, suggestTp),
        sl: resolveLevel(slEnabled, sl, suggestSl),
        reduceOnly,
        postOnly,
        leverage: p.leverage,
        midPrice: p.midPrice,
      });
      return;
    }
    confirmActiveOrder({
      leverage: p.leverage,
      midPrice: p.midPrice,
    });
  };

  const handleDiscard = () => {
    clearActiveOrder();
    setPrice(p.midPrice.toFixed(1));
    setPriceTouched(false);
    setTp('');
    setSl('');
    setTpEnabled(false);
    setSlEnabled(false);
  };

  // Keyboard trading: B/S flips side, Enter submits, Esc discards.
  // We DO listen for B/S even when an input is focused — these are
  // common single-letter keys that are unlikely to clash with normal
  // typing. We only intercept B/S outside of inputs; for arrow keys
  // we DO handle them inside number inputs as a step shortcut.
  useEffect(() => {
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
        if (canSubmit) {
          handleSubmit();
          e.preventDefault();
        }
        return;
      }
      // Esc — discard the staged order (if any).
      if (k === 'Escape') {
        if (activeOrder && activeOrder.symbol === p.symbol) {
          handleDiscard();
          e.preventDefault();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // We intentionally re-bind on canSubmit/activeOrder so the closure
  // sees the latest values. The handlers are stable enough.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, activeOrder, p.symbol]);

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
    <section className={['panel overflow-hidden rounded-2xl', styles.ticket].join(' ')}>
      <header className="flex items-center justify-between border-b border-line bg-surface-2/40 px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Order ticket
        </h2>
        <span className="rounded-md bg-bull/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-bull-bright ring-1 ring-bull/30">
          Paper
        </span>
      </header>

      <div className="space-y-3 px-[80px] py-3.5">
        <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2/40 p-1 text-xs">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => handleTabChange(t.id)}
                className={[
                  'focus-ring rounded-md py-1.5 font-medium transition',
                  active
                    ? 'bg-accent/20 text-ink ring-1 ring-accent/40'
                    : 'text-ink-muted hover:bg-surface-3/40 hover:text-ink',
                ].join(' ')}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <SideToggle
          value={side}
          onChange={handleSideChange}
          bid={p.midPrice - BTC_TICK_SIZE}
          ask={p.midPrice + BTC_TICK_SIZE}
        />

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

        <div
          key={tab}
          className={styles.fadeIn}
          aria-hidden={tab === 'market'}
          style={tab === 'market' ? { display: 'none' } : undefined}
        >
          <NumberField
            label={tab === 'limit' ? 'Limit price' : 'Stop price'}
            value={activeMatches ? displayedPrice.toFixed(1) : effectivePrice}
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

        <div className="rounded-lg border border-line bg-surface-2/30">
          <div className="flex divide-x divide-line text-xs">
            <ToggleChip
              label="TP"
              enabled={effectiveTpEnabled}
              onToggle={() => {
                const next = !effectiveTpEnabled;
                if (next && suggestTp != null && !tp) setTp(suggestTp.toFixed(1));
                if (next) setTpEnabled(true);
                else if (!activeMatches) {
                  setTpEnabled(false);
                  setTp('');
                }
                toggleActiveOverlay('tp', next, suggestTp ?? 0);
              }}
            />
            <ToggleChip
              label="SL"
              enabled={effectiveSlEnabled}
              onToggle={() => {
                const next = !effectiveSlEnabled;
                if (next && suggestSl != null && !sl) setSl(suggestSl.toFixed(1));
                if (next) setSlEnabled(true);
                else if (!activeMatches) {
                  setSlEnabled(false);
                  setSl('');
                }
                toggleActiveOverlay('sl', next, suggestSl ?? 0);
              }}
            />
          </div>
          {effectiveTpEnabled && (
            <NumberField
              label="Take profit"
              value={activeMatches && displayedTp != null ? displayedTp.toFixed(1) : tp}
              onChange={handleTpChange}
              step={0.1}
              suffix="USD"
              className="border-t border-line"
            />
          )}
          {effectiveSlEnabled && (
            <NumberField
              label="Stop loss"
              value={activeMatches && displayedSl != null ? displayedSl.toFixed(1) : sl}
              onChange={handleSlChange}
              step={0.1}
              suffix="USD"
              className="border-t border-line"
            />
          )}
        </div>

        {tab !== 'market' && (
          <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/30 px-3 py-1.5 text-xs">
            <span className="text-ink-muted">OCO group (cancel other on fill)</span>
            <input
              type="checkbox"
              checked={ocoEnabled}
              onChange={(e) => {
                setOcoEnabled(e.target.checked);
                if (!e.target.checked) ocoGroupRef.current = null;
                stageFromInputs();
              }}
              className="h-3.5 w-3.5 accent-accent"
            />
          </label>
        )}

        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          className="rounded-lg border border-line bg-surface-2/30 text-xs"
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

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Row label="Margin" value={fmt(margin, 2)} unit="USD" />
          <Row label="Leverage" value={`${p.leverage}×`} />
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

        {lastError && (
          <p className="rounded-md border border-bear/30 bg-bear/10 px-2 py-1 text-xs text-bear-bright">
            {lastError}
          </p>
        )}

        {tab === 'market' ? (
          <div className="space-y-1.5">
            <button
              ref={ctaRef}
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={[
                styles.cta,
                side === 'buy' ? styles.ctaBuy : styles.ctaSell,
                !canSubmit ? styles.ctaDisabled : '',
                confirming ? styles.ctaConfirm : '',
                'focus-ring relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm font-semibold transition-all',
              ].join(' ')}
              aria-label={
                confirming
                  ? `Confirm ${side === 'buy' ? 'Buy' : 'Sell'} ${effectiveUnits} BTC @ ${fillPrice.toFixed(1)}`
                  : `${side === 'buy' ? 'Buy' : 'Sell'} ${effectiveUnits} BTC at market`
              }
            >
              {confirming ? (
                <>
                  <span className="text-xs font-normal text-ink">Confirm</span>
                  <span className="font-semibold">
                    {side === 'buy' ? 'Buy' : 'Sell'} {effectiveUnits.toFixed(4)} @ {fillPrice.toFixed(1)}
                  </span>
                  <span className="text-[10px] font-medium opacity-70">
                    ≈${notional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </>
              ) : (
                <>
                  {side === 'buy' ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span>
                    {side === 'buy' ? 'Buy' : 'Sell'} {effectiveUnits.toFixed(4)} BTC
                  </span>
                  <span className="text-xs font-normal opacity-80">@ market</span>
                  <kbd className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-current/30 px-1 text-[10px] font-medium opacity-70">
                    ⏎
                  </kbd>
                </>
              )}
              {pulseToken > 0 && (
                <span
                  key={pulseToken}
                  aria-hidden
                  className={[styles.ctaPulse, side === 'buy' ? styles.pulseBuy : styles.pulseSell].join(' ')}
                />
              )}
            </button>
            {confirming && (
              <button
                onClick={() => setConfirming(false)}
                className="w-full rounded-md border border-line bg-surface-2/40 px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_auto] items-stretch gap-1.5">
            <button
              ref={ctaRef}
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={[
                styles.cta,
                side === 'buy' ? styles.ctaBuy : styles.ctaSell,
                !canSubmit ? styles.ctaDisabled : '',
                'focus-ring relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-lg px-3 py-3 text-sm font-semibold',
              ].join(' ')}
              aria-label={`Confirm ${side === 'buy' ? 'buy' : 'sell'} ${effectiveUnits} BTC at ${priceN}`}
            >
              <span>
                {side === 'buy' ? 'Buy' : 'Sell'} {effectiveUnits.toFixed(4)} @ {priceN > 0 ? priceN : '—'}
              </span>
              {pulseToken > 0 && (
                <span
                  key={pulseToken}
                  aria-hidden
                  className={[styles.ctaPulse, side === 'buy' ? styles.pulseBuy : styles.pulseSell].join(' ')}
                />
              )}
            </button>
            <button
              onClick={handleDiscard}
              className="focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-line bg-surface-2/40 px-3 text-xs font-medium text-ink-muted transition hover:text-ink"
              aria-label="Discard staged order"
              title="Discard staged order"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {tab !== 'market' && activeOrder && activeOrder.symbol === p.symbol && (
          <p className="text-[10px] text-ink-faint">
            <span className="font-medium text-ink-muted">Drag the lines</span> on the chart to fine-tune entry, TP, and SL. Confirm to place.
          </p>
        )}

        <p className="flex items-center gap-1.5 text-[10px] text-ink-faint">
          <ShieldCheck className="h-3 w-3" />
          Paper only — fills are simulated against live bars; nothing is sent to any exchange.
        </p>
      </div>
    </section>
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
    <div className="relative grid grid-cols-2 rounded-lg border border-line bg-surface-2/40 p-1 text-xs">
      <span
        aria-hidden
        className={[
          'absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-md transition-transform',
          value === 'buy' ? styles.toggleBuy : styles.toggleSell,
        ].join(' ')}
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
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
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <div className={[
        'relative flex items-center rounded-md border border-line bg-surface-1/60 transition focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/40',
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
              className="rounded border border-line bg-surface-2/40 px-1.5 py-0.5 font-mono text-ink-muted transition hover:border-accent/40 hover:text-ink"
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
        <div className="relative flex flex-1 items-center rounded-md border border-line bg-surface-1/60 transition focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/40">
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
          enabled ? 'bg-accent/40' : 'bg-surface-3/60',
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
