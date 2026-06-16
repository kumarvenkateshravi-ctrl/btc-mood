import * as its from 'indicatorts';

export function ema(data: number[], period: number): (number | null)[] {
  if (data.length < period) return new Array(data.length).fill(null);
  const res = its.ema(data, { period });
  const out = new Array(data.length).fill(null);
  const offset = data.length - res.length;
  for (let i = 0; i < res.length; i++) {
    out[i + offset] = res[i];
  }
  return out;
}

export function rsi(data: number[], period = 14): (number | null)[] {
  if (data.length <= period) return new Array(data.length).fill(null);
  const res = its.rsi(data, { period });
  const out = new Array(data.length).fill(null);
  const offset = data.length - res.length;
  for (let i = 0; i < res.length; i++) {
    out[i + offset] = res[i];
  }
  return out;
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  if (highs.length <= period) return new Array(highs.length).fill(null);
  const res = its.atr(highs, lows, closes, { period });
  const vals: number[] = Array.isArray(res) ? res : res.atrLine;
  const out = new Array(highs.length).fill(null);
  const offset = highs.length - vals.length;
  for (let i = 0; i < vals.length; i++) {
    out[i + offset] = vals[i];
  }
  return out;
}
