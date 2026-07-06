// Technical Scanner — chart overlay indicator. A pure VIEW of the published
// scanner snapshot (the page-level engine generates; this only renders):
// BUY/SELL arrows, entry/SL/TP1-3 levels for the selected/latest signal,
// R:R boxes with outcome chips per trade — every layer individually
// toggleable, plus per-strategy visibility from the strategy store.

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorPlot, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { latestScannerSnapshot, selectedScannerSignalId } from '../scanner/scannerUiStore';

interface ScannerOverlayInputs {
  showSignals: boolean;
  showTradeLevels: boolean;
  showRRBoxes: boolean;
  showOutcomeChips: boolean;
  showHistorical: boolean; // all trades vs the last 10
}

const DEFAULTS: ScannerOverlayInputs = {
  showSignals: true, showTradeLevels: true, showRRBoxes: true,
  showOutcomeChips: true, showHistorical: true,
};

const STATUS_TXT: Record<string, string> = {
  active: 'open', tp1: 'TP1 · open', tp2: 'TP2 · open', tp3: 'TP3', stopped: 'SL', exit: 'exit',
};

export function computeScannerSignals(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<ScannerOverlayInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const levels: IndicatorLevel[] = [];
  const plots: IndicatorPlot[] = [];
  const snap = latestScannerSnapshot();

  const riskBox = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  const rewardBox = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  const outcomeLabels: Record<number, string> = {};
  let emphasisRunStart: number | null = null;

  if (snap && n > 0) {
    const visible = snap.trades.filter((t) => snap.byStrategy[t.signal.strategyId]?.chartVisible !== false);
    const drawSet = inp.showHistorical ? visible : visible.slice(-10);
    const selId = selectedScannerSignalId();
    const selected = selId ? visible.find((t) => t.signal.id === selId) : undefined;
    const drawn = new Set(drawSet);
    if (selected) drawn.add(selected);

    for (const t of drawn) {
      const s = t.signal;
      if (s.index >= n) continue;
      if (inp.showSignals) signals[s.index] = s.side;
      if (t.signal.id === selId) emphasisRunStart = t.entryIndex;
      if (inp.showRRBoxes) {
        const to = Math.min(t.resolvedIndex ?? n - 1, n - 1);
        for (let i = t.entryIndex; i <= to; i++) {
          riskBox[i] = { upper: Math.max(s.entry, t.slCurrent), lower: Math.min(s.entry, t.slCurrent) };
          rewardBox[i] = { upper: Math.max(s.entry, s.tp1), lower: Math.min(s.entry, s.tp1) };
        }
      }
      if (inp.showOutcomeChips) {
        const dir = s.side === 'buy' ? 1 : -1;
        outcomeLabels[t.entryIndex] = t.exitPrice != null
          ? `${dir * (t.exitPrice - s.entry) >= 0 ? '+' : ''}${(dir * (t.exitPrice - s.entry)).toFixed(1)} pts`
          : STATUS_TXT[t.status] ?? t.status;
      }
    }

    // Level lines: the selected trade, else the most recent visible one.
    const focus = selected ?? drawSet[drawSet.length - 1];
    if (focus && inp.showTradeLevels) {
      const s = focus.signal;
      const name = snap.byStrategy[s.strategyId]?.name ?? s.strategyId;
      const sideTxt = s.side === 'buy' ? 'BUY' : 'SELL';
      levels.push({ value: s.entry, color: '#26c6da', lineStyle: 'solid', lineWidth: 2, title: `${sideTxt} ${name} · ${s.confidence}` });
      levels.push({ value: focus.slCurrent, color: '#f23645', lineStyle: 'solid', lineWidth: 1, title: `SL ${focus.slCurrent.toFixed(1)}` });
      levels.push({ value: s.tp1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${s.tp1.toFixed(1)}` });
      levels.push({ value: s.tp2, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP2 ${s.tp2.toFixed(1)}` });
      levels.push({ value: s.tp3, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP3 ${s.tp3.toFixed(1)}` });
    }
  }

  plots.push({ id: 'Scan Risk', title: 'Scan Risk', color: 'rgba(242,54,69,0.07)', type: 'band', pane: 'overlay', data: riskBox, zoneStyle: { flatLabels: {}, emphasisRunStart } });
  plots.push({ id: 'Scan Reward', title: 'Scan Reward', color: 'rgba(38,198,218,0.08)', type: 'band', pane: 'overlay', data: rewardBox, zoneStyle: { flatLabels: outcomeLabels, emphasisRunStart } });

  return { plots, signals, levels };
}
