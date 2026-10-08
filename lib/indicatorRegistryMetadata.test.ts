import { describe, expect, it } from 'vitest';
import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';

const REQUIRED_IDS = [
  'poc_mrp_zones', 'session_volume_profile', 'sma', 'ma_ribbon_tv',
  'ma_fvg', 'macd', 'bollinger_bands', 'rsi', 'atr', 'parabolic_sar', 'stochastic',
  'keltner_channels', 'volume', 'obv', 'vwap', 'adx', 'supertrend', 'dsmart_line', 'vwap_bands',
  'williams_r', 'smc',
];

describe('indicator source/finality registry', () => {
  it('declares lifecycle metadata for every registered indicator', () => {
    const byId = new Map(CUSTOM_INDICATORS.map((def) => [def.id, def]));
    for (const id of REQUIRED_IDS) {
      const def = byId.get(id);
      expect(def, `missing registry entry ${id}`).toBeDefined();
      expect(def!.evaluation).toMatchObject({
        sourcePolicy: expect.stringMatching(/^(raw|display|mixed)$/),
        finalityPolicy: expect.stringMatching(/^(developing|closed|mixed)$/),
        replayPolicy: expect.stringMatching(/^(snapshot-raw|snapshot-display|snapshot-mixed)$/),
        incrementalEligibility: expect.stringMatching(/^(incremental|partially-incremental|full-rebuild|structural-closed-bar-cached)$/),
      });
      expect(def!.evaluation!.replaySafe).toBe(true);
      expect(def!.evaluation!.resetTriggers).toEqual(expect.arrayContaining([
        'symbol', 'timeframe', 'sourceRevision', 'replayEnter', 'replayRewind', 'replayExit', 'historyPrepend', 'settingsChange',
      ]));
    }
    expect(CUSTOM_INDICATORS).toHaveLength(REQUIRED_IDS.length);
  });

  it('keeps incremental declarations aligned with actual incremental factories', () => {
    for (const def of CUSTOM_INDICATORS) {
      const eligibility = def.evaluation!.incrementalEligibility;
      if (eligibility === 'incremental') expect(def.incremental, `${def.id} is declared incremental`).toBeDefined();
      if (def.incremental) expect(eligibility).toBe('incremental');
    }
  });

  it('classifies structural indicators as raw and visual indicators as display', () => {
    const byId = new Map(CUSTOM_INDICATORS.map((def) => [def.id, def]));
    for (const id of ['poc_mrp_zones', 'session_volume_profile', 'smc']) {
      expect(byId.get(id)!.evaluation!.sourcePolicy).toBe('raw');
    }
    for (const id of ['sma', 'macd', 'bollinger_bands', 'rsi', 'atr', 'vwap']) {
      const def = byId.get(id);
      if (def) expect(def.evaluation!.sourcePolicy).toBe('display');
    }
    expect(byId.get('ma_fvg')!.evaluation!.sourcePolicy).toBe('mixed');
  });

  it('makes volume quality explicit', () => {
    const byId = new Map(CUSTOM_INDICATORS.map((def) => [def.id, def]));
    expect(byId.get('volume')!.evaluation!.volumeInterpretation).toBe('raw-volume');
    expect(byId.get('obv')!.evaluation!.volumeInterpretation).toBe('estimated-directional-volume');
    expect(byId.get('session_volume_profile')!.evaluation!.volumeInterpretation).toBe('estimated-directional-volume');
    for (const def of CUSTOM_INDICATORS) expect(def.evaluation!.volumeInterpretation).toBeDefined();
  });

  it('uses truthful labels for estimated profile allocation and trade-derived delta', () => {
    const svp = CUSTOM_INDICATORS.find((def) => def.id === 'session_volume_profile')!;
    const volumeInput = svp.inputs!.find((input) => input.id === 'volume')!;
    expect(volumeInput.options!.find((option) => option.value === 'delta')!.label.toLowerCase()).toContain('estimated');
  });
});
