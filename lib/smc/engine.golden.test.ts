// Golden master for the SMC engine, following the repo convention
// (lib/testing/goldenRunner.ts): the fixture is recorded on first run /
// with UPDATE_GOLDEN=1 and committed; any change to detection output fails.
//
// Refresh: UPDATE_GOLDEN=1 npx vitest run lib/smc/engine.golden

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { computeSmc, projectSmcSnapshot } from './engine';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

const FIXTURE = join(__dirname, '__fixtures__', 'engine.golden.json');

describe('smc engine golden master', () => {
  it('matches the committed golden fixture', () => {
    const current = projectSmcSnapshot(computeSmc(makeDeterministicCandles(600, 7)));
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(current, null, 2));
    }
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });
});
