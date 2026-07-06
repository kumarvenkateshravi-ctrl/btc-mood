// Volume Distribution Zones — indicator glue: adapts the pure vdEngine to the
// chart framework (bands + weighted-average lines + signals + trade levels).
// Original MyCryptoStack engine; see vdEngine.ts for the methodology note.

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorPlot, SignalSide, BandZoneStyle } from '../indicatorFramework';
import type { HtfPeriod } from './htf';
import { resolveInputs } from './itsTemplates';
import {
  buildVdZones, generateVdSignals, vdAtr, VD_DEFAULTS,
  type VdZone, type VdSignal, type VdConfig,
} from './vdEngine';
import { decide } from '../context/decisionEngine';
import { latestMarketContext, publishVdDecisions } from '../context/contextStore';
import { DEFAULT_DECISION_CONFIG, type Decision, type Rejection } from '../context/types';

interface VdInputs {
  tf1: string; tf2: string; tf3: string;
  thrBase: number; volMult: number; maxRetests: number;
  minHealth: number; confidenceFloor: number; minRR: number;
  slBufferAtr: number; acceptanceBars: number; trendFilter: boolean;
  showSupply: boolean; showDemand: boolean; showWavg: boolean;
  showSignals: boolean; showTradeLevels: boolean; showLabels: boolean;
  useContextGate: boolean; minDecisionScore: number;
}

const VDI_DEFAULTS: VdInputs = {
  tf1: 'D', tf2: '4H', tf3: 'None',
  thrBase: 10, volMult: 1.2, maxRetests: 3,
  minHealth: 40, confidenceFloor: 50, minRR: 1.2,
  slBufferAtr: 0.25, acceptanceBars: 3, trendFilter: true,
  showSupply: true, showDemand: true, showWavg: true,
  showSignals: true, showTradeLevels: true, showLabels: true,
  useContextGate: true, minDecisionScore: 65,
};

// Structure palette (matches the platform's zone colors: supply blue / demand
// orange, per-TF tone).
const SUPPLY_RGB: Record<string, string> = { '4H': '122,160,255', D: '79,127,255', W: '61,105,224', M: '50,88,196' };
const DEMAND_RGB: Record<string, string> = { '4H': '255,181,102', D: '255,159,54', W: '230,136,38', M: '204,117,30' };

const CLASS_LABEL: Record<VdZone['classification'], string> = {
  institutional: 'Inst', exhaustion: 'Exh', major: 'Major', minor: '',
};

const resolveTfs = (inp: VdInputs): HtfPeriod[] =>
  [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod => t === '4H' || t === 'D' || t === 'W' || t === 'M');

function toEngineConfig(inp: VdInputs, tfs: HtfPeriod[]): VdConfig {
  return {
    ...VD_DEFAULTS,
    tfs,
    thrBase: inp.thrBase, volMult: inp.volMult, maxRetests: inp.maxRetests,
    minHealth: inp.minHealth, confidenceFloor: inp.confidenceFloor, minRR: inp.minRR,
    slBufferAtr: inp.slBufferAtr, acceptanceBarsLimit: inp.acceptanceBars,
    trendFilter: inp.trendFilter,
  };
}

// Zones + signals only change when a bar CLOSES (the engine never evaluates
// the forming bar), so cache on a closed-bar signature to keep intrabar
// WebSocket ticks O(1) — the same guard that fixed the sd_signals chart hang.
const _cache = new Map<string, { zones: VdZone[]; sigs: VdSignal[] }>();

