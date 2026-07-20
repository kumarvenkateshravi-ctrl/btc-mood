import { describe, expect, it } from 'vitest';
import { marketRisk } from './risk';
import { agr, conf, hier, lcyc, prob } from './testFixtures';

// Baseline fixtures contribute: lowConfidence round(20·0.5)=10 + priorCalibration 5 = 15.
const calmConf = conf({ confidence: 90 });   // → round(20·0.1)=2
const empirical = prob({ calibration: 'empirical' });

describe('marketRisk', () => {
  it('calm market → very_low with minimal reasons', () => {
    const r = marketRisk(agr(), calmConf, hier(), lcyc(), empirical);
    expect(r.score).toBe(2);
    expect(r.level).toBe('very_low');
    expect(r.reasons).toHaveLength(1); // only the low-confidence sliver
  });

  it('each factor contributes its documented points', () => {
    const base = marketRisk(agr(), calmConf, hier(), lcyc(), empirical).score; // 2
    expect(marketRisk(agr(), calmConf, hier({ conflict: 60 }), lcyc(), empirical).score).toBe(base + 15);      // round(25·0.6)
    expect(marketRisk(agr(), calmConf, hier({ transition: true }), lcyc(), empirical).score).toBe(base + 15);
    expect(marketRisk(agr(), calmConf, hier({ overallMarketState: 'reversal_risk' }), lcyc(), empirical).score).toBe(base + 20);
    expect(marketRisk(agr(), calmConf, hier({ controllerAuthority: 40 }), lcyc(), empirical).score).toBe(base + 10);
    expect(marketRisk(agr(), calmConf, hier(), lcyc({ invalidation: { invalidated: true, condition: 'x' } }), empirical).score).toBe(base + 10);
    expect(marketRisk(agr(), calmConf, hier(), lcyc(), prob()).score).toBe(base + 5);                          // prior calibration
    const expansion = hier({ perTimeframe: { '1d': { timeframe: '1d', bias: 'neutral', confidence: 50, regime: 'expansion', regimeClarity: 50, role: 'context', authority: 60, agreesWithHTF: true } } });
    expect(marketRisk(agr(), calmConf, expansion, lcyc(), empirical).score).toBe(base + 10);
  });

  it('stacked factors clamp at 100 and land extreme, reasons name every factor', () => {
    const r = marketRisk(
      agr(), conf({ confidence: 0 }),
      hier({
        conflict: 100, transition: true, overallMarketState: 'reversal_risk', controllerAuthority: 40,
        perTimeframe: { '1d': { timeframe: '1d', bias: 'neutral', confidence: 50, regime: 'expansion', regimeClarity: 50, role: 'context', authority: 40, agreesWithHTF: true } },
      }),
      lcyc({ invalidation: { invalidated: true, condition: 'x' } }), prob(),
    );
    expect(r.score).toBe(100); // 25+15+20+10+20+10+5+10 = 115 → clamped
    expect(r.level).toBe('extreme');
    expect(r.reasons.length).toBe(8);
  });

  it('level boundaries', () => {
    // craft scores via conflict alone on an otherwise-clean base of 2
    const at = (conflict: number) => marketRisk(agr(), calmConf, hier({ conflict }), lcyc(), empirical);
    expect(at(0).level).toBe('very_low');       // 2
    expect(at(60).level).toBe('low');           // 17
    expect(at(100).level).toBe('low');          // 27
    const med = marketRisk(agr(), calmConf, hier({ conflict: 100, transition: true }), lcyc(), empirical);
    expect(med.level).toBe('medium');           // 42
  });
});
