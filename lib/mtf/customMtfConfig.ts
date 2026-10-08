// Custom MTF workspace configuration. This is deliberately separate from the
// fixed Standard MTF methodology: it owns user preferences, persistence, and
// Custom-only cache provenance without importing the Standard snapshot contract.

import type { IndicatorSettings } from '../indicatorFramework';
import type { Timeframe } from '../types';
import { DEFAULT_SMC_CONFIG, type SmcConfig } from '../smc/types';

export const CUSTOM_MTF_CONFIG_SCHEMA_VERSION = 1 as const;
export const CUSTOM_MTF_STORAGE_KEY = 'mycryptostack.customMtf.config.v1';
export const CUSTOM_MTF_LEGACY_SETTINGS_KEY = 'custom_mtf_settings';
export const CUSTOM_MTF_LEGACY_STRUCTURE_TF_KEY = 'custom_mtf_structure_tf';
export const CUSTOM_MTF_METHODOLOGY_VERSION = 'custom-mtf/workspace/1.0.0' as const;
// EMA is supported by the config API for migration/testing, although the
// existing Phase 2 UI continues to expose only the original four controls.
export const CUSTOM_MTF_CONFIGURABLE_INDICATORS = ['ema', 'supertrend', 'rsi', 'macd', 'adx'] as const;

export type CustomMtfIndicatorId = (typeof CUSTOM_MTF_CONFIGURABLE_INDICATORS)[number];
export type CustomMtfMode = 'live' | 'replay';
export type CustomMtfDeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? readonly CustomMtfDeepReadonly<Item>[]
      : T extends object ? { readonly [Key in keyof T]: CustomMtfDeepReadonly<T[Key]> }
        : T;

export interface CustomMtfConfig {
  readonly schemaVersion: typeof CUSTOM_MTF_CONFIG_SCHEMA_VERSION;
  readonly methodologyVersion: typeof CUSTOM_MTF_METHODOLOGY_VERSION;
  readonly indicatorSettings: Readonly<Partial<Record<CustomMtfIndicatorId, IndicatorSettings>>>;
  readonly workspace: {
    readonly structureTimeframe: Timeframe;
    readonly smcEnabled: boolean;
  };
  /** Explicitly owned copy; no UI exposes these knobs in Phase 2. */
  readonly smc: {
    readonly config: SmcConfig;
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

function deepFreeze<T>(value: T): CustomMtfDeepReadonly<T> {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const child of Object.values(current)) visit(child);
    Object.freeze(current);
  };
  visit(value);
  return value as CustomMtfDeepReadonly<T>;
}

function cloneSmcConfig(config: SmcConfig = DEFAULT_SMC_CONFIG): SmcConfig {
  return { ...config, weights: { ...config.weights } };
}

function sanitizeIndicatorSettings(value: unknown): IndicatorSettings | null {
  if (!isRecord(value) || !isRecord(value.inputs)) return null;
  const inputs: Record<string, string | number | boolean> = {};
  for (const [key, input] of Object.entries(value.inputs)) {
    if (isScalar(input)) inputs[key] = input;
  }
  return { inputs, styles: {}, visibility: {} };
}

function sanitizeSettingsMap(value: unknown): Partial<Record<CustomMtfIndicatorId, IndicatorSettings>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<CustomMtfIndicatorId, IndicatorSettings>> = {};
  for (const id of CUSTOM_MTF_CONFIGURABLE_INDICATORS) {
    const settings = sanitizeIndicatorSettings(value[id]);
    if (settings) out[id] = settings;
  }
  return out;
}

function normalize(
  partial: Partial<Pick<CustomMtfConfig, 'indicatorSettings' | 'workspace' | 'smc'>> = {},
): CustomMtfDeepReadonly<CustomMtfConfig> {
  const timeframe = partial.workspace?.structureTimeframe;
  const config: CustomMtfConfig = {
    schemaVersion: CUSTOM_MTF_CONFIG_SCHEMA_VERSION,
    methodologyVersion: CUSTOM_MTF_METHODOLOGY_VERSION,
    indicatorSettings: sanitizeSettingsMap(partial.indicatorSettings),
    workspace: {
      structureTimeframe: timeframe && TIMEFRAMES.includes(timeframe) ? timeframe : '1h',
      smcEnabled: partial.workspace?.smcEnabled ?? true,
    },
    smc: { config: cloneSmcConfig(partial.smc?.config) },
  };
  return deepFreeze(config);
}

