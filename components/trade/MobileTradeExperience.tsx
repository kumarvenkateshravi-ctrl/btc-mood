'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, CandlestickChart, ChevronUp, Ellipsis, Wallet } from 'lucide-react';
import Link from 'next/link';
import MobileSheet from '@/components/ui/MobileSheet';
import Num from '@/components/ui/Num';
import type { ChartTradingCommands, PlaceChartOrder, ReplayCommandContext, TradingCommandResult } from '@/lib/chartTradingCommands';
import type { MarketDataIntegrity } from '@/lib/marketDataIntegrity';
import { sizeRiskPosition } from '@/lib/riskSizing';
import type { TradePresentationFacade } from '@/lib/trade/presentationFacade';
import { deriveActivePosition, formatHeld } from '@/lib/trade/activePosition';
import { feedbackForTradingCommand } from '@/lib/tradeCommandFeedback';
import { getChartInstrumentPresentation } from '@/lib/chartInstrumentPresentation';
import { previewProtection } from '@/lib/trade/protectionPreview';

type OrderType = 'market' | 'limit' | 'stop';
type ManageAction = 'menu' | 'sl' | 'tp' | 'partial' | 'close';
type MobileCommands = Pick<ChartTradingCommands, 'openOrderTicket' | 'submitOrder' | 'setProtection' | 'partialClose' | 'toggleTrailing' | 'close'>;

export interface MobileTradeExperienceProps {
  symbol: string;
  presentation: TradePresentationFacade;
  commands: MobileCommands;
  leverage: number;
  integrity?: MarketDataIntegrity;
  replayContext?: ReplayCommandContext;
  bid?: number | null;
  ask?: number | null;
  secondaryContent?: ReactNode;
  onReplayTrade?: (side: 'buy' | 'sell') => void;
  entryPausedReason?: string;
}

