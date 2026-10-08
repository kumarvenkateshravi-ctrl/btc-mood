import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { buildStandardMtfSnapshot } from './standardMtfService';
import {
  CUSTOM_MTF_STORAGE_KEY,
  createCustomMtfConfig,
  loadCustomMtfConfig,
  resetCustomMtfConfig,
  saveCustomMtfConfig,
  withCustomMtfIndicatorSettings,
  withCustomMtfSmcConfig,
  withCustomMtfWorkspace,
} from './customMtfConfig';
import { buildCustomMtfContext, buildCustomMtfSmc, buildCustomMtfWorkspace, createCustomMtfCacheIdentity } from './customMtfWorkspace';

const START = 1_700_000_000;

function candles(seed: number, count = 241): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((seed + index) / 8) * 3 + Math.cos((seed + index) / 15);
    const open = 100 + seed + index * 0.21 + wave;
    const close = open + Math.sin(index / 3) * 1.4;
    return {
      time: START + index * 300,
      open,
      high: Math.max(open, close) + 1.6,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 1_000 + ((index * 31 + seed * 11) % 420),
      takerBuyVolume: 400 + ((index * 23 + seed * 7) % 300),
    };
  });
}

function market(): Record<Timeframe, Candle[]> {
  return Object.fromEntries(
    (['5m', '15m', '30m', '1h', '4h', '1d'] as const).map((timeframe, index) => [timeframe, candles(index * 13)]),
  ) as Record<Timeframe, Candle[]>;
}

