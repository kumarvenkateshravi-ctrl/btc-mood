// A library of math functions that closely mimic TradingView's PineScript built-ins.
// All functions return arrays of the same length as the input `src`, padded with `null` at the start.

export function sma(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < src.length; i++) {
    const val = src[i];
    if (val !== null) {
      sum += val;
      count++;
    }
    
    if (i >= length) {
      const drop = src[i - length];
      if (drop !== null) {
        sum -= drop;
        count--;
      }
    }
    
    if (count === length) {
      out[i] = sum / length;
    }
  }
  return out;
}

export function ema(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  
  const alpha = 2 / (length + 1);
  let hasInit = false;
  let currentEma = 0;
  
  let sum = 0;
  let count = 0;

  for (let i = 0; i < src.length; i++) {
    const val = src[i];
    if (val === null) continue;
    
    if (!hasInit) {
      sum += val;
      count++;
      if (count === length) {
        currentEma = sum / length;
        out[i] = currentEma;
        hasInit = true;
      }
    } else {
      currentEma = alpha * val + (1 - alpha) * currentEma;
      out[i] = currentEma;
    }
  }
  return out;
}

export function rma(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  
  const alpha = 1 / length;
  let hasInit = false;
  let currentRma = 0;
  
  let sum = 0;
  let count = 0;

  for (let i = 0; i < src.length; i++) {
    const val = src[i];
    if (val === null) continue;
    
    if (!hasInit) {
      sum += val;
      count++;
      if (count === length) {
        currentRma = sum / length;
        out[i] = currentRma;
        hasInit = true;
      }
    } else {
      currentRma = alpha * val + (1 - alpha) * currentRma;
      out[i] = currentRma;
    }
  }
  return out;
}

export function wma(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  
  const norm = (length * (length + 1)) / 2;
  
  for (let i = length - 1; i < src.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const val = src[i - j];
      if (val === null) {
        valid = false;
        break;
      }
      const weight = length - j;
      sum += val * weight;
    }
    if (valid) {
      out[i] = sum / norm;
    }
  }
  return out;
}

export function vwma(src: (number | null)[], volume: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  
  for (let i = length - 1; i < src.length; i++) {
    let sumPV = 0;
    let sumV = 0;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const p = src[i - j];
      const v = volume[i - j];
      if (p === null || v === null) {
        valid = false;
        break;
      }
      sumPV += p * v;
      sumV += v;
    }
    if (valid && sumV !== 0) {
      out[i] = sumPV / sumV;
    }
  }
  return out;
}

export function stdev(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 1) return out;
  
  for (let i = length - 1; i < src.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const val = src[i - j];
      if (val === null) {
        valid = false;
        break;
      }
      sum += val;
    }
    
    if (!valid) continue;
    
    const mean = sum / length;
    let sqSum = 0;
    for (let j = 0; j < length; j++) {
      const val = src[i - j] as number;
      sqSum += (val - mean) * (val - mean);
    }
    
    // PineScript ta.stdev is biased (population stdev)
    out[i] = Math.sqrt(sqSum / length); 
  }
  return out;
}

export function crossover(src1: (number | null)[], src2: (number | null)[]): boolean[] {
  const out = new Array<boolean>(src1.length).fill(false);
  for (let i = 1; i < src1.length; i++) {
    const s1_curr = src1[i];
    const s1_prev = src1[i - 1];
    const s2_curr = src2[i];
    const s2_prev = src2[i - 1];
    if (s1_curr !== null && s1_prev !== null && s2_curr !== null && s2_prev !== null) {
      out[i] = s1_prev < s2_prev && s1_curr > s2_curr;
    }
  }
  return out;
}

export function crossunder(src1: (number | null)[], src2: (number | null)[]): boolean[] {
  const out = new Array<boolean>(src1.length).fill(false);
  for (let i = 1; i < src1.length; i++) {
    const s1_curr = src1[i];
    const s1_prev = src1[i - 1];
    const s2_curr = src2[i];
    const s2_prev = src2[i - 1];
    if (s1_curr !== null && s1_prev !== null && s2_curr !== null && s2_prev !== null) {
      out[i] = s1_prev > s2_prev && s1_curr < s2_curr;
    }
  }
  return out;
}

