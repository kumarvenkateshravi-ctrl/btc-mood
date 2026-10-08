// Regression baseline for the canonical Board -> M8 -> M9 decision entrypoint.
// This is a snapshot golden: it protects current behaviour during migration.
// Refresh intentionally with: UPDATE_GOLDEN=1 npx vitest run lib/mtf/decision/decisionEngine.golden.test.ts

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Timeframe } from '../../types';
import { makeDeterministicCandles } from '../../testing/syntheticCandles';
import { computeFullTradeDecision } from './decisionEngine';

const FIXTURE = join(__dirname, '__fixtures__', 'decisionEngine.golden.json');
const SEEDS: Record<Timeframe, number> = { '5m': 31, '15m': 37, '30m': 41, '1h': 43, '4h': 47, '1d': 53 };

describe('canonical decision engine golden master', () => {
  it('matches the committed closed-bar Board -> M9 baseline', () => {
    const candlesByTf = Object.fromEntries(
      Object.entries(SEEDS).map(([timeframe, seed]) => [timeframe, makeDeterministicCandles(280, seed)]),
    );
    const output = computeFullTradeDecision(candlesByTf);
    const current = { board: output.board, market: output.intel.result, decision: output.decision };

    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    expect(existsSync(FIXTURE), 'golden fixture is missing; refresh it intentionally with UPDATE_GOLDEN=1').toBe(true);
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });
});
