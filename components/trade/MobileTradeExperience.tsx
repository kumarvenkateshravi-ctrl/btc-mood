'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import Num from '@/components/ui/Num';
import type { ChartTradingCommands, PlaceChartOrder, ReplayCommandContext, TradingCommandResult } from '@/lib/chartTradingCommands';
import type { MarketDataIntegrity } from '@/lib/marketDataIntegrity';
import { sizeRiskPosition } from '@/lib/riskSizing';
import type { TradePresentationFacade } from '@/lib/trade/presentationFacade';
import { deriveActivePosition, formatHeld } from '@/lib/trade/activePosition';
import { feedbackForTradingCommand } from '@/lib/tradeCommandFeedback';
import { getChartInstrumentPresentation } from '@/lib/chartInstrumentPresentation';
import { previewProtection, type ProtectionPreview } from '@/lib/trade/protectionPreview';

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
}

/** Presentation-only mobile entry and management surface. */
export default function MobileTradeExperience({ symbol, presentation, commands, leverage, integrity = 'live', replayContext }: MobileTradeExperienceProps) {
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
  useEffect(() => { setManageOpen(false); setManageAction('menu'); setManageDraft(''); setError(null); }, [symbol, presentation.mode, presentation.position?.id]);
  const instrument = getChartInstrumentPresentation(symbol);
  const mark = presentation.markPrice;
  const hasPosition = !!presentation.position && presentation.position.side !== 'flat' && presentation.position.units > 0;
  const canTrade = presentation.mode === 'live' && presentation.markTrusted && integrity === 'live' && mark != null;
  const entryPrice = (type === 'market' ? mark : Number(limitPrice)) ?? Number.NaN;
  const preview = useMemo(() => {
    if (!side || !Number.isFinite(entryPrice) || !entryPrice || !Number(sl)) return null;
    return sizeRiskPosition({ side, entryPrice, stopPrice: Number(sl), equity: presentation.balance, riskPct: Number(riskPct), leverage });
  }, [side, entryPrice, sl, presentation.balance, riskPct, leverage]);
  const reward = preview?.ok && Number(tp) > 0 ? Math.abs(Number(tp) - entryPrice) * preview.units : null;
  const rr = preview?.ok && preview.riskAmount > 0 && reward != null ? reward / preview.riskAmount : null;
  const activeView = presentation.position && mark != null ? deriveActivePosition(presentation.position, mark) : null;
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

  if (hasPosition && activeView && presentation.position) {
    const direction = activeView.side === 'long' ? 'LONG' : 'SHORT';
    const currentPreview = manageAction === 'sl' ? previewProtection(presentation.position, { sl: Number(manageDraft) }) : previewProtection(presentation.position, { tp: Number(manageDraft) });
    return <section data-testid="mobile-active-position" className="border-t border-line bg-surface/95 px-3 py-2 md:hidden" aria-label="Active position">
      <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint">{direction} · {instrument.label}</p><Num.Pnl value={activeView.pnlUsd} className="text-lg" /></div><div className="text-right"><p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">{presentation.mode === 'replay' ? 'Replay' : 'Paper'}</p><p className="num text-sm font-semibold text-ink">{activeView.pnlR == null ? 'R —' : `${activeView.pnlR >= 0 ? '+' : ''}${activeView.pnlR.toFixed(2)}R`}</p></div></div>
      <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[10px]"><Metric label="Margin" value={<Num.Money value={activeView.marginUsed} />} /><Metric label="Entry" value={<Num.Price value={activeView.entry} precision={instrument.pricePrecision} />} /><Metric label="Current" value={<Num.Price value={activeView.mark} precision={instrument.pricePrecision} />} /><Metric label="SL" value={activeView.stopLoss == null ? '—' : <Num.Price value={activeView.stopLoss} precision={instrument.pricePrecision} />} /><Metric label="TP" value={activeView.takeProfit == null ? '—' : <Num.Price value={activeView.takeProfit} precision={instrument.pricePrecision} />} /><Metric label="Size" value={<Num.Qty value={activeView.qty} unit={instrument.label} precision={4} />} /></dl>
      <div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-ink-faint">Held {formatHeld(activeView.heldMs)}</span><button type="button" onClick={openManage} className="focus-ring min-h-11 rounded-md border border-line px-3 text-xs font-semibold text-ink" aria-label="Manage active position">Manage Position</button></div>
      {manageOpen && <ManagementSheet direction={direction} symbol={instrument.displaySymbol} mode={presentation.mode} positionUnits={activeView.qty} unit={instrument.label} pnl={activeView.pnlUsd} trailing={presentation.position.trailingSl} action={manageAction} draft={manageDraft} preview={currentPreview} partialPct={partialPct} onAction={setManageAction} onDraft={setManageDraft} onPartial={setPartialPct} onDismiss={() => setManageOpen(false)} onBreakEven={() => result(commands.setProtection({ symbol, protection: { sl: activeView.entry }, replayContext }))} onApplyLevel={() => applyProtection(manageAction === 'sl' ? 'sl' : 'tp', Number(manageDraft))} onTrailing={() => result(commands.toggleTrailing({ symbol, enabled: !presentation.position!.trailingSl, replayContext }))} onPartialClose={partialAtMark} onFullClose={closeAtMark} error={error} />}
    </section>;
  }

  // Replay owns flat-entry through SessionHud and its replay-session risk
  // policy. Keeping this live-paper ticket mounted here would show disabled
  // BUY/SELL controls and a misleading Trading paused state below that replay surface.
  // Active replay positions still use the management sheet and command boundary above.
  if (presentation.mode === 'replay') return null;

  return <section data-testid="mobile-trade-flat" className="border-t border-line bg-surface/95 px-3 py-2 md:hidden" aria-label="Mobile trade entry">
    {!canTrade && <p className="mb-2 rounded-md border border-warn/30 bg-warn/10 px-2 py-1.5 text-xs text-warn" role="status"><strong>Trading paused</strong> · Market data {integrity}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => open('buy')} className="focus-ring min-h-11 rounded-md border border-bull/40 bg-bull/10 text-sm font-bold text-bull-bright disabled:opacity-45" aria-label="Open BUY order entry" disabled={!canTrade}>BUY</button><button type="button" onClick={() => open('sell')} className="focus-ring min-h-11 rounded-md border border-bear/40 bg-bear/10 text-sm font-bold text-bear-bright disabled:opacity-45" aria-label="Open SELL order entry" disabled={!canTrade}>SELL</button></div>
    {error && !side && <p className="mt-2 text-xs text-bear-bright" role="alert">{error}</p>}
    {side && <div className="fixed inset-x-0 bottom-0 z-[120] max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-2" role="dialog" aria-label={`${side === 'buy' ? 'BUY' : 'SELL'} ${instrument.displaySymbol} order entry`}><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" /><div className="mb-4 flex items-center justify-between"><div><p className={side === 'buy' ? 'text-sm font-bold text-bull-bright' : 'text-sm font-bold text-bear-bright'}>{side === 'buy' ? 'BUY' : 'SELL'} {instrument.displaySymbol}</p><p className="text-xs text-ink-faint">Live Paper · review risk before confirming</p></div><button type="button" onClick={closeSheet} className="focus-ring min-h-11 min-w-11 rounded-md text-ink-muted" aria-label="Close order entry"><X className="mx-auto h-5 w-5" /></button></div><div className="grid grid-cols-3 gap-1 rounded-lg bg-base p-1" role="tablist" aria-label="Order type">{(['market','limit','stop'] as OrderType[]).map((value) => <button key={value} type="button" onClick={() => setType(value)} className={['min-h-11 rounded-md text-xs font-semibold capitalize', type === value ? 'bg-surface-2 text-ink' : 'text-ink-faint'].join(' ')} aria-pressed={type === value}>{value}</button>)}</div>{type !== 'market' && <NumberInput label={type === 'limit' ? 'Limit price' : 'Stop price'} value={limitPrice} onChange={setLimitPrice} />}<div className="mt-3 grid grid-cols-2 gap-2"><NumberInput label="Risk %" value={riskPct} onChange={setRiskPct} /><NumberInput label="Stop Loss" value={sl} onChange={setSl} /><NumberInput label="Take Profit" value={tp} onChange={setTp} /></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-base/50 p-3 text-xs"><Metric label="Account balance" value={<Num.Money value={presentation.balance} />} /><Metric label="Required margin" value={preview?.ok ? <Num.Money value={preview.margin} /> : '—'} /><Metric label="Risk amount" value={preview?.ok ? <Num.Money value={preview.riskAmount} /> : '—'} /><Metric label="Position size" value={preview?.ok ? <Num.Qty value={preview.units} unit={instrument.label} precision={4} /> : '—'} /><Metric label="Entry" value={Number.isFinite(entryPrice) && entryPrice ? <Num.Price value={entryPrice} precision={instrument.pricePrecision} /> : '—'} /><Metric label="Risk : Reward" value={rr == null ? '—' : <Num.RR ratio={rr} />} /></dl>{error && <p className="mt-3 rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear-bright" role="alert">{error}</p>}<button type="button" onClick={confirm} disabled={submitting || !canTrade} className={['focus-ring mt-3 min-h-12 w-full rounded-lg text-sm font-bold disabled:opacity-45', side === 'buy' ? 'bg-bull text-base' : 'bg-bear text-base'].join(' ')}>{submitting ? 'Submitting…' : `Confirm ${side === 'buy' ? 'BUY' : 'SELL'}`}</button></div>}
  </section>;
}

