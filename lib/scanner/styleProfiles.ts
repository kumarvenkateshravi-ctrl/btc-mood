// Trading-style profiles (Strategy Studio M2) — the platform asks "which
// trader are you?" instead of "which indicator do you want?". Selecting a
// style adapts the builder: timeframe ladder, suggested condition sources,
// exit defaults, and the honest signal-cadence expectation the validator
// checks strategies against. Pure data; no UI imports.

import type { Timeframe } from '../types';
import type { ScannerStrategy } from './types';

export type TraderStyleId = 'scalper' | 'intraday' | 'swing' | 'position' | 'smc' | 'custom';

export interface TraderStyleProfile {
  id: TraderStyleId;
  name: string;
  /** One-line trading description (never an engineering one). */
  blurb: string;
  /** Primary = signal TF; confirmation and higher-trend gate the entry. */
  ladder: { primary: Timeframe; confirmation: Timeframe; higherTrend: Timeframe };
  /** Source ids surfaced first in the condition picker. */
  suggestedSources: string[];
  exits: ScannerStrategy['exits'];
  /** Honest expectation shown to the trader and used by the cadence lint. */
  cadence: { label: string; min: number; max: number; per: 'day' | 'week' | 'month' };
}

export const TRADER_STYLES: TraderStyleProfile[] = [
  {
    id: 'scalper',
    name: 'Scalper',
    blurb: 'Dozens of fast trades a day riding short bursts of momentum.',
    ladder: { primary: '5m', confirmation: '15m', higherTrend: '1h' },
    suggestedSources: ['ema', 'vwap', 'volume', 'atr', 'rsi'],
    exits: { slAtr: 1, tp1R: 1, tp2R: 1.5, tp3R: 2 },
    cadence: { label: '15–30 signals/day', min: 15, max: 30, per: 'day' },
  },
  {
    id: 'intraday',
    name: 'Intraday',
    blurb: 'A few quality trades per session, flat by the end of the day.',
    ladder: { primary: '15m', confirmation: '1h', higherTrend: '4h' },
    suggestedSources: ['ema', 'vwap', 'rsi', 'macd', 'volume'],
    exits: { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    cadence: { label: '2–6 signals/day', min: 2, max: 6, per: 'day' },
  },
  {
    id: 'swing',
    name: 'Swing',
    blurb: 'Hold for days, entering where structure and liquidity agree.',
    ladder: { primary: '4h', confirmation: '1d', higherTrend: '1d' },
    suggestedSources: ['smc', 'ema', 'structure', 'volume', 'atr'],
    exits: { slAtr: 2, tp1R: 1.5, tp2R: 3, tp3R: 5 },
    cadence: { label: '2–6 signals/week', min: 2, max: 6, per: 'week' },
  },
  {
    id: 'position',
    name: 'Position',
    blurb: 'Ride the macro trend for weeks; few, high-conviction entries.',
    ladder: { primary: '1d', confirmation: '1d', higherTrend: '1d' },
    suggestedSources: ['ema', 'structure', 'smc', 'obv'],
    exits: { slAtr: 3, tp1R: 2, tp2R: 4, tp3R: 8 },
    cadence: { label: '1–4 signals/month', min: 1, max: 4, per: 'month' },
  },
  {
    id: 'smc',
    name: 'SMC Trader',
    blurb: 'Trade the institutional sequence: sweep → CHoCH → BOS → order block retest.',
    ladder: { primary: '15m', confirmation: '1h', higherTrend: '1d' },
    suggestedSources: ['smc', 'structure', 'volume', 'ema'],
    exits: { slAtr: 1.5, tp1R: 2, tp2R: 3, tp3R: 4 },
    cadence: { label: '3–8 signals/week', min: 3, max: 8, per: 'week' },
  },
  {
    id: 'custom',
    name: 'Custom',
    blurb: 'Blank slate — you choose every timeframe, source and exit.',
    ladder: { primary: '15m', confirmation: '1h', higherTrend: '1d' },
    suggestedSources: [],
    exits: { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    cadence: { label: 'your call', min: 0, max: Infinity, per: 'week' },
  },
];

export function getStyleProfile(id: TraderStyleId): TraderStyleProfile {
  return TRADER_STYLES.find((s) => s.id === id) ?? TRADER_STYLES[TRADER_STYLES.length - 1];
}
