import { describe, it, expect } from 'vitest';
import { parseCondition } from './dsl';

function ok(text: string) {
  const r = parseCondition(text);
  if (!r.ok) throw new Error(`expected parse, got: ${r.error}`);
  return r.condition;
}

describe('Quick-Add DSL', () => {
  it('parses "RSI(14) > 55 on 15m"', () => {
    const c = ok('RSI(14) > 55 on 15m');
    expect(c.left.source).toBe('rsi');
    expect(c.left.output).toBe('rsi');
    expect(c.op).toBe('gt');
    expect(c.right).toBe(55);
    expect(c.tf).toBe('15m');
  });

  it('parses length from EMA20 and a series right-hand side', () => {
    const c = ok('EMA20 crosses above EMA50');
    expect(c.left.source).toBe('ema');
    expect(c.left.params).toEqual({ length: 20 });
    expect(c.op).toBe('crossAbove');
    expect(c.right).toEqual({ source: 'ema', output: expect.any(String), params: { length: 50 } });
  });

  it('defaults the timeframe when "on" is omitted', () => {
    expect(parseCondition('volume > 1.5', '5m')).toMatchObject({ ok: true, condition: { tf: '5m' } });
  });

  it('parses word aliases for operators', () => {
    expect(ok('rsi above 60').op).toBe('gt');
    expect(ok('adx at least 25').op).toBe('gte');
    expect(ok('price under 60000').op).toBe('lt');
  });

  it('parses unary rising/falling with no right side', () => {
    const c = ok('RSI(14) rising on 1h');
    expect(c.op).toBe('increasing');
    expect(c.tf).toBe('1h');
  });

  it('parses SMC shorthand: score and stage words', () => {
    expect(ok('smc score >= 75 on 1h')).toMatchObject({ left: { source: 'smc_state', output: 'institutional' }, op: 'gte', right: 75 });
    expect(ok('smc stage >= ready')).toMatchObject({ left: { output: 'setup' }, op: 'gte', right: 3 });
  });

  it('gives a helpful error for an unknown source', () => {
    const r = parseCondition('foobar > 5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/source/i);
  });

  it('gives a helpful error for a bad timeframe', () => {
    const r = parseCondition('rsi > 55 on 7m');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timeframe/i);
  });

  it('rejects a missing right side with a hint', () => {
    const r = parseCondition('rsi >');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toBeTruthy();
  });
});
