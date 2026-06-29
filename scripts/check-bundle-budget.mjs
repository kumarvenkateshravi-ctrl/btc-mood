// Performance budget gate (DESIGN.md §L: "a PR that violates a budget fails the
// build"). Runs after `next build`, against the real production chunks.
//
// Enforced budget: the SHARED baseline — the JS every route must download before
// anything else (framework + shared app chunks + polyfills) — must stay under
// 250KB gzipped. This is the "initial bundle < 250KB" target. Per-route chart
// code is lazy-loaded (next/dynamic) and intentionally excluded from this floor.

import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const BUDGET_KB = 250;
const NEXT = '.next';

function gz(file) {
  const p = path.join(NEXT, file);
  return gzipSync(readFileSync(p)).length;
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(NEXT, 'build-manifest.json'), 'utf8'));
} catch {
  console.error('✗ bundle-budget: no .next/build-manifest.json — run `next build` first.');
  process.exit(1);
}

const shared = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])].filter((f) => f.endsWith('.js'));
if (shared.length === 0) {
  console.error('✗ bundle-budget: could not resolve the shared baseline chunks.');
  process.exit(1);
}

let rawBytes = 0;
let gzBytes = 0;
for (const f of shared) {
  rawBytes += statSync(path.join(NEXT, f)).size;
  gzBytes += gz(f);
}

const gzKb = gzBytes / 1024;
const rawKb = rawBytes / 1024;
const ok = gzKb <= BUDGET_KB;

console.log(`Shared baseline: ${rawKb.toFixed(0)}KB raw / ${gzKb.toFixed(0)}KB gzip  (budget ${BUDGET_KB}KB gzip)`);
console.log(`${ok ? '✓' : '✗'} bundle-budget: shared first-load JS is ${gzKb.toFixed(0)}KB / ${BUDGET_KB}KB`);

if (!ok) {
  console.error(`\nBudget exceeded by ${(gzKb - BUDGET_KB).toFixed(0)}KB. Lazy-load heavy code with next/dynamic, or trim a shared dependency.`);
  process.exit(1);
}