function computeCached(candles: Candle[], inp: VdInputs, tfs: HtfPeriod[]): { zones: VdZone[]; sigs: VdSignal[] } {
  const n = candles.length;
  const key = `${n}|${candles[0]?.time ?? 0}|${n > 1 ? candles[n - 2].time : 0}|${JSON.stringify(inp)}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const cfg = toEngineConfig(inp, tfs);
  const zones = buildVdZones(candles, cfg);
  const sigs = generateVdSignals(candles, zones, cfg);
  if (_cache.size > 8) _cache.clear();
  _cache.set(key, { zones, sigs });
  return { zones, sigs };
}

/** Emission boundary for future consumers (dashboard, analytics, AI layer). */
export function computeVdZoneObjects(candles: Candle[], config?: CustomIndicatorConfig): { zones: VdZone[]; sigs: VdSignal[] } {
  const inp = resolveInputs<VdInputs>(config, VDI_DEFAULTS);
  const tfs = resolveTfs(inp);
  if (candles.length === 0 || tfs.length === 0) return { zones: [], sigs: [] };
  return computeCached(candles, inp, tfs);
}

export function computeVolumeDistributionZones(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<VdInputs>(config, VDI_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const tfs = resolveTfs(inp);
  if (n === 0 || tfs.length === 0) return { plots: [], signals };

  const { zones, sigs } = computeCached(candles, inp, tfs);

  // MTF confirmation (Market Context Engine): candidates pass the Decision
  // Engine when the gate is on. decide() degrades gracefully when no context
  // has been published (tests, cold start): neutral 50s, HTF/bias gates off.
  let decisions: Decision[] = [];
  let rejections: Rejection[] = [];
  let accepted: VdSignal[] = sigs;
  if (inp.useContextGate) {
    const atr = vdAtr(candles);
    const out = decide(
      sigs,
      latestMarketContext(),
      { ...DEFAULT_DECISION_CONFIG, minDecisionScore: inp.minDecisionScore },
      (i) => atr[i],
    );
    decisions = out.decisions;
    rejections = out.rejections;
    accepted = decisions.map((d) => d.signal);
  }
  publishVdDecisions({ decisions, rejections, gated: inp.useContextGate });

  const plots: IndicatorPlot[] = [];
  const levels: IndicatorLevel[] = [];
  const lastClose = candles[n - 1].close;

  // Focus: nearest healthy ACTIVE zone to price across all (tf, kind).
  let focusId: string | null = null;
  let focusDist = Infinity;
  for (const z of zones) {
    if (z.endIndex != null || z.health < inp.minHealth) continue;
    const d = lastClose >= z.lower && lastClose <= z.upper
      ? 0
      : Math.min(Math.abs(lastClose - z.upper), Math.abs(lastClose - z.lower));
    if (d < focusDist) { focusDist = d; focusId = z.id; }
  }

  for (const tf of tfs) {
    for (const kind of ['supply', 'demand'] as const) {
      const show = kind === 'supply' ? inp.showSupply : inp.showDemand;
      const kindZones = zones
        .filter((z) => z.tf === tf && z.kind === kind)
        .sort((a, b) => a.formedAtIndex - b.formedAtIndex);
      const rgb = kind === 'supply' ? SUPPLY_RGB[tf] : DEMAND_RGB[tf];

      const band = new Array<{ upper: number; lower: number } | null>(n).fill(null);
      const wavg = new Array<number | null>(n).fill(null);
      for (const z of kindZones) {
        const to = Math.min(z.endIndex ?? n - 1, n - 1);
        for (let i = z.formedAtIndex; i <= to; i++) {
          if (show) band[i] = { upper: z.upper, lower: z.lower };
          if (inp.showWavg) wavg[i] = z.weightedAverage;
        }
      }

      const latest = kindZones[kindZones.length - 1];
      const active = latest && latest.endIndex == null ? latest : null;
      const zoneStyle: BandZoneStyle = {
        boundary: kind === 'supply' ? 'lower' : 'upper',
        lineStyle: tf === '4H' ? 'dashed' : 'solid',
        mid: true,
        emphasis: (active?.confidence ?? 50) / 100,
        focus: active != null && active.id === focusId,
      };
      if (inp.showLabels && active) {
        const cls = CLASS_LABEL[active.classification];
        const kindTxt = kind === 'supply' ? 'Supply' : 'Demand';
        zoneStyle.label = `${tf} ${kindTxt}${cls ? ` · ${cls}` : ''} · ${active.confidence}`;
      }
      if (inp.showSignals) {
        const anchors = accepted.filter((s) => s.zoneId.startsWith(`${tf}:${kind}:`)).map((s) => s.index);
        if (anchors.length) zoneStyle.anchors = anchors;
      }

      const bandId = `${tf} ${kind === 'supply' ? 'Supply' : 'Demand'}`;
      plots.push({ id: bandId, title: bandId, color: `rgba(${rgb},0.10)`, type: 'band', pane: 'overlay', data: band, zoneStyle });
      plots.push({ id: `${bandId} WAvg`, title: `${bandId} WAvg`, color: `rgba(${rgb},0.85)`, type: 'line', pane: 'overlay', lineWidth: 1, data: wavg });
    }
  }

  // Arrows via the standard per-bar signal path (context-gated when enabled).
  if (inp.showSignals) {
    for (const s of accepted) signals[s.index] = s.side;
  }

  // Trade levels for the most recent accepted signal, labeled with its grade.
  const last = accepted[accepted.length - 1];
  if (last && inp.showTradeLevels) {
    const sideTxt = last.side === 'buy' ? 'BUY' : 'SELL';
    const d = decisions.find((x) => x.signal === last);
    const title = d
      ? `${sideTxt} · ${d.grade} · ${Math.round(d.decisionScore)}${last.swept ? ' · sweep' : ''}`
      : `${sideTxt} · ${Math.round(last.confidence)}${last.swept ? ' · sweep' : ''}`;
    levels.push({ value: last.entry, color: '#26c6da', lineStyle: 'solid', lineWidth: 2, title });
    levels.push({ value: last.stopLoss, color: '#f23645', lineStyle: 'solid', lineWidth: 1, title: `SL ${last.stopLoss.toFixed(1)}` });
    levels.push({ value: last.tp1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${last.tp1.toFixed(1)}` });
    levels.push({ value: last.tp2, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP2 ${last.tp2.toFixed(1)}` });
    levels.push({ value: last.tp3, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP3 ${last.tp3.toFixed(1)}` });
  }

  return { plots, signals, levels };
}