/** Presentation-only mobile entry and management surface. */
export default function MobileTradeExperience({ symbol, presentation, commands, leverage, integrity = 'live', replayContext, bid, ask, secondaryContent, onReplayTrade, entryPausedReason }: MobileTradeExperienceProps) {
  const [navSheet, setNavSheet] = useState<'positions' | 'more' | null>(null);
  const [side, setSide] = useState<'buy' | 'sell' | null>(null);
  const [type, setType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAction, setManageAction] = useState<ManageAction>('menu');
  const [manageDraft, setManageDraft] = useState('');
  const [partialPct, setPartialPct] = useState(50);
  useEffect(() => { setSide(null); setNavSheet(null); setManageOpen(false); setManageAction('menu'); setManageDraft(''); setError(null); }, [symbol, presentation.mode, presentation.position?.id]);
  const instrument = getChartInstrumentPresentation(symbol);
  const mark = presentation.markPrice;
  const hasPosition = !!presentation.position && presentation.position.side !== 'flat' && presentation.position.units > 0;
  const canTrade = !entryPausedReason && presentation.mode === 'live' && presentation.markTrusted && integrity === 'live' && mark != null;
  const entryPrice = (type === 'market' ? mark : Number(limitPrice)) ?? Number.NaN;
  const preview = useMemo(() => {
    if (!side || !Number.isFinite(entryPrice) || !entryPrice || !Number(sl)) return null;
    return sizeRiskPosition({ side, entryPrice, stopPrice: Number(sl), equity: presentation.balance, riskPct: Number(riskPct), leverage });
  }, [side, entryPrice, sl, presentation.balance, riskPct, leverage]);
  const reward = preview?.ok && Number(tp) > 0 ? Math.abs(Number(tp) - entryPrice) * preview.units : null;
  const rr = preview?.ok && preview.riskAmount > 0 && reward != null ? reward / preview.riskAmount : null;
  const activeView = presentation.position && mark != null ? deriveActivePosition(presentation.position, mark, replayContext ? replayContext.cutTime * 1000 : undefined) : null;
  const result = (command: TradingCommandResult) => {
    if (command.status === 'accepted') { setError(null); setManageAction('menu'); return; }
    setError(feedbackForTradingCommand(command).message);
  };

  const open = (nextSide: 'buy' | 'sell') => {
    if (!canTrade) return setError(`Trading paused. Market data ${integrity}.`);
    const command = commands.openOrderTicket(symbol);
    if (command.status !== 'accepted') return setError(feedbackForTradingCommand(command).message);
    setError(null); setSide(nextSide);
  };
  const closeSheet = () => { setSide(null); setError(null); };
  const confirm = () => {
    if (!side || !preview?.ok || !Number.isFinite(entryPrice) || entryPrice <= 0) return setError(preview && !preview.ok ? readableSizingReason(preview.reason) : 'Enter a valid risk, stop loss, and order price.');
    if (!canTrade) return setError(`Trading paused. Market data ${integrity}.`);
    setSubmitting(true);
    const input: PlaceChartOrder = { symbol, side, type, units: preview.units, price: type === 'market' ? null : entryPrice, tp: Number(tp) > 0 ? Number(tp) : null, sl: Number(sl), reduceOnly: false, postOnly: false, leverage, midPrice: mark ?? entryPrice, ocoGroup: null };
    const command = commands.submitOrder(input);
    setSubmitting(false);
    if (command.status === 'accepted') closeSheet(); else setError(feedbackForTradingCommand(command).message);
  };
  const openManage = () => { setManageOpen(true); setManageAction('menu'); setError(null); };
  const applyProtection = (field: 'sl' | 'tp', value: number) => result(commands.setProtection({ symbol, protection: { [field]: value }, replayContext }));
  const closeAtMark = () => mark == null ? setError('No trusted price is available.') : result(commands.close({ symbol, mark, ts: replayContext?.cutTime, replayContext }));
  const partialAtMark = () => mark == null ? setError('No trusted price is available.') : result(commands.partialClose({ symbol, fraction: partialPct / 100, mark, ts: replayContext?.cutTime, replayContext }));

  const position = presentation.position;
  const direction = position?.side === 'short' ? 'SHORT' : 'LONG';
  const replay = presentation.mode === 'replay';
  const trade = (nextSide: 'buy' | 'sell') => { if (!entryPausedReason) { if (replay) onReplayTrade?.(nextSide); else open(nextSide); } };
  const currentPreview = position ? previewProtection(position, { [manageAction === 'sl' ? 'sl' : 'tp']: Number(manageDraft) }) : null;
  const openAction = (action: ManageAction) => {
    setManageAction(action); setError(null);
    setManageDraft(action === 'sl' ? String(position?.sl ?? '') : action === 'tp' ? String(position?.tp ?? '') : '');
  };
  // A caller that owns replay entry supplies that existing workflow explicitly.
  if (replay && !hasPosition && !onReplayTrade) return null;

  return <section className="terminal-mobile-trading lg:hidden" data-testid={hasPosition ? 'mobile-active-position' : 'mobile-trade-flat'} aria-label={hasPosition ? 'Active position' : 'Mobile trade entry'}>
    {!hasPosition ? <div className="terminal-trade-dock">
      {(entryPausedReason || (!replay && !canTrade)) && <p className="terminal-trading-paused" role="status"><strong>Trading paused</strong> · {entryPausedReason ?? `Market data ${integrity}`}</p>}
      <div className="terminal-quotes"><span>Bid <Price value={replay ? mark : bid} precision={instrument.pricePrecision} /></span><span>{replay ? 'Snapshot · Simulated' : 'No position'}</span><span>Ask <Price value={replay ? mark : ask} precision={instrument.pricePrecision} /></span></div>
      <div className="terminal-entry-actions">
        <button type="button" onClick={() => trade('buy')} disabled={!!entryPausedReason || (replay ? !mark : !canTrade)} aria-label={replay ? 'Replay BUY' : 'Open BUY order entry'} className="terminal-buy focus-ring min-h-11"><strong>BUY</strong><span>{replay ? 'Simulated' : 'Paper order'}</span></button>
        <span className="terminal-risk-label">{replay ? 'Replay' : 'Risk'}<br />{replay ? 'practice' : 'sized'}</span>
        <button type="button" onClick={() => trade('sell')} disabled={!!entryPausedReason || (replay ? !mark : !canTrade)} aria-label={replay ? 'Replay SELL' : 'Open SELL order entry'} className="terminal-sell focus-ring min-h-11"><strong>SELL</strong><span>{replay ? 'Simulated' : 'Paper order'}</span></button>
      </div>
    </div> : <div className="terminal-position-dock">
      <button type="button" className="terminal-position-toggle focus-ring min-h-11" onClick={openManage} aria-label="Manage active position" title={`Manage ${instrument.label} position`}>
        <span><strong className={direction === 'LONG' ? 'text-bull-bright' : 'text-bear-bright'}>Active {direction}</strong><span>{instrument.displaySymbol} · {replay ? 'REPLAY' : 'PAPER'}</span></span>
        <span className="terminal-position-pnl">{activeView && presentation.markTrusted ? <Num.Pnl value={activeView.pnlUsd} /> : <span>P&L unavailable</span>}<span>Manage Position <ChevronUp size={14} /></span></span>
      </button>
      <div className="terminal-position-levels"><span>Entry <Price value={position?.entryPrice} precision={instrument.pricePrecision} /></span><span>SL <Price value={position?.sl} precision={instrument.pricePrecision} /></span><span>TP <Price value={position?.tp} precision={instrument.pricePrecision} /></span></div>
      {!presentation.markTrusted && <p className="terminal-trading-paused" role="status">Trading paused · waiting for a trusted price</p>}
    </div>}
    {error && !side && !manageOpen && <p className="px-3 py-1 text-xs text-bear-bright" role="alert">{error}</p>}
    <nav className="terminal-bottom-nav" aria-label="Trading navigation">
      <button type="button" aria-current={!side && !manageOpen && !navSheet ? 'page' : undefined} onClick={() => { closeSheet(); setManageOpen(false); setNavSheet(null); }}><CandlestickChart size={21} /><span>Chart</span></button>
      <button type="button" onClick={() => hasPosition ? openManage() : trade('buy')} aria-label={hasPosition ? 'Trade management' : replay ? 'Open replay trade' : 'Open trade ticket'}><ArrowLeftRight size={21} /><span>Trade</span></button>
      <button type="button" onClick={() => hasPosition ? openManage() : setNavSheet('positions')}><span className="relative"><Wallet size={21} />{hasPosition && <b className="terminal-position-badge">1</b>}</span><span>Positions</span></button>
      <button type="button" onClick={() => setNavSheet('more')}><Ellipsis size={22} /><span>More</span></button>
    </nav>
    {navSheet && <MobileSheet title={navSheet === 'positions' ? 'Positions' : 'Trading workspace'} onClose={() => setNavSheet(null)}>
      {navSheet === 'positions' ? <div className="py-6 text-center"><Wallet className="mx-auto mb-3 text-ink-muted" size={28} /><p className="font-semibold text-ink">No open position</p><p className="mt-2 text-sm text-ink-muted">Your {instrument.label} {replay ? 'replay' : 'paper'} position will appear here.</p></div> : <><div className="terminal-workspace-links"><Link href="/multi-timeframe">Market dashboard</Link><Link href="/custom-multi-timeframe">Custom indicators</Link><Link href="/journal">Trade journal</Link></div><div className="terminal-mobile-secondary">{secondaryContent ?? <p className="text-sm text-ink-muted">Open the dashboard for market analysis.</p>}</div></>}
    </MobileSheet>}
    {side && <MobileSheet title={`${side === 'buy' ? 'BUY' : 'SELL'} ${instrument.displaySymbol} order entry`} onClose={closeSheet}>
      <p className="mb-3 text-xs text-ink-muted">Live Paper · review risk before confirming</p>
      <div className="terminal-order-types" role="group" aria-label="Order type">{(['market','limit','stop'] as OrderType[]).map(value => <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}>{value}</button>)}</div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {type !== 'market' && <NumberInput label={type === 'limit' ? 'Limit price' : 'Stop price'} value={limitPrice} onChange={setLimitPrice} />}
        <NumberInput label="Risk %" value={riskPct} onChange={setRiskPct} />
        <NumberInput label="Stop Loss" value={sl} onChange={setSl} />
        <NumberInput label="Take Profit" value={tp} onChange={setTp} />
      </div>
      <dl className="terminal-order-summary"><Metric label="Balance" value={<Num.Money value={presentation.balance} />} /><Metric label="Entry" value={Number.isFinite(entryPrice) ? <Price value={entryPrice} precision={instrument.pricePrecision} /> : '—'} /><Metric label="Risk amount" value={preview?.ok ? <Num.Money value={preview.riskAmount} /> : '—'} /><Metric label="Position size" value={preview?.ok ? <Num.Qty value={preview.units} unit={instrument.label} precision={4} /> : '—'} /><Metric label="Required margin" value={preview?.ok ? <Num.Money value={preview.margin} /> : '—'} /><Metric label="Risk : Reward" value={rr == null ? '—' : <Num.RR ratio={rr} />} /><Metric label="Potential loss" value={preview?.ok ? <Num.Pnl value={-preview.riskAmount} /> : '—'} /><Metric label="Potential profit" value={reward == null ? '—' : <Num.Pnl value={reward} />} /></dl>
      {error && <p role="alert" className="py-2 text-sm text-bear-bright">{error}</p>}
      {!canTrade && <p role="status" className="py-2 text-sm text-warn">Trading paused · Market data {integrity}</p>}
      <div className="terminal-sheet-submit"><button type="button" onClick={confirm} disabled={submitting || !canTrade} className={side === 'buy' ? 'terminal-buy focus-ring' : 'terminal-sell focus-ring'}>{submitting ? 'Submitting…' : `Confirm ${side === 'buy' ? 'BUY' : 'SELL'}`}</button></div>
    </MobileSheet>}
    {manageOpen && position && currentPreview && <MobileSheet title={manageAction === 'sl' ? 'Edit Stop Loss' : manageAction === 'tp' ? 'Edit Take Profit' : manageAction === 'partial' ? 'Partial Close' : manageAction === 'close' ? 'Close Position' : 'Manage Position'} onClose={() => setManageOpen(false)}>
      <div className="mb-4 flex items-center justify-between text-sm"><strong className={direction === 'LONG' ? 'text-bull-bright' : 'text-bear-bright'}>{direction} {instrument.displaySymbol}</strong><span className="text-ink-muted">{replay ? 'REPLAY · SIMULATED' : 'PAPER'}</span></div>
      {activeView && <dl className="terminal-order-summary"><Metric label="Current P&L" value={presentation.markTrusted ? <Num.Pnl value={activeView.pnlUsd} /> : 'Unavailable'} /><Metric label="R multiple" value={presentation.markTrusted && activeView.pnlR != null ? <span><Num value={activeView.pnlR} precision={2} />R</span> : '—'} /><Metric label="Size" value={<Num.Qty value={activeView.qty} unit={instrument.label} precision={4} />} /><Metric label="Margin" value={<Num.Money value={activeView.marginUsed} />} /><Metric label="Current" value={<Price value={mark} precision={instrument.pricePrecision} />} /><Metric label="Held" value={formatHeld(activeView.heldMs)} /></dl>}
      {manageAction === 'menu' ? <div className="terminal-manage-grid">
        <button type="button" onClick={() => result(commands.setProtection({ symbol, protection: { sl: position.entryPrice }, replayContext }))}>Move SL to BE</button>
        <button type="button" onClick={() => openAction('sl')}>Edit Stop Loss</button>
        <button type="button" onClick={() => openAction('tp')}>Edit Take Profit</button>
        {[25,50,75].map(pct => <button type="button" key={pct} onClick={() => { setPartialPct(pct); openAction('partial'); }} aria-label={`Partial close ${pct}%`}>{pct}%</button>)}
        <button type="button" onClick={() => result(commands.toggleTrailing({ symbol, enabled: !position.trailingSl, replayContext }))}>Trailing {position.trailingSl ? 'ACTIVE' : 'OFF'}</button>
        <button type="button" onClick={() => openAction('close')} className="text-bear-bright">Close Position</button>
      </div> : manageAction === 'partial' ? <>
        <p className="text-sm text-ink-muted">Close {partialPct}% of your position</p><div className="terminal-order-types my-3">{[25,50,75].map(pct => <button key={pct} onClick={() => setPartialPct(pct)} aria-pressed={partialPct === pct}>{pct}%</button>)}</div>
        <dl className="terminal-order-summary"><Metric label="Closing size" value={<Num.Qty value={position.units * partialPct / 100} unit={instrument.label} precision={4} />} /><Metric label="Remaining" value={<Num.Qty value={position.units * (1-partialPct / 100)} unit={instrument.label} precision={4} />} /></dl><button type="button" className="terminal-confirm" disabled={!presentation.markTrusted} onClick={partialAtMark}>Confirm Partial Close</button>
      </> : manageAction === 'close' ? <><p className="mb-4 text-sm text-ink-muted">Close the entire {direction} position at the current market price?</p><button type="button" className="terminal-sell w-full" disabled={!presentation.markTrusted} onClick={closeAtMark}>Confirm Close</button></> : <>
        <NumberInput label={manageAction === 'sl' ? 'Proposed Stop Loss' : 'Proposed Take Profit'} value={manageDraft} onChange={setManageDraft} /><dl className="terminal-order-summary"><Metric label={currentPreview.kind === 'profit-lock' ? 'Locks profit' : 'At level'} value={currentPreview.pnlAtLevel == null ? '—' : <Num.Pnl value={currentPreview.pnlAtLevel} />} /><Metric label="R impact" value={currentPreview.rMultiple == null ? '—' : <span><Num value={currentPreview.rMultiple} precision={2} />R</span>} /></dl><button type="button" className="terminal-confirm" onClick={() => applyProtection(manageAction === 'sl' ? 'sl' : 'tp',Number(manageDraft))}>Apply {manageAction === 'sl' ? 'Stop Loss' : 'Take Profit'}</button>
      </>}
      {manageAction !== 'menu' && <button type="button" className="mt-2 min-h-11 w-full text-sm text-ink-muted" onClick={() => openAction('menu')}>Back to management</button>}
      {error && <p role="alert" className="mt-3 text-sm text-bear-bright">{error}</p>}
    </MobileSheet>}
  </section>;
}

function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="terminal-number-field">{label}<input inputMode="decimal" type="number" value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function Metric({ label, value }: { label: string; value: ReactNode }) { return <div><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 text-sm text-ink">{value}</dd></div>; }
function readableSizingReason(reason: string) { return ({ 'no-stop': 'A stop loss is required for risk sizing.', 'stop-on-wrong-side': 'Stop loss is on the wrong side of entry.', 'insufficient-margin': 'Insufficient margin for this risk size.' } as Record<string, string>)[reason] ?? 'Enter valid trade values.'; }

function Price({ value, precision }: { value?: number | null; precision: number }) { return value != null && Number.isFinite(value) ? <Num.Price value={value} precision={precision} /> : <span>—</span>; }
