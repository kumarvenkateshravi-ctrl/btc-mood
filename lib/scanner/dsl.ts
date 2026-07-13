// Quick-Add DSL (Strategy Studio M6) — type a condition in trader shorthand:
//   "RSI(14) > 55 on 15m"
//   "EMA20 crosses above EMA50"
//   "volume > 1.5 on 5m"
//   "smc score >= 75 on 1h"
//   "smc stage >= ready"
// Deterministic, no LLM. Becomes the AI Builder's target format later, so the
// grammar stays small and inspectable.

import type { Condition, OperatorId, SeriesRef } from './types';
import { SCANNER_SOURCES } from './registry';
import { TIMEFRAMES, type Timeframe } from '../types';

export type DslResult =
  | { ok: true; condition: Condition }
  | { ok: false; error: string; hint?: string };

// Friendly keyword → registry source id (+ optional default output).
const SOURCE_ALIASES: Record<string, { id: string; output?: string }> = {
  ema: { id: 'ema' }, sma: { id: 'sma' }, rsi: { id: 'rsi', output: 'rsi' },
  macd: { id: 'macd', output: 'macd' }, adx: { id: 'adx', output: 'adx' },
  atr: { id: 'atr', output: 'atr' }, vwap: { id: 'vwap' }, volume: { id: 'volume' },
  obv: { id: 'obv', output: 'obv' }, price: { id: 'price', output: 'close' },
  close: { id: 'price', output: 'close' }, supertrend: { id: 'supertrend' },
  stochastic: { id: 'stochastic', output: 'k' }, stoch: { id: 'stochastic', output: 'k' },
  bollinger: { id: 'bollinger', output: 'basis' }, bb: { id: 'bollinger', output: 'basis' },
};

// "smc <noun>" special forms.
const SMC_ALIASES: Record<string, { id: string; output: string }> = {
  score: { id: 'smc_state', output: 'institutional' },
  institutional: { id: 'smc_state', output: 'institutional' },
  stage: { id: 'smc_state', output: 'setup' },
  setup: { id: 'smc_state', output: 'setup' },
  zone: { id: 'smc_state', output: 'zone' },
};
const STAGE_WORDS: Record<string, number> = { none: 0, watch: 1, building: 2, ready: 3, confirmed: 4 };

// "dsmart <noun>" special forms (p/arrow/star are the long-side shorthand;
// bearish variants live in the picker's output dropdown).
const DSMART_ALIASES: Record<string, { id: string; output: string }> = {
  regime: { id: 'dsmart_state', output: 'regime' },
  cloud: { id: 'dsmart_state', output: 'inCloud' },
  incloud: { id: 'dsmart_state', output: 'inCloud' },
  width: { id: 'dsmart_state', output: 'cloudWidth' },
  p: { id: 'dsmart_signal', output: 'pullbackBull' },
  pullback: { id: 'dsmart_signal', output: 'pullbackBull' },
  arrow: { id: 'dsmart_signal', output: 'arrowBull' },
  star: { id: 'dsmart_signal', output: 'starBull' },
};

// Symbol ops match by shape; word ops need a trailing boundary so "over" does
// not swallow the start of another word. Order matters: >= before >.
const OP_PATTERNS: Array<{ re: RegExp; op: OperatorId; unary?: boolean }> = [
  { re: /^crosses?\s+above\b/i, op: 'crossAbove' },
  { re: /^x\s*above\b/i, op: 'crossAbove' },
  { re: /^crosses?\s+below\b/i, op: 'crossBelow' },
  { re: /^x\s*below\b/i, op: 'crossBelow' },
  { re: /^(rising|increasing)\b/i, op: 'increasing', unary: true },
  { re: /^(falling|decreasing)\b/i, op: 'decreasing', unary: true },
  { re: /^>=/, op: 'gte' },
  { re: /^(at\s+least|gte)\b/i, op: 'gte' },
  { re: /^<=/, op: 'lte' },
  { re: /^(at\s+most|lte)\b/i, op: 'lte' },
  { re: /^>/, op: 'gt' },
  { re: /^(above|over)\b/i, op: 'gt' },
  { re: /^</, op: 'lt' },
  { re: /^(below|under)\b/i, op: 'lt' },
];

/** Parse a source token like "ema20", "rsi(14)", "smc score". Returns the ref
 *  and the remaining text. */