export function createCustomMtfConfig(
  partial: Partial<Pick<CustomMtfConfig, 'indicatorSettings' | 'workspace' | 'smc'>> = {},
): CustomMtfDeepReadonly<CustomMtfConfig> {
  return normalize(partial);
}

export function withCustomMtfIndicatorSettings(
  config: CustomMtfConfig,
  id: CustomMtfIndicatorId,
  settings: IndicatorSettings,
): CustomMtfDeepReadonly<CustomMtfConfig> {
  return normalize({
    indicatorSettings: { ...config.indicatorSettings, [id]: settings },
    workspace: config.workspace,
    smc: config.smc,
  });
}

export function withCustomMtfWorkspace(
  config: CustomMtfConfig,
  patch: Partial<CustomMtfConfig['workspace']>,
): CustomMtfDeepReadonly<CustomMtfConfig> {
  return normalize({ indicatorSettings: config.indicatorSettings, workspace: { ...config.workspace, ...patch }, smc: config.smc });
}

export function withCustomMtfSmcConfig(
  config: CustomMtfConfig,
  patch: Partial<SmcConfig>,
): CustomMtfDeepReadonly<CustomMtfConfig> {
  return normalize({
    indicatorSettings: config.indicatorSettings,
    workspace: config.workspace,
    smc: {
      config: {
        ...config.smc.config,
        ...patch,
        weights: { ...config.smc.config.weights, ...patch.weights },
      },
    },
  });
}

/** Storage loading never reads, writes, or migrates any Standard MTF key. */
export function loadCustomMtfConfig(storage: Pick<StorageLike, 'getItem'>): CustomMtfDeepReadonly<CustomMtfConfig> {
  try {
    const current = storage.getItem(CUSTOM_MTF_STORAGE_KEY);
    if (current) {
      const parsed: unknown = JSON.parse(current);
      if (isRecord(parsed) && parsed.schemaVersion === CUSTOM_MTF_CONFIG_SCHEMA_VERSION) {
        return normalize({
          indicatorSettings: parsed.indicatorSettings as CustomMtfConfig['indicatorSettings'],
          workspace: parsed.workspace as CustomMtfConfig['workspace'],
          smc: parsed.smc as CustomMtfConfig['smc'],
        });
      }
      // Unknown schemas are intentionally reset rather than guessed.
      return createCustomMtfConfig();
    }
    // One-way safe migration from the two former Custom-only keys.
    const legacySettings = storage.getItem(CUSTOM_MTF_LEGACY_SETTINGS_KEY);
    const legacyTf = storage.getItem(CUSTOM_MTF_LEGACY_STRUCTURE_TF_KEY);
    return normalize({
      indicatorSettings: legacySettings ? JSON.parse(legacySettings) : {},
      workspace: { structureTimeframe: TIMEFRAMES.includes(legacyTf as Timeframe) ? legacyTf as Timeframe : '1h', smcEnabled: true },
    });
  } catch {
    return createCustomMtfConfig();
  }
}

export function saveCustomMtfConfig(storage: Pick<StorageLike, 'setItem'>, config: CustomMtfConfig): void {
  storage.setItem(CUSTOM_MTF_STORAGE_KEY, JSON.stringify(config));
}

/** Resets and persists only the Custom namespace. Standard MTF has no mutable settings contract. */
export function resetCustomMtfConfig(storage: Pick<StorageLike, 'setItem'>): CustomMtfDeepReadonly<CustomMtfConfig> {
  const reset = createCustomMtfConfig();
  saveCustomMtfConfig(storage, reset);
  return reset;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
function canonical(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as { readonly [key: string]: Json };
  return '{' + Object.keys(object).sort().map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

/** Deterministic, non-cryptographic workspace config fingerprint. */
export function customMtfConfigFingerprint(config: CustomMtfConfig): string {
  const input = canonical(config as unknown as Json);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'fnv1a32:' + (hash >>> 0).toString(16).padStart(8, '0');
}