function ManagementSheet({ direction, symbol, mode, positionUnits, unit, pnl, trailing, action, draft, preview, partialPct, onAction, onDraft, onPartial, onDismiss, onBreakEven, onApplyLevel, onTrailing, onPartialClose, onFullClose, error }: { direction: string; symbol: string; mode: string; positionUnits: number; unit: string; pnl: number; trailing: boolean; action: ManageAction; draft: string; preview: ProtectionPreview; partialPct: number; onAction: (action: ManageAction) => void; onDraft: (value: string) => void; onPartial: (value: number) => void; onDismiss: () => void; onBreakEven: () => void; onApplyLevel: () => void; onTrailing: () => void; onPartialClose: () => void; onFullClose: () => void; error: string | null }) {
  const title = action === 'sl' ? 'Edit Stop Loss' : action === 'tp' ? 'Edit Take Profit' : action === 'partial' ? 'Partial Close' : action === 'close' ? 'Close Position' : 'Manage Position';
  return <div className="fixed inset-x-0 bottom-0 z-[120] max-h-[86dvh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-2" role="dialog" aria-label={title}><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" /><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold text-ink">{title}</p><p className="text-xs text-ink-faint">{direction} {symbol} · {mode === 'replay' ? 'REPLAY' : 'PAPER'}</p></div><button type="button" onClick={onDismiss} className="min-h-11 min-w-11 text-ink-muted" aria-label="Close position management"><X className="mx-auto h-5 w-5" /></button></div>{action === 'menu' ? <div className="grid grid-cols-2 gap-2"><button onClick={onBreakEven} className="min-h-11 rounded-md border border-line text-xs font-semibold text-ink">Move SL to BE</button><button onClick={() => onAction('sl')} className="min-h-11 rounded-md border border-line text-xs font-semibold text-ink">Edit Stop Loss</button><button onClick={() => onAction('tp')} className="min-h-11 rounded-md border border-line text-xs font-semibold text-ink">Edit Take Profit</button><button onClick={() => onAction('partial')} className="min-h-11 rounded-md border border-line text-xs font-semibold text-ink">Partial Close</button><button onClick={onTrailing} className="min-h-11 rounded-md border border-line text-xs font-semibold text-ink">Trailing {trailing ? 'ACTIVE' : 'OFF'}</button><button onClick={() => onAction('close')} className="min-h-11 rounded-md border border-bear/40 text-xs font-semibold text-bear-bright">Close Position</button></div> : action === 'partial' ? <div><p className="text-sm text-ink-muted">Close {partialPct}% · {(positionUnits * partialPct / 100).toFixed(4)} {unit}</p><div className="mt-3 grid grid-cols-3 gap-2">{[25,50,75].map((pct) => <button key={pct} onClick={() => onPartial(pct)} className={['min-h-11 rounded-md border text-sm font-semibold', partialPct === pct ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink-muted'].join(' ')}>{pct}%</button>)}</div><p className="mt-3 text-xs text-ink-faint">Remaining: {(positionUnits * (1 - partialPct / 100)).toFixed(4)} {unit}</p><button onClick={onPartialClose} className="mt-4 min-h-12 w-full rounded-lg bg-accent text-sm font-bold text-base">Confirm Partial Close</button></div> : action === 'close' ? <div><p className="text-sm text-ink">This closes the entire {direction} position.</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><Metric label="Position size" value={<Num.Qty value={positionUnits} unit={unit} precision={4} />} /><Metric label="Current P&L" value={<Num.Pnl value={pnl} />} /></dl><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onAction('menu')} className="min-h-11 rounded-md border border-line text-sm font-semibold text-ink">Cancel</button><button onClick={onFullClose} className="min-h-11 rounded-md bg-bear text-sm font-bold text-base">Confirm Close</button></div></div> : <div><NumberInput label={action === 'sl' ? 'Proposed Stop Loss' : 'Proposed Take Profit'} value={draft} onChange={onDraft} /><dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line bg-base/50 p-3 text-xs"><Metric label={preview.kind === 'profit-lock' ? 'Locks profit' : 'At level'} value={preview.pnlAtLevel == null ? '—' : <Num.Pnl value={preview.pnlAtLevel} />} /><Metric label="R impact" value={preview.rMultiple == null ? '—' : `${preview.rMultiple >= 0 ? '+' : ''}${preview.rMultiple.toFixed(2)}R`} /></dl><button onClick={onApplyLevel} className="mt-4 min-h-12 w-full rounded-lg bg-accent text-sm font-bold text-base">Apply {action === 'sl' ? 'Stop Loss' : 'Take Profit'}</button></div>}{error && <p className="mt-3 text-xs text-bear-bright" role="alert">{error}</p>}</div>;
}
function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-[11px] font-medium text-ink-faint">{label}<input inputMode="decimal" type="number" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-base px-3 font-mono text-sm text-ink outline-none focus:border-accent" /></label>; }
function Metric({ label, value }: { label: string; value: ReactNode }) { return <div><dt className="text-[10px] uppercase tracking-[0.09em] text-ink-faint">{label}</dt><dd className="mt-0.5 text-right text-xs text-ink">{value}</dd></div>; }
function readableSizingReason(reason: string) { return ({ 'no-stop': 'A stop loss is required for risk sizing.', 'stop-on-wrong-side': 'Stop loss is on the wrong side of entry.', 'insufficient-margin': 'Insufficient margin for this risk size.' } as Record<string, string>)[reason] ?? 'Enter valid trade values.'; }