function parseSource(text: string): { ref: SeriesRef; rest: string } | null {
  const t = text.trimStart();
  // smc <noun>
  const smc = /^smc\s+(\w+)/i.exec(t);
  if (smc) {
    const alias = SMC_ALIASES[smc[1].toLowerCase()];
    if (alias) return { ref: { source: alias.id, output: alias.output, params: {} }, rest: t.slice(smc[0].length) };
  }
  // dsmart <noun>
  const dsm = /^dsmart\s+(\w+)/i.exec(t);
  if (dsm) {
    const alias = DSMART_ALIASES[dsm[1].toLowerCase()];
    if (alias) return { ref: { source: alias.id, output: alias.output, params: {} }, rest: t.slice(dsm[0].length) };
  }
  // name + optional length (name20 or name(20))
  const m = /^([a-z]+)\s*(?:\(\s*(\d+)\s*\)|(\d+))?/i.exec(t);
  if (!m) return null;
  const alias = SOURCE_ALIASES[m[1].toLowerCase()];
  if (!alias) return null;
  const source = SCANNER_SOURCES[alias.id];
  if (!source) return null;
  const len = m[2] ?? m[3];
  const params: Record<string, number> = {};
  if (len && source.params.some((p) => p.id === 'length')) params.length = Number(len);
  const output = alias.output ?? source.outputs[0]?.id ?? 'value';
  return { ref: { source: alias.id, output, params }, rest: t.slice(m[0].length) };
}

export function parseCondition(text: string, defaultTf: Timeframe = '15m'): DslResult {
  const raw = text.trim();
  if (!raw) return { ok: false, error: 'Type a condition.', hint: 'e.g. RSI(14) > 55 on 15m' };

  // Pull off a trailing "on <tf>".
  let body = raw;
  let tf = defaultTf;
  const onMatch = /\bon\s+([a-z0-9]+)\s*$/i.exec(body);
  if (onMatch) {
    const cand = onMatch[1].toLowerCase();
    if (!(TIMEFRAMES as readonly string[]).includes(cand)) {
      return { ok: false, error: `Unknown timeframe "${onMatch[1]}".`, hint: `Try one of ${TIMEFRAMES.join(', ')}.` };
    }
    tf = cand as Timeframe;
    body = body.slice(0, onMatch.index).trim();
  }

  const left = parseSource(body);
  if (!left) {
    return { ok: false, error: 'Could not read the indicator.', hint: 'Start with a source, e.g. EMA20, RSI(14), volume, smc score.' };
  }

  const afterLeft = left.rest.trimStart();
  const opMatch = OP_PATTERNS.find((p) => p.re.test(afterLeft));
  if (!opMatch) {
    return { ok: false, error: 'Could not read the operator.', hint: 'Use >, <, >=, <=, crosses above/below, rising, falling.' };
  }
  const afterOp = afterLeft.replace(opMatch.re, '').trim();

  if (opMatch.unary) {
    if (afterOp) return { ok: false, error: `"${afterOp}" is not needed after ${opMatch.op}.`, hint: 'e.g. RSI(14) rising on 15m' };
    return { ok: true, condition: { left: left.ref, op: opMatch.op, right: 0, tf } };
  }

  if (!afterOp) return { ok: false, error: 'Missing the value to compare against.', hint: 'e.g. RSI(14) > 55, or EMA20 crosses above EMA50' };

  // Right side: stage word, number, or another source.
  const stageWord = STAGE_WORDS[afterOp.toLowerCase()];
  if (stageWord != null) {
    return { ok: true, condition: { left: left.ref, op: opMatch.op, right: stageWord, tf } };
  }
  const numMatch = /^-?\d+(\.\d+)?/.exec(afterOp);
  if (numMatch && numMatch[0].length === afterOp.length) {
    return { ok: true, condition: { left: left.ref, op: opMatch.op, right: Number(afterOp), tf } };
  }
  const rightSrc = parseSource(afterOp);
  if (rightSrc && !rightSrc.rest.trim()) {
    return { ok: true, condition: { left: left.ref, op: opMatch.op, right: rightSrc.ref, tf } };
  }
  return { ok: false, error: `Could not read "${afterOp}".`, hint: 'The right side must be a number or another indicator (e.g. EMA50).' };
}
