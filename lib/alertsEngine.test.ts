import { describe, it, expect } from 'vitest';
import { alertQualityScore, conditionMet, evaluateAlert, seedAlerts, qualityLabel, type Alert, type MarketSnapshot } from './alertsEngine';

const snap: MarketSnapshot = {
  symbol: 'BTCUSDT', price: 62_600, stackScore: 92, consensusBull: 6, consensusTotal: 6,
  tradeReadiness: 88, probability: 70, volumeScore: 80, trendScore: 90, alignmentScore: 100,
};
const mk = (over: Partial<Alert>): Alert => ({
  id: 'a', symbol: 'BTCUSDT', type: 'Stack Score', condition: 'Greater Than', threshold: 85,
  severity: 'Opportunity', status: 'Active', createdAt: 0, lastTriggered: null, ...over,
});

describe('alertQualityScore (moat formula)', () => {
  it('= score*.3 + alignment*.25 + volume*.15 + probability*.2 + trend*.1', () => {
    // 92*.3 + 100*.25 + 80*.15 + 70*.2 + 90*.1 = 27.6+25+12+14+9 = 87.6 → 88
    expect(alertQualityScore({ score: 92, alignment: 100, volume: 80, probability: 70, trend: 90 })).toBe(88);
    expect(qualityLabel(88)).toBe('High Quality Alert');
  });
});

describe('conditionMet', () => {
  it('greater / less', () => {
    expect(conditionMet('Greater Than', 92, 85)).toBe(true);
    expect(conditionMet('Greater Than', 80, 85)).toBe(false);
    expect(conditionMet('Less Than', 3, 4)).toBe(true);
    expect(conditionMet('Crosses Above', 92, 85)).toBe(true);
  });
});

describe('evaluateAlert', () => {
  it('fires when an active Stack Score > 85 alert is met', () => {
    const r = evaluateAlert(mk({}), snap);
    expect(r.fires).toBe(true);
    expect(r.value).toBe(92);
    expect(r.title).toMatch(/Stack Score/);
  });
  it('does not fire when paused', () => {
    expect(evaluateAlert(mk({ status: 'Paused' }), snap).fires).toBe(false);
  });
  it('MTF Alignment alert reads the consensus bull count', () => {
    const r = evaluateAlert(mk({ type: 'MTF Alignment', threshold: 5 }), snap);
    expect(r.value).toBe(6);
    expect(r.fires).toBe(true);
  });
  it('Risk Alert (alignment < 4) fires when alignment is low', () => {
    const low: MarketSnapshot = { ...snap, consensusBull: 3 };
    expect(evaluateAlert(mk({ type: 'Risk Alert', condition: 'Less Than', threshold: 4 }), low).fires).toBe(true);
  });
});

describe('seedAlerts', () => {
  it('seeds six example rules', () => {
    expect(seedAlerts()).toHaveLength(6);
  });
});