export function multiply(src: (number | null)[], multiplier: number): (number | null)[] {
  return src.map(v => v !== null ? v * multiplier : null);
}

export function add(src1: (number | null)[], src2: (number | null)[]): (number | null)[] {
  return src1.map((v, i) => (v !== null && src2[i] !== null ? v + src2[i]! : null));
}

export function subtract(src1: (number | null)[], src2: (number | null)[]): (number | null)[] {
  return src1.map((v, i) => (v !== null && src2[i] !== null ? v - src2[i]! : null));
}

export function divide(src1: (number | null)[], src2: (number | null)[]): (number | null)[] {
  return src1.map((v, i) => (v !== null && src2[i] !== null && src2[i] !== 0 ? v / src2[i]! : null));
}

// PineScript ta.highest(src, length): highest value over the last `length` bars.
export function highest(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  for (let i = length - 1; i < src.length; i++) {
    let best: number | null = null;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const v = src[i - j];
      if (v === null) { valid = false; break; }
      if (best === null || v > best) best = v;
    }
    if (valid) out[i] = best;
  }
  return out;
}

// PineScript ta.lowest(src, length): lowest value over the last `length` bars.
export function lowest(src: (number | null)[], length: number): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 0) return out;
  for (let i = length - 1; i < src.length; i++) {
    let best: number | null = null;
    let valid = true;
    for (let j = 0; j < length; j++) {
      const v = src[i - j];
      if (v === null) { valid = false; break; }
      if (best === null || v < best) best = v;
    }
    if (valid) out[i] = best;
  }
  return out;
}

// True range per bar: max(high-low, |high-prevClose|, |low-prevClose|).
// First bar's TR is simply high - low (no previous close).
export interface TrueRangeInput {
  high: number;
  low: number;
  close: number;
}
export function tr(candles: TrueRangeInput[]): (number | null)[] {
  const out = new Array<number | null>(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      out[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      out[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      );
    }
  }
  return out;
}

// PineScript ta.linreg(src, length, offset):
//   Least-squares linear regression over `length` points,
//   evaluated at `offset` bars ago. offset=0 returns the regression
//   value at the current bar; offset > 0 projects into the future.
export function linreg(src: (number | null)[], length: number, offset = 0): (number | null)[] {
  const out = new Array<number | null>(src.length).fill(null);
  if (length <= 1) return out;
  // Iterate over all output positions. The regression window ends at
  // targetIdx = i - offset, so we need src[targetIdx-(length-1)..targetIdx]
  // to exist and be non-null.
  for (let i = 0; i < src.length; i++) {
    const targetIdx = i - offset;
    if (targetIdx < length - 1) continue;
    if (targetIdx >= src.length) continue;
    // Solve least-squares: y = a + b*x using x in [0..length-1].
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    let n = 0;
    for (let k = 0; k < length; k++) {
      const y = src[targetIdx - k];
      if (y === null) { n = 0; break; }
      const x = length - 1 - k;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
      n++;
    }
    if (n !== length) continue;
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) continue;
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    // PineScript: project the regression `offset` bars past the window's
    // last point. With x in [0..length-1], the window's last x is
    // length-1. Projection = a + b * (length - 1 + offset).
    out[i] = a + b * (length - 1 + offset);
  }
  return out;
}

// Reference a previous value like PineScript's [n] operator.
// Returns null when the referenced index is out of bounds or the
// underlying value is null.
export function ref<T>(arr: (T | null)[], n: number): (T | null)[] {
  const out = new Array<T | null>(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    out[i] = i - n >= 0 ? arr[i - n] : null;
  }
  return out;
}

// Non-zero previous value lookup, like PineScript's nz() with default null.
// (Most callers will replace null with their own default; this just
// returns the array unchanged in shape.)
export function nz<T>(arr: (T | null)[]): (T | null)[] {
  return arr.map((v) => (v === null ? null : v));
}
