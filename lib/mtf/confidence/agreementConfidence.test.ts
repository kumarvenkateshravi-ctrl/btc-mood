import { describe, expect, it } from 'vitest';
import type { AgreementResult } from '../agreement/agreementTypes';
import { agreementConfidence } from './agreementConfidence';

const agr = (agreement: number, dominantShare: number, minorityShare: number, extra?: Partial<AgreementResult>): AgreementResult => ({
  schemaVersion: 1, agreement, conflict: 0, dominantBias: 'bullish', state: 'strong', consensus: 'strong_bullish',
  indicatorAgreement: agreement, categoryAgreement: agreement, contributors: [], signals: [], warnings: [],
  diagnostics: { bullishVotes: 0, bearishVotes: 0, neutralVotes: 0, agreementRatio: agreement / 100, dominantShare, minorityShare },
  ...extra,
});

describe('agreementConfidence', () => {
  it('strong directional agreement → high', () => {
    // 90 × (0.8 + 0.1) = 81
    expect(agreementConfidence(agr(90, 0.8, 0.1))).toBe(81);
  });
  it('neutral consensus (high agreement, ~no directional share) → LOW', () => {
    // 96 × (0.05 + 0.04) = 8.64 → 9  (Decision 3: everyone agrees there is no edge)
    expect(agreementConfidence(agr(96, 0.05, 0.04))).toBe(9);
  });
  it('state none (zero shares) → 0', () => {
    expect(agreementConfidence(agr(0, 0, 0, { state: 'none', dominantBias: 'neutral' }))).toBe(0);
  });
});
