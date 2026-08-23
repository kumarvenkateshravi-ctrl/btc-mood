import type { ChartType } from '../components/Chart';
import { DEFAULT_COMPARE_SYMBOL, isCompareSymbol, type CompareSymbol } from './compare';
import { TIMEFRAMES, type Timeframe } from './types';

export type ChartRightPanel = 'mood' | 'signals' | 'orderflow' | 'scanner' | 'widgets' | 'watchlist' | null;

/** The chart/session preferences coordinated by this boundary. */
export interface ChartConfig {
  symbol: CompareSymbol;
  timeframe: Timeframe;
  chartType: ChartType;
  indicatorIds: string[];
  rightPanel: ChartRightPanel;
}

/** Untrusted input from URL, workspace, or browser storage. */
export type ChartConfigPatch = Partial<Record<keyof ChartConfig, unknown>>;

export interface ChartConfigSources {
  /** Explicit URL or active-session values. Highest precedence. */
  url?: ChartConfigPatch;
  /** Intentionally applied workspace snapshot. */
  workspace?: ChartConfigPatch;
  /** Validated user preferences from existing persistence owners. */
  persisted?: ChartConfigPatch;
}

export interface ResolveChartConfigInput extends ChartConfigSources {
  defaults: ChartConfig;
  validIndicator?: (id: string) => boolean;
}

export const CHART_CONFIG_VERSION = 1;
/** Optional future-safe envelope; legacy keys remain supported and are not rewritten here. */
export const CHART_CONFIG_STORAGE_KEY = 'btc-mood:chart-config:v1';

function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}

function isChartType(value: unknown): value is ChartType {
  return value === 'candlestick' || value === 'heikinAshi' || value === 'renko';
}

function isRightPanel(value: unknown): value is Exclude<ChartRightPanel, null> {
  return value === 'mood' || value === 'signals' || value === 'orderflow' || value === 'scanner' || value === 'widgets' || value === 'watchlist';
}

function sanitizePatch(source: unknown, validIndicator: (id: string) => boolean): ChartConfigPatch {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const input = source as Record<string, unknown>;
  const output: ChartConfigPatch = {};
  if (typeof input.symbol === 'string' && isCompareSymbol(input.symbol)) output.symbol = input.symbol;
  if (isTimeframe(input.timeframe)) output.timeframe = input.timeframe;
  if (isChartType(input.chartType)) output.chartType = input.chartType;
  if (input.rightPanel === null || isRightPanel(input.rightPanel)) output.rightPanel = input.rightPanel;
  if (Array.isArray(input.indicatorIds)) {
    const ids = input.indicatorIds.filter((id): id is string => typeof id === 'string' && validIndicator(id));
    // An all-invalid payload is malformed and must not erase a valid lower
    // precedence source. An explicitly empty array remains a valid choice.
    if (ids.length > 0 || input.indicatorIds.length === 0) output.indicatorIds = ids;
  }
  return output;
}

/**
 * Resolve chart configuration in one place. Sources are merged from lowest to
 * highest priority: defaults → persisted → workspace → URL/active session.
 */
export function resolveChartConfig(input: ResolveChartConfigInput): ChartConfig {
  const validIndicator = input.validIndicator ?? (() => true);
  const result: ChartConfig = {
    ...input.defaults,
    indicatorIds: [...input.defaults.indicatorIds],
  };
  for (const source of [input.persisted, input.workspace, input.url]) {
    Object.assign(result, sanitizePatch(source, validIndicator));
  }
  return result;
}

/**
 * Parse the optional versioned chart preference envelope. Replay identity,
 * replay cut, drafts, and command state are intentionally ignored.
 */
export function parsePersistedChartConfig(
  raw: string | null | undefined,
  validIndicator: (id: string) => boolean = () => true,
): ChartConfigPatch {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const envelope = parsed as { version?: unknown; state?: unknown };
    if (envelope.version !== CHART_CONFIG_VERSION) return {};
    return sanitizePatch(envelope.state, validIndicator);
  } catch {
    return {};
  }
}

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  symbol: DEFAULT_COMPARE_SYMBOL,
  timeframe: '15m',
  chartType: 'candlestick',
  indicatorIds: [],
  rightPanel: 'signals',
};

