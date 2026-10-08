import { computeMaRibbonTV } from './indicators/maRibbonTV';
import { computeMacd } from './indicators/macd';
import { computeBollingerBands } from './indicators/bollingerBands';
import { computeRsi } from './indicators/rsi';
import { computeAtr } from './indicators/atr';
import { computeParabolicSar } from './indicators/parabolicSar';
import { computeStochastic } from './indicators/stochastic';
import { computeKeltnerChannels } from './indicators/keltnerChannels';
import { computeObv } from './indicators/obv';
import { computeVolume } from './indicators/volume';
import { computeVwap } from './indicators/vwap';
import { computeAdx } from './indicators/adx';
import { computeSuperTrend } from './indicators/superTrend';
import { computeVwapBands } from './indicators/vwapBands';
import { computeWilliamsR } from './indicators/williamsR';
import { computeSma } from './indicators/sma';
import { computeSmcOverlay } from './indicators/smcOverlay';
import { computeMaFvg } from './indicators/maFvg';
import { computeSessionVolumeProfile } from './indicators/sessionVolumeProfile';
import { computeDsmartOverlay } from './indicators/dsmartOverlay';
import { computePocMrpZones } from './indicators/pocMrpZones';
import { incrementalSma, incrementalObv, incrementalVwap, incrementalAtr } from './indicators/incremental';
import { incrementalSessionVolumeProfile } from './indicators/sessionVolumeProfileIncremental';

import type { IndicatorInputDef, IndicatorStyleDef, IndicatorComputeFn, IndicatorEvaluationDeclaration } from './indicatorFramework';
import type { IncrementalIndicatorFactory } from './incrementalIndicatorEngine';

export interface CustomIndicatorDef {
  id: string;
  name: string;
  description: string;
  compute: IndicatorComputeFn;
  evaluation?: IndicatorEvaluationDeclaration;
  incremental?: IncrementalIndicatorFactory;
  inputs?: IndicatorInputDef[];
  styles?: IndicatorStyleDef[];
}

