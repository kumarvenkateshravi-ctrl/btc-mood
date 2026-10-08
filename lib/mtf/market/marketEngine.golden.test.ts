// Regression baseline for the canonical M0 -> M8 market engine.
// This is a snapshot golden: it protects current behaviour during the Standard
// MTF migration; it is not an external correctness oracle.
// Refresh intentionally with: UPDATE_GOLDEN=1 npx vitest run lib/mtf/market/marketEngine.golden.test.ts

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Timeframe } from '../../types';
import { makeDeterministicCandles } from '../../testing/syntheticCandles';
import { computeFullMarketIntelligence } from './marketEngine';

const FIXTURE = join(__dirname, '__fixtures__', 'marketEngine.golden.json');
const SEEDS: Record<Timeframe, number> = { '5m': 11, '15m': 13, '30m': 17, '1h': 19, '4h': 23, '1d': 29 };

describe('canonical market engine golden master', () => {
  it('matches the committed closed-bar M0 -> M8 baseline', () => {
    const candlesByTf = Object.fromEntries(
      Object.entries(SEEDS).map(([timeframe, seed]) => [timeframe, makeDeterministicCandles(280, seed)]),
    );
    const current = computeFullMarketIntelligence(candlesByTf);

    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    expect(existsSync(FIXTURE), 'golden fixture is missing; refresh it intentionally with UPDATE_GOLDEN=1').toBe(true);
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });
});

