import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { dim, mean, noEvidence, toMap, voteAgreement, voteOf } from './shared';

const ind = (id: string, diagnostics: object, score = 50): IndicatorResult => ({
  id, category: 'trend', score, verdict: 'neutral', confidence: score, strength: score,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});

describe('voteOf', () => {
  it('maps directional values to votes with 55/45 boundaries neutral', () => {
    expect(voteOf(56)).toBe(1);
    expect(voteOf(44)).toBe(-1);
    expect(voteOf(50)).toBe(0);
    expect(voteOf(55)).toBe(0);
    expect(voteOf(45)).toBe(0);
  });
});

describe('voteAgreement', () => {
  it('|Σ|/n·100', () => {
    expect(voteAgreement([1, 1, 1])).toBe(100);
    expect(voteAgreement([1, 1, -1])).toBe(33);
    expect(voteAgreement([1, 1, 0])).toBe(67);
    expect(voteAgreement([1, -1, 0])).toBe(0);
    expect(voteAgreement([])).toBe(0);
  });
});

describe('noEvidence', () => {
  it('true only when all directionals 50 and all magnitudes 0', () => {
    expect(noEvidence([50, 50], [0, 0, 0])).toBe(true);
    expect(noEvidence([50, 51], [0, 0])).toBe(false);
    expect(noEvidence([50], [0, 1])).toBe(false);
    expect(noEvidence([], [])).toBe(true);
  });
});

describe('dim', () => {
  const map = toMap([ind('ema', { alignment: 65, bad: 'x' })]);
  it('reads finite numeric dims', () => {
    expect(dim(map, 'ema', 'alignment', 50)).toBe(65);
  });
  it('falls back on missing indicator / missing key / non-number', () => {
    expect(dim(map, 'nope', 'alignment', 50)).toBe(50);
    expect(dim(map, 'ema', 'missing', 0)).toBe(0);
    expect(dim(map, 'ema', 'bad', 50)).toBe(50);
  });
  it('falls back on empty placeholder diagnostics', () => {
    const empty = toMap([ind('rsi', {})]);
    expect(dim(empty, 'rsi', 'position', 50)).toBe(50);
  });
});

describe('mean', () => {
  it('averages; empty → 50', () => {
    expect(mean([0, 100])).toBe(50);
    expect(mean([30])).toBe(30);
    expect(mean([])).toBe(50);
  });
});
