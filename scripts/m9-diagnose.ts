// Throwaway diagnostic: fetch live BTC klines and run the full M9 decision,
// printing exactly which gate rung blocks and the underlying M8 numbers.
import type { Candle, Timeframe } from '../lib/types';
import { TIMEFRAMES } from '../lib/types';
import { computeFullTradeDecision } from '../lib/mtf/decision/decisionEngine';

const INTERVAL: Record<Timeframe, string> = {
  '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d',
};

async function klines(tf: Timeframe): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${INTERVAL[tf]}&limit=400`;
  const res = await fetch(url);
  const raw = (await res.json()) as (string | number)[][];
  return raw.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function main() {
  const byTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const tf of TIMEFRAMES) byTf[tf] = await klines(tf);

  const { decision, intel } = computeFullTradeDecision(byTf);
  const m = intel.result;
  const L = intel.layers;

  console.log('\n=== LIVE BTC — FULL LAYER TRACE ===');
  console.log('price ~', byTf['5m']!.at(-1)!.close.toFixed(1));

  console.log('\n-- M3 agreement (controller TF) --');
  console.log('agreement  :', L.agreement.agreement + '%', '| bias', L.agreement.dominantBias, '| state', L.agreement.state, '| conflict', L.agreement.conflict);
  console.log('confidence :', L.confidence.confidence + '%', '| state', L.confidence.state);

  console.log('\n-- M5 hierarchy --');
  console.log('htfBias    :', L.hierarchy.htfBias, '| overallState', L.hierarchy.overallMarketState, '| controller', L.hierarchy.controller);
  console.log('alignment  :', L.hierarchy.alignment, '| conflict', L.hierarchy.conflict, '| transition', L.hierarchy.transition);
  for (const tf of TIMEFRAMES) {
    const e = L.hierarchy.perTimeframe[tf];
    if (e) console.log(`   ${tf.padEnd(4)}: ${e.bias.padEnd(8)} conf ${String(e.confidence).padStart(3)} regime ${e.regime}`);
  }

  console.log('\n-- M6 trend lifecycle (THE suspect) --');
  console.log('stage      :', L.lifecycle.stage, '| direction', L.lifecycle.direction);
  console.log('strength   :', L.lifecycle.lifecycleStrength, '| freshness', L.lifecycle.freshness, '| exhaustion', L.lifecycle.exhaustion);
  console.log('progression:', JSON.stringify(L.lifecycle.progression));
  console.log('invalidation:', JSON.stringify(L.lifecycle.invalidation));

  console.log('\n-- M7 probability --');
  console.log('mostLikely :', JSON.stringify(L.probability.mostLikelyOutcome), '| dominantDir', JSON.stringify(L.probability.dominantDirection));

  console.log('\n-- M8 synthesis --');
  console.log('headline   :', m.headline.state, '| bias', m.headline.bias, '| stage', m.headline.stage);
  console.log('quality    :', m.quality.level, `(${m.quality.score})  ${m.quality.reasons.join('; ')}`);
  console.log('opportunity:', m.opportunity.grade, `(${m.opportunity.score})`);
  console.log('risk       :', m.risk.level, `(${m.risk.score})  reasons: ${m.risk.reasons.join('; ') || 'none'}`);
  console.log('readiness  :', m.readiness.state, '—', m.readiness.reason);
  console.log('scores     :', JSON.stringify(m.diagnostics.scores));

  console.log('\n-- M9 decision --');
  console.log('action     :', decision.action, '| gate', decision.gate.blockedBy, '—', decision.gate.reason);
}

main().catch((e) => { console.error(e); process.exit(1); });
