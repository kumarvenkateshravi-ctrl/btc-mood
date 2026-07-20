import { describe, expect, it } from 'vitest';
import { unifySignals } from './unifiedSignals';
import { agr, conf, hier, lcyc, prob } from './testFixtures';

describe('unifySignals', () => {
  it('merges all layers with correct source tags', () => {
    const r = unifySignals(
      agr({ signals: [{ code: 'AGR_STRONG_CONSENSUS', message: 'a', severity: 'strong', source: 'indicator' }] }),
      conf({ signals: [{ code: 'CONF_STRONG', message: 'c', severity: 'strong' }] }),
      hier({ signals: [{ code: 'TF_CONTROLLER', message: 'h', severity: 'info' }] }),
      lcyc({ signals: [{ code: 'LC_TREND', message: 'l', severity: 'info' }] }),
      prob({ signals: [{ code: 'PROB_MODEL_PRIORS', message: 'p', severity: 'info' }] }),
      [{ code: 'MI_READINESS', message: 'm', severity: 'info', source: 'M8' }],
    );
    const bySource = Object.fromEntries(r.signals.map((s) => [s.code, s.source]));
    expect(bySource).toEqual({
      AGR_STRONG_CONSENSUS: 'M3', CONF_STRONG: 'M4', TF_CONTROLLER: 'M5',
      LC_TREND: 'M6', PROB_MODEL_PRIORS: 'M7', MI_READINESS: 'M8',
    });
  });

  it('dedupes by code (first occurrence wins) and sorts strong → warning → info', () => {
    const r = unifySignals(
      agr({ warnings: [{ code: 'DUP', message: 'from M3', severity: 'warning', source: 'category' }] }),
      conf({ warnings: [{ code: 'DUP', message: 'from M4', severity: 'warning' }, { code: 'B_STRONG', message: 'b', severity: 'strong' }] }),
      hier({ warnings: [{ code: 'C_INFO', message: 'c', severity: 'info' }] }),
      lcyc(), prob(), [],
    );
    expect(r.warnings.filter((w) => w.code === 'DUP')).toHaveLength(1);
    expect(r.warnings.find((w) => w.code === 'DUP')!.source).toBe('M3');
    expect(r.warnings.map((w) => w.severity)).toEqual(['strong', 'warning', 'info']);
  });

  it('empty layers are safe', () => {
    const r = unifySignals(agr(), conf(), hier(), lcyc(), prob(), []);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
