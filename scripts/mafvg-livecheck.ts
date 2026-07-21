// Throwaway: run "Moving Averages & FVG" on real live BTC klines and sanity-check output.
import type { Candle } from '../lib/types';
import { computeMaFvg } from '../lib/indicators/maFvg';

async function klines(): Promise<Candle[]> {
  const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=400');
  const raw = (await res.json()) as (string | number)[][];
  return raw.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

function finiteRatio(data: (unknown)[]): number {
  const vals = data.map((d) => (d && typeof d === 'object' && 'value' in d ? (d as { value: number }).value
    : d && typeof d === 'object' && 'upper' in d ? (d as { upper: number }).upper
    : d)) as (number | null)[];
  const nonNull = vals.filter((v) => v !== null);
  const finite = nonNull.filter((v) => Number.isFinite(v));
  return nonNull.length ? finite.length / nonNull.length : 1;
}

async function main() {
  const candles = await klines();
  const r = computeMaFvg(candles);
  console.log('\n=== MA-FVG LIVE CHECK (BTCUSDT 1h, real data) ===');
  console.log('candles       :', candles.length, '| price ~', candles.at(-1)!.close.toFixed(1));
  console.log('plots         :', r.plots.length, '→', r.plots.map((p) => p.id).join(', '));
  console.log('fvg boxes     :', r.plots.filter((p) => p.id.startsWith('fvg_')).length);
  console.log('markers       :', r.markers?.length ?? 0,
    '(BUY:', r.markers?.filter((m) => m.text === 'BUY').length,
    'SELL:', r.markers?.filter((m) => m.text === 'SELL').length,
    'C:', r.markers?.filter((m) => m.text === 'C').length, ')');
  console.log('signals       :', r.signals.filter((s) => s !== 'neutral').length, 'non-neutral');
  let allFinite = true;
  for (const p of r.plots) {
    const ratio = finiteRatio(p.data);
    if (ratio < 1) { console.log(`  ⚠ ${p.id}: ${(ratio * 100).toFixed(0)}% finite`); allFinite = false; }
    if (p.data.length !== candles.length) { console.log(`  ✗ ${p.id}: length ${p.data.length} != ${candles.length}`); allFinite = false; }
  }
  console.log(allFinite ? '\n✅ all plots candle-length with only finite non-null values' : '\n⚠ see warnings above');
}

main().catch((e) => { console.error(e); process.exit(1); });