/** Shared price-source options for `type: 'source'` inputs (dropdowns need these). */
const SRC_OPTS = [
  { value: 'close', label: 'Close' }, { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' }, { value: 'low', label: 'Low' },
  { value: 'hl2', label: 'HL2' }, { value: 'hlc3', label: 'HLC3' }, { value: 'ohlc4', label: 'OHLC4' },
];

const POC_MRP_ZONE_STYLES: IndicatorStyleDef[] = [
  { id: 'mrp', name: 'MRP', color: '#0B46F0', thickness: 2, lineStyle: 'solid', display: true },
  { id: 'weekly_mrp', name: 'W MRP', color: '#C57A00', thickness: 1, lineStyle: 'solid', display: true },
  { id: 'weekly_poc', name: 'Weekly POC', color: '#F59E0B', thickness: 2, lineStyle: 'solid', display: true },
  { id: 'daily_poc', name: 'Daily POC', color: '#14532D', thickness: 2, lineStyle: 'solid', display: true },
  { id: 'four_hour_poc', name: '4-Hour POC', color: '#22D3EE', thickness: 2, lineStyle: 'solid', display: true },
  { id: 'one_hour_poc', name: '1-Hour POC', color: '#A855F7', thickness: 2, lineStyle: 'solid', display: true },
];

for (const [prefix, heading, entries] of [
  ['h4', '4H', [
    ['strong_demand', 'Strong Demand', '#388E3C', 'rgba(56,142,60,0.25)'],
    ['weak_demand', 'Weak Demand', '#76B852', 'rgba(118,184,82,0.18)'],
    ['weak_supply', 'Weak Supply', '#FB8C00', 'rgba(251,140,0,0.18)'],
    ['strong_supply', 'Strong Supply', '#E53935', 'rgba(229,57,53,0.25)'],
  ]],
  ['daily', 'Daily', [
    ['strong_demand', 'Strong Demand', '#00838F', 'rgba(0,131,143,0.25)'],
    ['weak_demand', 'Weak Demand', '#00BCD4', 'rgba(0,188,212,0.18)'],
    ['weak_supply', 'Weak Supply', '#E91E63', 'rgba(233,30,99,0.18)'],
    ['strong_supply', 'Strong Supply', '#AD1457', 'rgba(173,20,87,0.25)'],
  ]],
  ['weekly', 'Weekly', [
    ['strong_demand', 'Strong Demand', '#1565C0', 'rgba(21,101,192,0.25)'],
    ['weak_demand', 'Weak Demand', '#42A5F5', 'rgba(66,165,245,0.18)'],
    ['weak_supply', 'Weak Supply', '#AB47BC', 'rgba(171,71,188,0.18)'],
    ['strong_supply', 'Strong Supply', '#6A1B9A', 'rgba(106,27,154,0.25)'],
  ]],
] as const) {
  for (const [suffix, label, lineColor, fillColor] of entries) {
    POC_MRP_ZONE_STYLES.push(
      { id: `${prefix}_${suffix}_lower`, name: `${heading} — ${label} Lower`, color: lineColor, thickness: 1, lineStyle: 'solid', display: true },
      { id: `${prefix}_${suffix}_upper`, name: `${heading} — ${label} Upper`, color: lineColor, thickness: 1, lineStyle: 'solid', display: true },
      { id: `${prefix}_${suffix}_background`, name: `${heading} — ${label} Background`, color: fillColor, thickness: 1, lineStyle: 'solid', display: true, isFill: true },
    );
  }
}

const RAW_CUSTOM_INDICATORS: CustomIndicatorDef[] = [
  {
    id: 'poc_mrp_zones',
    name: 'POC & MRP + Demand & Supply Zones',
    description: 'Developing Daily/Weekly MRP, confirmed 1H/4H POC segments, Daily/Weekly POCs, and ATR-calibrated 4H/Daily/Weekly demand and supply zones.',
    inputs: [
      { id: 'show4hZones', name: 'Show Layer 1 — 4H Zones', type: 'boolean', default: true, group: 'FIXED ZONE LAYERS' },
      { id: 'showDailyZones', name: 'Show Layer 2 — Daily Zones', type: 'boolean', default: true, group: 'FIXED ZONE LAYERS' },
      { id: 'showWeeklyZones', name: 'Show Layer 3 — Weekly Zones', type: 'boolean', default: true, group: 'FIXED ZONE LAYERS' },
      { id: 'showMrp', name: 'Show MRP', type: 'boolean', default: true, group: 'MRP' },
      { id: 'showWeeklyMrp', name: 'W MRP', type: 'boolean', default: true, group: 'MRP' },
      { id: 'showWeeklyPoc', name: 'Show Weekly POC', type: 'boolean', default: true, group: 'POC LINES' },
      { id: 'showDailyPoc', name: 'Show Daily POC', type: 'boolean', default: true, group: 'POC LINES' },
      { id: 'showFourHourPoc', name: 'Show 4-Hour POC', type: 'boolean', default: true, group: 'POC LINES' },
      { id: 'showOneHourPoc', name: 'Show 1-Hour POC', type: 'boolean', default: true, group: 'POC LINES' },
      { id: 'oneHourPocHistoryDays', name: '1-Hour POC History (Days)', type: 'number', default: 3, min: 1, max: 15, step: 1, group: 'POC LINES' },
      { id: 'pocLineWidth', name: 'POC Line Width', type: 'number', default: 2, min: 1, max: 4, step: 1, group: 'POC LINES' },
    ],
    styles: POC_MRP_ZONE_STYLES,
    compute: computePocMrpZones,
  },
  {
    id: 'session_volume_profile',
    name: 'Volume Profile (SVP HD)',
    description:
      'Session Volume Profile — volume by price per session, with POC, value area, and automatic profile-shape classification.',
    inputs: [
      {
        id: 'sessions',
        name: 'Sessions',
        type: 'select',
        default: 'daily',
        // Crypto trades 24/7, so TradingView's pre-/post-market options have no
        // meaning here. Fixed-period sessions replace them; Custom is unchanged.
        // Ordered shortest → longest so the list reads as a duration scale.
        options: [
          { value: '15m', label: '15 minutes' },
          { value: '30m', label: '30 minutes' },
          { value: '1h', label: '1 hour' },
          { value: '4h', label: '4 hours' },
          { value: 'daily', label: 'Daily (UTC)' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'visible', label: 'Visible range' },
          { value: 'custom', label: 'Custom' },
        ],
      },
      {
        id: 'customStartHour',
        name: 'Custom start (hour)',
        type: 'number',
        default: 9,
        min: 0,
        max: 23,
        step: 1,
        tooltip: 'UTC hour the custom session opens',
        disabledIf: (i) => i['sessions'] !== 'custom',
      },
      {
        id: 'customEndHour',
        name: 'Custom end (hour)',
        type: 'number',
        default: 16,
        min: 0,
        max: 23,
        step: 1,
        tooltip: 'UTC hour the custom session closes. An end before the start wraps past midnight.',
        disabledIf: (i) => i['sessions'] !== 'custom',
      },
      {
        id: 'volume',
        name: 'Volume',
        type: 'select',
        default: 'updown',
        options: [
          { value: 'total', label: 'Total' },
          { value: 'updown', label: 'Up/Down' },
          { value: 'delta', label: 'Estimated Directional Delta' },
        ],
      },
      {
        id: 'valueAreaVolume',
        name: 'Value Area Volume',
        type: 'number',
        default: 70,
        min: 1,
        max: 100,
        step: 1,
        tooltip: 'Percentage of session volume highlighted as the value area',
      },
      {
        id: 'rowsLayout',
        name: 'Rows Layout',
        type: 'select',
        default: 'rows',
        options: [
          { value: 'rows', label: 'Number of Rows' },
          { value: 'ticks', label: 'Ticks Per Row' },
        ],
        group: 'ROWS',
      },
      {
        id: 'rowSize',
        name: 'Row Size',
        type: 'number',
        default: 24,
        min: 1,
        max: 500,
        step: 1,
        group: 'ROWS',
        tooltip: 'Row count, or ticks per row, depending on Rows Layout',
      },
      {
        id: 'showProfileBoxes',
        name: 'Show Volume Profile Boxes',
        type: 'boolean',
        default: true,
        group: 'LEVELS',
        tooltip: 'Hide the volume histogram, value-area levels, and shape label while keeping the POC visible.',
      },
      { id: 'showWeeklyPocs', name: 'Show Weekly POCs', type: 'boolean', default: false, group: 'LEVELS' },
      { id: 'showDailyPocs', name: 'Show Daily POCs', type: 'boolean', default: false, group: 'LEVELS' },
      { id: 'show4hPocs', name: 'Show 4H POCs', type: 'boolean', default: false, group: 'LEVELS' },
      { id: 'extendPoc', name: 'Extend POC Right', type: 'boolean', default: false, group: 'LEVELS' },
      { id: 'extendVah', name: 'Extend VAH Right', type: 'boolean', default: false, group: 'LEVELS' },
      { id: 'extendVal', name: 'Extend VAL Right', type: 'boolean', default: false, group: 'LEVELS' },
      {
        id: 'placement',
        name: 'Placement',
        type: 'select',
        default: 'left',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
        group: 'APPEARANCE',
      },
      {
        id: 'widthPct',
        name: 'Width (% of the box)',
        type: 'number',
        default: 30,
        min: 1,
        max: 100,
        step: 1,
        group: 'APPEARANCE',
      },
      { id: 'showValues', name: 'Values', type: 'boolean', default: false, group: 'APPEARANCE' },
      {
        id: 'showShapeLabel',
        name: 'Show shape label',
        type: 'boolean',
        default: true,
        group: 'APPEARANCE',
        tooltip: 'Classify each profile (P / b / D / Double Distribution / Trend / Extreme) and label it',
      },
    ],
    styles: [
      { id: 'upVolume', name: 'Up Volume', color: 'rgba(8, 153, 129, 0.45)', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
      { id: 'downVolume', name: 'Down Volume', color: 'rgba(242, 54, 69, 0.45)', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
      { id: 'valueAreaUp', name: 'Value Area Up', color: 'rgba(0, 188, 212, 0.65)', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
      { id: 'valueAreaDown', name: 'Value Area Down', color: 'rgba(233, 30, 99, 0.65)', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
      { id: 'poc', name: 'POC', color: '#f0b90b', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'weeklyPoc', name: 'Weekly POC', color: '#a855f7', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'dailyPoc', name: 'Daily POC', color: '#f0b90b', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'fourHourPoc', name: '4H POC', color: '#00bcd4', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'confluence', name: '4H + Daily + Weekly Confluence (C)', color: '#ffffff', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'vwapConfluence', name: 'Session + Weekly VWAP Confluence (V)', color: '#42a5f5', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'vah', name: 'VAH', color: '#787b86', thickness: 1, lineStyle: 'dashed', display: false },
      { id: 'val', name: 'VAL', color: '#787b86', thickness: 1, lineStyle: 'dashed', display: false },
    ],
    compute: computeSessionVolumeProfile,
    incremental: incrementalSessionVolumeProfile,
  },
  {
    id: 'sma',
    name: 'SMA',
    description: 'Simple Moving Average',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 9, min: 1, max: 1000, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
      { id: 'offset', name: 'Offset', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { id: 'smoothingType', name: 'Type', type: 'select', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'sma', label: 'SMA' }, { value: 'sma_bb', label: 'SMA + Bollinger Bands' }, { value: 'ema', label: 'EMA' }], group: 'SMOOTHING' },
      { id: 'smoothingLength', name: 'Length', type: 'number', default: 14, min: 1, max: 1000, step: 1, group: 'SMOOTHING', disabledIf: (inputs) => inputs['smoothingType'] === 'none' },
      { id: 'bbStdDev', name: 'BB StdDev', type: 'number', default: 2.0, min: 0.1, max: 10.0, step: 0.1, group: 'SMOOTHING', tooltip: 'Bollinger Bands Standard Deviation', disabledIf: (inputs) => inputs['smoothingType'] === 'none' },
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart', options: [{ value: 'chart', label: 'Chart' }, { value: '1d', label: '1 Day' }], group: 'CALCULATION', tooltip: 'Timeframe for the indicator' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION' },
    ],
    styles: [
      { id: 'smaLine', name: 'SMA', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeSma,
    incremental: incrementalSma,
  },
  {
    id: 'ma_ribbon_tv',
    name: 'Moving Average Ribbon',
    description: 'Port of the TradingView built-in MA Ribbon. Four independently-togglable MAs (SMA/EMA/SMMA/WMA/VWMA), each with configurable type and length. Optional higher-timeframe calculation (5m/15m/1h/4h/1d). Defaults: SMA 20/50/100/200.',
    inputs: [
      // MA #1
      { id: 'showMa1',   name: 'MA #1',   type: 'boolean', default: true,   group: 'MA #1' },
      { id: 'ma1Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #1',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa1'] },
      { id: 'ma1Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #1',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa1'] },
      { id: 'ma1Length', name: 'Length',  type: 'number',  default: 20, min: 1, max: 2000, step: 1,
        group: 'MA #1', disabledIf: (i) => !i['showMa1'] },
      // MA #2
      { id: 'showMa2',   name: 'MA #2',   type: 'boolean', default: true,   group: 'MA #2' },
      { id: 'ma2Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #2',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa2'] },
      { id: 'ma2Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #2',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa2'] },
      { id: 'ma2Length', name: 'Length',  type: 'number',  default: 50, min: 1, max: 2000, step: 1,
        group: 'MA #2', disabledIf: (i) => !i['showMa2'] },
      // MA #3
      { id: 'showMa3',   name: 'MA #3',   type: 'boolean', default: true,   group: 'MA #3' },
      { id: 'ma3Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #3',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa3'] },
      { id: 'ma3Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #3',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa3'] },
      { id: 'ma3Length', name: 'Length',  type: 'number',  default: 100, min: 1, max: 2000, step: 1,
        group: 'MA #3', disabledIf: (i) => !i['showMa3'] },
      // MA #4
      { id: 'showMa4',   name: 'MA #4',   type: 'boolean', default: true,   group: 'MA #4' },
      { id: 'ma4Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #4',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa4'] },
      { id: 'ma4Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #4',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa4'] },
      { id: 'ma4Length', name: 'Length',  type: 'number',  default: 200, min: 1, max: 2000, step: 1,
        group: 'MA #4', disabledIf: (i) => !i['showMa4'] },
      // CALCULATION
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart',
        options: [
          { value: 'chart', label: 'Chart' },
          { value: '5m', label: '5 minutes' },
          { value: '15m', label: '15 minutes' },
          { value: '1h', label: '1 hour' },
          { value: '4h', label: '4 hours' },
          { value: '1d', label: '1 day' },
        ],
        group: 'CALCULATION', tooltip: 'Compute the ribbon on a higher timeframe, then project onto the chart bars.' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION',
        tooltip: 'Only reveal a higher-timeframe value once that bar has closed (non-repainting).' },
    ],
    styles: [
      { id: 'ma_1', name: 'MA #1', color: '#f6c309', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_2', name: 'MA #2', color: '#fb9800', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_3', name: 'MA #3', color: '#fb6500', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_4', name: 'MA #4', color: '#f60c0c', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
    ],
    compute: computeMaRibbonTV,
  },
  {
    id: 'ma_fvg',
    name: 'Moving Averages & FVG',
    description: 'Port of the "MA Ribbon + VWAP + FVG + RSI" overlay: a 4-MA ribbon, anchored VWAP with σ/percentage bands plus an independent VWAP-1, MA+VWAP confluence markers, LuxAlgo Fair Value Gap boxes with mitigation, and a price-scaled RSI overlay with Buy/Sell signals. FVG module © LuxAlgo (CC BY-NC-SA 4.0, NonCommercial).',
    inputs: [
      ...[1, 2, 3, 4].flatMap((k) => {
        const g = `MA #${k}`;
        const len = [20, 50, 100, 200][k - 1];
        const dis = (i: Record<string, unknown>) => !i[`showMa${k}`];
        return [
          { id: `showMa${k}`, name: g, type: 'boolean' as const, default: true, group: g },
          { id: `ma${k}Type`, name: 'Type', type: 'select' as const, default: 'SMA', group: g,
            options: ['SMA', 'EMA', 'SMMA (RMA)', 'WMA', 'VWMA'].map((v) => ({ value: v, label: v })), disabledIf: dis },
          { id: `ma${k}Source`, name: 'Source', type: 'source' as const, default: 'close', group: g, options: SRC_OPTS, disabledIf: dis },
          { id: `ma${k}Length`, name: 'Length', type: 'number' as const, default: len, min: 1, max: 2000, step: 1, group: g, disabledIf: dis },
        ];
      }),
      { id: 'showVwap', name: 'Show VWAP', type: 'boolean', default: true, group: 'VWAP' },
      { id: 'vwapAnchor', name: 'Anchor Period', type: 'select', default: 'session', group: 'VWAP',
        options: ['session', 'week', 'month', 'quarter', 'year'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
      { id: 'vwapSource', name: 'Source', type: 'source', default: 'hlc3', group: 'VWAP', options: SRC_OPTS },
      { id: 'bandsMode', name: 'Bands Calculation Mode', type: 'select', default: 'Standard Deviation', group: 'VWAP',
        options: [{ value: 'Standard Deviation', label: 'Standard Deviation' }, { value: 'Percentage', label: 'Percentage' }] },
      { id: 'showBand1', name: 'Band #1', type: 'boolean', default: true, group: 'VWAP Bands' },
      { id: 'bandMult1', name: 'Multiplier #1', type: 'number', default: 1, min: 0, max: 10, step: 0.5, group: 'VWAP Bands', disabledIf: (i) => !i['showBand1'] },
      { id: 'showBand2', name: 'Band #2', type: 'boolean', default: false, group: 'VWAP Bands' },
      { id: 'bandMult2', name: 'Multiplier #2', type: 'number', default: 2, min: 0, max: 10, step: 0.5, group: 'VWAP Bands', disabledIf: (i) => !i['showBand2'] },
      { id: 'showBand3', name: 'Band #3', type: 'boolean', default: false, group: 'VWAP Bands' },
      { id: 'bandMult3', name: 'Multiplier #3', type: 'number', default: 3, min: 0, max: 10, step: 0.5, group: 'VWAP Bands', disabledIf: (i) => !i['showBand3'] },
      { id: 'showVwap1', name: 'Show VWAP-1', type: 'boolean', default: true, group: 'VWAP-1' },
      { id: 'vwap1Anchor', name: 'Anchor Period', type: 'select', default: 'week', group: 'VWAP-1',
        options: ['session', 'week', 'month', 'quarter', 'year'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
      { id: 'vwap1Source', name: 'Source', type: 'source', default: 'hlc3', group: 'VWAP-1', options: SRC_OPTS },
      { id: 'showVwap1Band', name: 'Band #1', type: 'boolean', default: true, group: 'VWAP-1' },
      { id: 'vwap1BandMult', name: 'Multiplier #1', type: 'number', default: 1, min: 0, max: 10, step: 0.5, group: 'VWAP-1', disabledIf: (i) => !i['showVwap1Band'] },
      { id: 'showConfluence', name: 'Highlight Confluence Candles', type: 'boolean', default: true, group: 'MA + VWAP Confluence' },
      { id: 'fvgThresholdPct', name: 'Threshold %', type: 'number', default: 0, min: 0, max: 100, step: 0.1, group: 'Fair Value Gap' },
      { id: 'fvgAuto', name: 'Auto', type: 'boolean', default: false, group: 'Fair Value Gap' },
      { id: 'fvgExtend', name: 'Extend', type: 'number', default: 20, min: 0, max: 200, step: 1, group: 'Fair Value Gap' },
      { id: 'rsiLength', name: 'Length', type: 'number', default: 9, min: 1, max: 500, step: 1, group: 'RSI Settings' },
      { id: 'rsiSource', name: 'Source', type: 'source', default: 'close', group: 'RSI Settings', options: SRC_OPTS },
      { id: 'scaleMode', name: 'Scale Basis', type: 'select', default: 'Range', group: 'RSI Overlay Scaling',
        options: [{ value: 'Range', label: 'Range' }, { value: 'ATR', label: 'ATR' }] },
      { id: 'scaleLookback', name: 'Price Range Lookback', type: 'number', default: 100, min: 10, max: 1000, step: 1, group: 'RSI Overlay Scaling', disabledIf: (i) => i['scaleMode'] !== 'Range' },
      { id: 'atrLenForScale', name: 'ATR Length', type: 'number', default: 14, min: 1, max: 200, step: 1, group: 'RSI Overlay Scaling', disabledIf: (i) => i['scaleMode'] !== 'ATR' },
      { id: 'atrMultForScale', name: 'ATR Multiplier', type: 'number', default: 4, min: 0.1, max: 20, step: 0.1, group: 'RSI Overlay Scaling', disabledIf: (i) => i['scaleMode'] !== 'ATR' },
      { id: 'baselineType', name: 'Baseline', type: 'select', default: 'SMA of Source', group: 'RSI Overlay Scaling',
        options: [{ value: 'SMA of Source', label: 'SMA of Source' }, { value: 'Current Price', label: 'Current Price' }] },
      { id: 'baselineLen', name: 'Baseline SMA Length', type: 'number', default: 50, min: 1, max: 500, step: 1, group: 'RSI Overlay Scaling', disabledIf: (i) => i['baselineType'] !== 'SMA of Source' },
      { id: 'showSignals', name: 'Show Buy/Sell Signal Markers', type: 'boolean', default: false, group: 'Signals' },
      { id: 'signalCooldownBars', name: 'Signal Cooldown (bars)', type: 'number', default: 5, min: 0, max: 200, step: 1, group: 'Signals', tooltip: 'Suppress a new signal within this many bars of the previous one (0 = off).', disabledIf: (i) => !i['showSignals'] },
      { id: 'signalTrendFilter', name: 'Trend Filter (price vs MA #4)', type: 'boolean', default: false, group: 'Signals', tooltip: 'Only BUY when price is above MA #4, only SELL when below.', disabledIf: (i) => !i['showSignals'] },
    ],
    styles: [
      { id: 'ma_1', name: 'MA #1', color: '#f6c309', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_2', name: 'MA #2', color: '#fb9800', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_3', name: 'MA #3', color: '#fb6500', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_4', name: 'MA #4', color: '#f60c0c', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'vwap', name: 'VWAP', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'vwap1', name: 'VWAP-1', color: '#e91e63', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'confluenceCandle', name: 'Confluence Candle', color: 'rgba(255, 215, 0, 0.45)', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'rsiBaseline', name: 'RSI Baseline', color: 'rgba(120, 124, 139, 0.5)', thickness: 1, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'rsiLine', name: 'RSI (scaled)', color: '#b388ff', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'rsiStrength', name: 'RSI Strength', color: '#ff9800', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'rsiSignal', name: 'RSI Signal', color: '#00b0ff', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
    ],
    compute: computeMaFvg,
  },
  {
    id: 'macd',
    name: 'MACD',
    description: 'Faithful port of TradingView’s built-in MACD: configurable source, fast/slow/signal lengths, and EMA/SMA selection for both the oscillator and the signal line.',
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'number', default: 12, min: 1, max: 200, step: 1 },
      { id: 'slow', name: 'Slow Length', type: 'number', default: 26, min: 1, max: 200, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close',
        options: [
          { value: 'close', label: 'Close' },
          { value: 'open', label: 'Open' },
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
          { value: 'hl2', label: 'HL2' },
          { value: 'hlc3', label: 'HLC3' },
          { value: 'ohlc4', label: 'OHLC4' },
        ] },
      { id: 'signal', name: 'Signal Smoothing', type: 'number', default: 9, min: 1, max: 100, step: 1 },
      { id: 'oscMaType', name: 'Oscillator MA Type', type: 'select', default: 'EMA',
        options: [{ value: 'EMA', label: 'EMA' }, { value: 'SMA', label: 'SMA' }] },
      { id: 'signalMaType', name: 'Signal Line MA Type', type: 'select', default: 'EMA',
        options: [{ value: 'EMA', label: 'EMA' }, { value: 'SMA', label: 'SMA' }] },
    ],
    styles: [
      { id: 'macd', name: 'MACD', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'signal', name: 'Signal', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'hist', name: 'Histogram', color: '#7b88a0', thickness: 4, lineStyle: 'solid', display: true },
    ],
    compute: computeMacd,
  },
  {
    id: 'bollinger_bands',
    name: 'Bollinger Bands (20, 2)',
    description: 'SMA basis ± mult × population stdev. Matches TradingView.',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'StdDev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    styles: [
      { id: 'basis', name: 'Basis', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper', name: 'Upper', color: '#2962FF', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower', name: 'Lower', color: '#2962FF', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeBollingerBands,
  },
  {
    id: 'rsi',
    name: 'RSI',
    description: 'Relative Strength Index with 70/50/30 bands, channel fill, and optional smoothing MA / Bollinger Bands. Matches TradingView.',
    inputs: [
      { id: 'length', name: 'RSI Length', type: 'number', default: 14, min: 1, max: 2000, step: 1, group: 'RSI Settings' },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }], group: 'RSI Settings' },
      { id: 'calculateDivergence', name: 'Calculate Divergence', type: 'boolean', default: false, group: 'RSI Settings', tooltip: 'Show regular bullish/bearish divergence labels.' },
      { id: 'maType', name: 'Type', type: 'select', default: 'SMA', options: [{ value: 'None', label: 'None' }, { value: 'SMA', label: 'SMA' }, { value: 'SMA + Bollinger Bands', label: 'SMA + Bollinger Bands' }, { value: 'EMA', label: 'EMA' }, { value: 'SMMA (RMA)', label: 'SMMA (RMA)' }, { value: 'WMA', label: 'WMA' }, { value: 'VWMA', label: 'VWMA' }], group: 'Smoothing' },
      { id: 'maLength', name: 'Length', type: 'number', default: 14, min: 1, max: 2000, step: 1, group: 'Smoothing', disabledIf: (i) => i['maType'] === 'None' },
      { id: 'bbMult', name: 'BB StdDev', type: 'number', default: 2.0, min: 0.001, max: 50, step: 0.5, group: 'Smoothing', tooltip: 'Only applies when "SMA + Bollinger Bands" is selected.', disabledIf: (i) => i['maType'] !== 'SMA + Bollinger Bands' },
    ],
    styles: [
      { id: 'rsi', name: 'RSI', color: '#7E57C2', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'rsiMa', name: 'RSI-based MA', color: '#FFEB3B', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'bbUpper', name: 'Upper Bollinger Band', color: '#4CAF50', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'bbLower', name: 'Lower Bollinger Band', color: '#4CAF50', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeRsi,
  },
  {
    id: 'atr',
    name: 'ATR (14)',
    description: 'Faithful port of TradingView’s built-in ATR: ta.tr(true) smoothed by RMA/SMA/EMA/WMA (default RMA / Wilder).',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'smoothing', name: 'Smoothing', type: 'select', default: 'RMA',
        options: [
          { value: 'RMA', label: 'RMA' },
          { value: 'SMA', label: 'SMA' },
          { value: 'EMA', label: 'EMA' },
          { value: 'WMA', label: 'WMA' },
        ] },
    ],
    styles: [
      { id: 'atr', name: 'ATR', color: '#ef6c00', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeAtr,
    incremental: incrementalAtr,
  },
  {
    id: 'parabolic_sar',
    name: 'Parabolic SAR',
    description: 'Faithful port of TradingView’s ta.sar (Wilder stop-and-reverse); trend by dot position vs price.',
    inputs: [
      { id: 'start', name: 'Start', type: 'number', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { id: 'increment', name: 'Increment', type: 'number', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { id: 'max', name: 'Maximum', type: 'number', default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    styles: [
      { id: 'psar', name: 'PSAR', color: '#26A69A', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeParabolicSar,
  },
  {
    id: 'stochastic',
    name: 'Stochastic',
    description: 'Faithful port of TradingView’s built-in Stochastic: %K = SMA(ta.stoch, %K smoothing), %D = SMA(%K). TV defaults 14 / 1 / 3, with 80/50/20 bands.',
    inputs: [
      { id: 'kPeriod', name: '%K Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'smoothK', name: '%K Smoothing', type: 'number', default: 1, min: 1, max: 100, step: 1 },
      { id: 'dPeriod', name: '%D Smoothing', type: 'number', default: 3, min: 1, max: 100, step: 1 },
    ],
    styles: [
      { id: 'k', name: '%K', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'd', name: '%D', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeStochastic,
  },
  {
    id: 'keltner_channels',
    name: 'Keltner Channels',
    description: 'EMA basis ± mult × ATR. Matches TradingView (EMA + Wilder ATR).',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Multiplier', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { id: 'atrLength', name: 'ATR Length', type: 'number', default: 10, min: 1, max: 500, step: 1 },
    ],
    styles: [
      { id: 'basis', name: 'Basis', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper', name: 'Upper', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower', name: 'Lower', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeKeltnerChannels,
  },
  {
    id: 'volume',
    name: 'Volume',
    description: 'Per-bar volume, colored by candle direction.',
    inputs: [],
    styles: [
      { id: 'volume', name: 'Volume', color: '#26A69A', thickness: 4, lineStyle: 'solid', display: true },
    ],
    compute: computeVolume,
  },
  {
    id: 'obv',
    name: 'OBV',
    description: 'On-Balance Volume cumulative flow.',
    inputs: [],
    styles: [
      { id: 'obv', name: 'OBV', color: '#5aa2e6', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeObv,
    incremental: incrementalObv,
  },
  {
    id: 'vwap',
    name: 'VWAP',
    description: 'Faithful port of TradingView’s VWAP: Σ(src·vol)/Σvol per anchored period. Source hlc3, anchor Session/Week/Month/Quarter/Year.',
    inputs: [
      { id: 'anchor', name: 'Anchor Period', type: 'select', default: 'session',
        options: [
          { value: 'session', label: 'Session' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ] },
      { id: 'source', name: 'Source', type: 'source', default: 'hlc3',
        options: [
          { value: 'hlc3', label: 'HLC3' },
          { value: 'hl2', label: 'HL2' },
          { value: 'ohlc4', label: 'OHLC4' },
          { value: 'close', label: 'Close' },
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
        ] },
    ],
    styles: [
      { id: 'vwap', name: 'VWAP', color: '#42a5f5', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeVwap,
    incremental: incrementalVwap,
  },
  {
    id: 'adx',
    name: 'ADX (14) — Trend Strength',
    description: "Wilder's Average Directional Index with +DI / -DI.",
    inputs: [
      { id: 'diLength', name: 'DI Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'adxSmoothing', name: 'ADX Smoothing', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    styles: [
      { id: 'adx', name: 'ADX', color: '#eeeeee', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'plusDI', name: '+DI', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'minusDI', name: '-DI', color: '#F23645', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeAdx,
  },
  {
    id: 'supertrend',
    name: 'SuperTrend',
    description: 'ATR-banded trend follower; flips emit buy/sell signals.',
    inputs: [
      { id: 'atrPeriod', name: 'ATR Length', type: 'number', default: 10, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Factor', type: 'number', default: 3, min: 0.1, max: 20, step: 0.1 },
    ],
    styles: [
      { id: 'supertrend', name: 'SuperTrend', color: '#26A69A', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeSuperTrend,
  },
  {
    id: 'dsmart_line',
    name: 'D Smart Line',
    description: 'Adaptive Walking and Running trend lines with cloud, continuation, pullback, and exhaustion markers.',
    inputs: [
      { id: 'mode', name: 'Display', type: 'select', default: 'cloud', options: [{ value: 'cloud', label: 'Cloud' }, { value: 'single', label: 'Single line' }] },
      { id: 'showArrows', name: 'Show continuation arrows', type: 'boolean', default: true, group: 'SIGNALS' },
      { id: 'showPullbacks', name: 'Show pullback markers', type: 'boolean', default: true, group: 'SIGNALS' },
      { id: 'showStars', name: 'Show exhaustion markers', type: 'boolean', default: true, group: 'SIGNALS' },
      { id: 'donchianLen', name: 'Donchian length', type: 'number', default: 10, min: 1, max: 500, step: 1, group: 'CALCULATION' },
      { id: 'dispLen', name: 'Disparity length', type: 'number', default: 20, min: 1, max: 500, step: 1, group: 'CALCULATION' },
      { id: 'dispThresholdPct', name: 'Disparity threshold (%)', type: 'number', default: 3, min: 0.1, max: 100, step: 0.1, group: 'CALCULATION' },
      { id: 'maxPullbackLen', name: 'Maximum pullback bars', type: 'number', default: 3, min: 1, max: 100, step: 1, group: 'CALCULATION' },
    ],
    styles: [],
    compute: computeDsmartOverlay,
  },
  {
    id: 'vwap_bands',
    name: 'VWAP Bands',
    description: 'VWAP with volume-weighted ±σ bands (TV formula). Anchor Session/Week/Month/Quarter/Year, source hlc3.',
    inputs: [
      { id: 'mult1', name: 'Band 1 ×σ', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { id: 'mult2', name: 'Band 2 ×σ', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { id: 'anchor', name: 'Anchor Period', type: 'select', default: 'session',
        options: [
          { value: 'session', label: 'Session' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ] },
      { id: 'source', name: 'Source', type: 'source', default: 'hlc3',
        options: [
          { value: 'hlc3', label: 'HLC3' },
          { value: 'hl2', label: 'HL2' },
          { value: 'ohlc4', label: 'OHLC4' },
          { value: 'close', label: 'Close' },
        ] },
    ],
    styles: [
      { id: 'vwap', name: 'VWAP', color: '#42a5f5', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper1', name: '+σ', color: '#7e9cb5', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower1', name: '-σ', color: '#7e9cb5', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'upper2', name: '+2σ', color: '#5c7488', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower2', name: '-2σ', color: '#5c7488', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeVwapBands,
  },
  {
    id: 'williams_r',
    name: 'Williams %R',
    description: 'Momentum indicator that measures overbought and oversold levels.',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 2000, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart', options: [{ value: 'chart', label: 'Chart' }, { value: '1d', label: '1 Day' }], group: 'CALCULATION', tooltip: 'Timeframe for the indicator' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION' },
    ],
    styles: [
      { id: 'percentR', name: '%R', color: '#7E57C2', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upperBand', name: 'Upper Band', color: '#787B86', thickness: 1, lineStyle: 'solid', display: true, hasValue: true, value: -20 },
      { id: 'middleLevel', name: 'Middle Level', color: '#787B86', thickness: 1, lineStyle: 'dotted', display: true, hasValue: true, value: -50 },
      { id: 'lowerBand', name: 'Lower Band', color: '#787B86', thickness: 1, lineStyle: 'solid', display: true, hasValue: true, value: -80 },
      { id: 'background', name: 'Background', color: '#7E57C21A', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
    ],
    compute: computeWilliamsR,
  },
  {
    id: 'smc',
    name: 'Smart Money Concepts (SMC)',
    description:
      'SMC Intelligence Engine: market structure (BOS/CHoCH), order blocks, EQH/EQL + sweeps, fair value gaps, premium/discount zones — scored and lifecycle-tracked.',
    inputs: [
      { id: 'showSwing', name: 'Swing Structure', type: 'boolean', default: true },
      { id: 'showInternal', name: 'Internal Structure', type: 'boolean', default: true },
      { id: 'showOrderBlocks', name: 'Order Blocks', type: 'boolean', default: true },
      { id: 'showFvg', name: 'Fair Value Gaps', type: 'boolean', default: false },
      { id: 'showLiquidity', name: 'Equal Highs/Lows + Sweeps', type: 'boolean', default: true },
      { id: 'showZones', name: 'Premium/Discount Zones', type: 'boolean', default: false },
      { id: 'showLabels', name: 'Zone Labels', type: 'boolean', default: true },
      { id: 'structureLabels', name: 'BOS/CHoCH Labels', type: 'select', default: 'full', options: [{ value: 'full', label: 'Full (Bullish BOS)' }, { value: 'compact', label: 'Compact (BOS)' }, { value: 'hidden', label: 'Hidden (lines only)' }] },
      { id: 'showSwingLabels', name: 'Swing Labels (HH/HL/LH/LL)', type: 'boolean', default: false },
      { id: 'labelStyle', name: 'Label Style', type: 'select', default: 'full', options: [{ value: 'full', label: 'Full (name • strength · state)' }, { value: 'compact', label: 'Compact (OB 91)' }] },
      { id: 'debugMode', name: 'Debug Mode (all objects + scores)', type: 'boolean', default: false },
      { id: 'swingsLength', name: 'Swing Length', type: 'number', default: 50, min: 10, max: 200, step: 1 },
      { id: 'internalLength', name: 'Internal Length', type: 'number', default: 5, min: 2, max: 50, step: 1 },
    ],
    styles: [],
    compute: computeSmcOverlay,
  },
];

const RESET_TRIGGERS: IndicatorEvaluationDeclaration['resetTriggers'] = ['symbol', 'timeframe', 'sourceRevision', 'transform', 'replayEnter', 'replayRewind', 'replayExit', 'historyPrepend', 'settingsChange'];

function registryEvaluation(sourcePolicy: IndicatorEvaluationDeclaration['sourcePolicy'], finalityPolicy: IndicatorEvaluationDeclaration['finalityPolicy'], incrementalEligibility: IndicatorEvaluationDeclaration['incrementalEligibility'], replayPolicy: IndicatorEvaluationDeclaration['replayPolicy'], volumeInterpretation: IndicatorEvaluationDeclaration['volumeInterpretation'], replayNotes?: string): IndicatorEvaluationDeclaration {
  return { sourcePolicy, finalityPolicy, replaySafe: true, incrementalEligibility, replayPolicy, volumeInterpretation, resetTriggers: RESET_TRIGGERS, replayNotes };
}

const EVALUATION_BY_ID: Record<string, IndicatorEvaluationDeclaration> = {};
const addEvaluation = (ids: string, ...args: Parameters<typeof registryEvaluation>) => {
  for (const id of ids.split(',')) EVALUATION_BY_ID[id] = registryEvaluation(...args);
};
addEvaluation('session_volume_profile', 'raw', 'developing', 'incremental', 'snapshot-raw', 'estimated-directional-volume', 'Profile rows use raw candle volume; directional/delta allocation is estimated.');
addEvaluation('poc_mrp_zones', 'raw', 'developing', 'full-rebuild', 'snapshot-raw', 'raw-volume', 'Zone geometry uses confirmed higher-timeframe ATR values; MRP lines use the developing raw-volume snapshot.');
addEvaluation('sma', 'display', 'developing', 'incremental', 'snapshot-display', 'not-applicable');
addEvaluation('ma_ribbon_tv', 'display', 'developing', 'full-rebuild', 'snapshot-display', 'not-applicable');
addEvaluation('ma_fvg', 'mixed', 'closed', 'full-rebuild', 'snapshot-mixed', 'not-applicable', 'MA/VWAP visuals use display inputs; FVG structure uses raw closed candles.');
addEvaluation('macd,bollinger_bands,rsi,parabolic_sar,stochastic,keltner_channels,adx,williams_r', 'display', 'developing', 'full-rebuild', 'snapshot-display', 'not-applicable');
addEvaluation('atr', 'display', 'developing', 'incremental', 'snapshot-display', 'not-applicable');
addEvaluation('volume', 'display', 'developing', 'full-rebuild', 'snapshot-display', 'raw-volume');
addEvaluation('obv', 'display', 'developing', 'incremental', 'snapshot-display', 'estimated-directional-volume', 'OBV signs raw volume by candle close direction; it is not aggressor delta.');
addEvaluation('vwap', 'display', 'developing', 'incremental', 'snapshot-display', 'raw-volume');
addEvaluation('dsmart_line', 'display', 'mixed', 'full-rebuild', 'snapshot-display', 'not-applicable');
addEvaluation('supertrend', 'display', 'mixed', 'full-rebuild', 'snapshot-display', 'not-applicable');
addEvaluation('vwap_bands', 'display', 'developing', 'full-rebuild', 'snapshot-display', 'raw-volume');
addEvaluation('smc', 'raw', 'closed', 'structural-closed-bar-cached', 'snapshot-raw', 'not-applicable');
export const CUSTOM_INDICATORS: CustomIndicatorDef[] = RAW_CUSTOM_INDICATORS.map((def) => {
  const evaluation = EVALUATION_BY_ID[def.id];
  if (!evaluation) throw new Error(`Missing evaluation metadata for indicator ${def.id}`);
  return { ...def, evaluation };
});