function settings(inputs: Record<string, number>) {
  return { inputs, styles: {}, visibility: {} };
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('Custom MTF isolation boundary', () => {
  it('owns frozen config copies and never shares nested settings or SMC defaults', () => {
    const first = createCustomMtfConfig();
    const second = createCustomMtfConfig();
    const changed = withCustomMtfIndicatorSettings(first, 'rsi', settings({ length: 7 }));
    expect(first).not.toBe(second);
    expect(first.smc.config).not.toBe(second.smc.config);
    expect(first.smc.config.weights).not.toBe(second.smc.config.weights);
    expect(changed.indicatorSettings.rsi?.inputs.length).toBe(7);
    expect(first.indicatorSettings.rsi).toBeUndefined();
    expect(Object.isFrozen(changed)).toBe(true);
    expect(Object.isFrozen(changed.indicatorSettings.rsi?.inputs)).toBe(true);
  });

  it('persists only the namespaced Custom config and safely resets malformed or stale values', () => {
    const storage = new MemoryStorage();
    const saved = withCustomMtfWorkspace(
      withCustomMtfIndicatorSettings(createCustomMtfConfig(), 'rsi', settings({ length: 7 })),
      { structureTimeframe: '5m', smcEnabled: false },
    );
    saveCustomMtfConfig(storage, saved);
    expect(storage.values.has(CUSTOM_MTF_STORAGE_KEY)).toBe(true);
    const reloaded = loadCustomMtfConfig(storage);
    expect(reloaded.indicatorSettings.rsi?.inputs.length).toBe(7);
    expect(reloaded.workspace.structureTimeframe).toBe('5m');
    expect(reloaded.workspace.smcEnabled).toBe(false);

    storage.setItem(CUSTOM_MTF_STORAGE_KEY, '{bad json');
    expect(loadCustomMtfConfig(storage).indicatorSettings).toEqual({});
    storage.setItem(CUSTOM_MTF_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, indicatorSettings: { rsi: settings({ length: 2 }) } }));
    expect(loadCustomMtfConfig(storage).indicatorSettings).toEqual({});
  });

  it('resets only Custom settings and leaves unrelated and Standard-like persistence untouched', () => {
    const storage = new MemoryStorage();
    const candlesByTimeframe = market();
    const standardInput = { symbol: 'BTCUSDT' as const, candlesByTimeframe };
    const standardBefore = buildStandardMtfSnapshot(standardInput).snapshot;
    const standardSentinel = 'mycryptostack.standardMtf.snapshot';
    storage.setItem(standardSentinel, 'preserve-standard');
    const configured = withCustomMtfSmcConfig(
      withCustomMtfIndicatorSettings(createCustomMtfConfig(), 'rsi', settings({ length: 6 })),
      { fvgAutoThreshold: false, fvgExtend: 8 },
    );
    saveCustomMtfConfig(storage, configured);

    const reset = resetCustomMtfConfig(storage);

    expect(reset).toEqual(createCustomMtfConfig());
    expect(loadCustomMtfConfig(storage)).toEqual(createCustomMtfConfig());
    expect(storage.getItem(standardSentinel)).toBe('preserve-standard');
    expect([...storage.values.keys()]).toEqual([standardSentinel, CUSTOM_MTF_STORAGE_KEY]);
    expect(buildStandardMtfSnapshot(standardInput).snapshot).toEqual(standardBefore);
  });

  it('namespaces cache identity by config, symbol, timeframe, candles, and replay session', () => {
    const config = createCustomMtfConfig();
    const raw = market()['5m'];
    const base = createCustomMtfCacheIdentity({ symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config });
    const rsi = withCustomMtfIndicatorSettings(config, 'rsi', settings({ length: 7 }));
    const configured = createCustomMtfCacheIdentity({ symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config: rsi });
    const gold = createCustomMtfCacheIdentity({ symbol: 'XAUUSD', timeframe: '5m', candles: raw, config: rsi });
    const hourly = createCustomMtfCacheIdentity({ symbol: 'BTCUSDT', timeframe: '1h', candles: raw, config: rsi });
    const replay = createCustomMtfCacheIdentity({
      symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config: rsi, mode: 'replay',
      replay: { sessionId: 'session-a', cutTime: raw[200].time, executionTimeframe: '5m' },
    });
    expect(base.namespace).toBe('custom-mtf');
    expect(configured.cacheKey).not.toBe(base.cacheKey);
    expect(gold.cacheKey).not.toBe(configured.cacheKey);
    expect(hourly.cacheKey).not.toBe(configured.cacheKey);
    expect(replay.cacheKey).not.toBe(configured.cacheKey);
    expect(replay.candleCutoff).toBe(raw[200].time);
  });

  it('keeps live and replay Custom SMC inputs isolated while retaining pure shared SMC computation', () => {
    const raw = market()['5m'];
    const config = createCustomMtfConfig();
    const live = buildCustomMtfSmc({ symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config, hasFormingBar: true });
    const replay = buildCustomMtfSmc({
      symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config, mode: 'replay',
      replay: { sessionId: 'session-a', cutTime: raw[190].time, executionTimeframe: '5m' }, hasFormingBar: false,
    });
    expect(live.identity.cacheKey).not.toBe(replay.identity.cacheKey);
    expect(replay.snapshot.metadata.context?.mode).toBe('replay');
    expect(replay.snapshot.metadata.context?.replay?.cutTime).toBe(raw[190].time);
    expect(live.snapshot.metadata.context?.mode).toBe('live');
  });

  it('publishes taker-side flow for BTC only and preserves replay identity in Custom context', () => {
    const raw = market()['5m'];
    const config = createCustomMtfConfig();
    const btc = buildCustomMtfContext({ symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config, hasFormingBar: true });
    const xau = buildCustomMtfContext({ symbol: 'XAUUSD', timeframe: '5m', candles: raw, config, hasFormingBar: true });
    const replay = buildCustomMtfContext({
      symbol: 'BTCUSDT', timeframe: '5m', candles: raw, config, mode: 'replay', hasFormingBar: false,
      replay: { sessionId: 'phase-7-replay', cutTime: raw[180].time, executionTimeframe: '5m' },
    });

    expect(btc.orderFlow.availability).toBe('available');
    expect(btc.orderFlow.provenance.metricSource).toBe('binance-kline-taker-buy-base-volume');
    expect(xau.orderFlow.availability).toBe('unavailable');
    expect(xau.orderFlow.reason).toContain('XAUUSD');
    expect(xau.orderFlow.bidAskDelta).toBeNull();
    expect(replay.identity.mode).toBe('replay');
    expect(replay.identity.replay?.sessionId).toBe('phase-7-replay');
    expect(replay.identity.candleCutoff).toBe(raw[180].time);
    expect(replay.poc.provenance.replayCutoff).toBe(raw[180].time);
    expect(replay.derived.fvg.provenance.replayCutoff).toBe(raw[180].time);
    expect(replay.derived.vwap.provenance.replayCutoff).toBe(raw[180].time);
    expect(replay.derived.poc).toBe(replay.poc);
  });

  it('keeps Standard MTF byte-for-byte identical after Custom RSI, EMA, MACD, ADX, SuperTrend, and FVG/SMC changes', () => {
    const candlesByTimeframe = market();
    const standardInput = { symbol: 'BTCUSDT' as const, candlesByTimeframe };
    const before = buildStandardMtfSnapshot(standardInput).snapshot;
    const baselineCustom = buildCustomMtfWorkspace({ symbol: 'BTCUSDT', candlesByTimeframe, config: createCustomMtfConfig() });

    let config = createCustomMtfConfig();
    config = withCustomMtfIndicatorSettings(config, 'rsi', settings({ length: 7 }));
    config = withCustomMtfIndicatorSettings(config, 'ema', settings({ fast: 7, slow: 21, long: 89 }));
    config = withCustomMtfIndicatorSettings(config, 'macd', settings({ fast: 5, slow: 17, signal: 4 }));
    config = withCustomMtfIndicatorSettings(config, 'adx', settings({ diLength: 7, adxSmoothing: 7 }));
    config = withCustomMtfIndicatorSettings(config, 'supertrend', settings({ atrPeriod: 7, mult: 5 }));
    config = createCustomMtfConfig({
      indicatorSettings: config.indicatorSettings,
      workspace: config.workspace,
      smc: { config: { ...config.smc.config, fvgAutoThreshold: false, fvgExtend: 4 } },
    });

    const custom = buildCustomMtfWorkspace({ symbol: 'BTCUSDT', candlesByTimeframe, config });
    const customSmc = buildCustomMtfSmc({ symbol: 'BTCUSDT', timeframe: '5m', candles: candlesByTimeframe['5m'], config, hasFormingBar: true });
    const after = buildStandardMtfSnapshot(standardInput).snapshot;

    expect(custom.identity.every((identity) => identity.namespace === 'custom-mtf')).toBe(true);
    expect(custom.matrix.rows.find((row) => row.key === 'ema')?.sub).toBe('7 > 21 > 89');
    expect(custom.matrix.rows.find((row) => row.key === 'rsi')?.sub).toBe('7');
    expect(custom.matrix.rows.find((row) => row.key === 'macd')?.sub).toBe('5,17,4');
    expect(custom.matrix.rows.find((row) => row.key === 'adx')?.sub).toBe('7');
    expect(custom.matrix.rows.find((row) => row.key === 'supertrend')?.sub).toBe('7,5');
    expect(custom.matrix).not.toEqual(baselineCustom.matrix);
    expect(customSmc.snapshot.metadata.config.fvgAutoThreshold).toBe(false);
    expect(customSmc.snapshot.metadata.config.fvgExtend).toBe(4);
    expect(customSmc.identity.configFingerprint).not.toBe(createCustomMtfCacheIdentity({
      symbol: 'BTCUSDT', timeframe: '5m', candles: candlesByTimeframe['5m'], config: createCustomMtfConfig(),
    }).configFingerprint);
    expect(after).toEqual(before);
    expect(after.snapshotId).toBe(before.snapshotId);
    expect(after.cacheKey).toBe(before.cacheKey);
  });

  it('keeps Custom symbol and timeframe analysis isolated', () => {
    const candlesByTimeframe = market();
    const config = withCustomMtfIndicatorSettings(createCustomMtfConfig(), 'rsi', settings({ length: 7 }));
    const btc = buildCustomMtfWorkspace({ symbol: 'BTCUSDT', candlesByTimeframe, config });
    const gold = buildCustomMtfWorkspace({ symbol: 'XAUUSD', candlesByTimeframe, config });
    expect(btc.identity[0].cacheKey).not.toBe(gold.identity[0].cacheKey);
    expect(btc.identity.find((entry) => entry.timeframe === '5m')?.cacheKey)
      .not.toBe(btc.identity.find((entry) => entry.timeframe === '1h')?.cacheKey);
  });
});
