import type { Candle } from './types';
import type { IndicatorDef } from './indicatorLibrary';
import { candleColumns } from './indicatorLibrary';
import * as its from 'indicatorts';

/** A single chart series point ({ time, value }) after null/NaN filtering. */
export interface ChartPoint {
  time: Candle['time'];
  value: number | null;
}

export interface ComputedLine {
  label: string;
  type: 'line' | 'histogram';
  values: (number | null)[];
  data: ChartPoint[];
  color: string;
}

export interface ComputedBand {
  label: string;
  upper: (number | null)[];
  lower: (number | null)[];
  middle: (number | null)[];
  upperColor: string;
  lowerColor: string;
  middleColor: string;
  upperData: ChartPoint[];
  lowerData: ChartPoint[];
  middleData: ChartPoint[];
}

export interface ComputedCloud {
  label: string;
  upper: (number | null)[];
  lower: (number | null)[];
  color: string;
}

export interface ComputedIndicator {
  id: string;
  separatePane: boolean;
  lines: ComputedLine[];
  bands: ComputedBand[];
  clouds: ComputedCloud[];
  def: IndicatorDef;
}

type Params = Record<string, number>;

export function pad(src: number[], n: number): (number | null)[] {
  if (src.length >= n) return src as (number | null)[];
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < src.length; i++) out[n - src.length + i] = src[i];
  return out;
}

function L(label: string, type: 'line' | 'histogram', values: (number | null)[], color: string, candles: Candle[]): ComputedLine {
  const data = values.map((v, i) => ({ time: candles[i].time, value: v })).filter((d) => d.value !== null && !isNaN(d.value));
  return { label, type, values, data, color };
}

function mapData(values: (number | null)[], candles: Candle[]) {
  return values.map((v, i) => ({ time: candles[i].time, value: v })).filter((d) => d.value !== null && !isNaN(d.value));
}

export function computeIndicator(def: IndicatorDef, candles: Candle[], params: Params): ComputedIndicator {
  const n = candles.length;
  // Convert to numbers so indicatorts accepts them
  const c = Array.from(candleColumns(candles).close);
  const h = Array.from(candleColumns(candles).high);
  const l = Array.from(candleColumns(candles).low);

  const out: ComputedIndicator = {
    id: def.id,
    separatePane: def.separatePane,
    lines: [],
    bands: [],
    clouds: [],
    def,
  };

  const p = (key: string, defVal: number) => params[key] ?? defVal;

  try {
    switch (def.id.toLowerCase()) {
      case 'sma':         out.lines.push(L('SMA', 'line', pad(its.sma(c, { period: p('period', 14) }), n), '#5aa2e6', candles)); break;
      case 'ema':         out.lines.push(L('EMA', 'line', pad(its.ema(c, { period: p('period', 14) }), n), '#5aa2e6', candles)); break;
      case 'rsi':         out.lines.push(L('RSI', 'line', pad(its.rsi(c, { period: p('period', 14) }), n), '#5aa2e6', candles)); break;
      case 'macd': {
        const r = its.macd(c, { fast: p('fast', 12), slow: p('slow', 26), signal: p('signal', 9) });
        const histogram = r.macdLine.map((m, i) => m - (r.signalLine[i] ?? 0));
        out.lines.push(L('MACD', 'line', pad(r.macdLine, n), '#5aa2e6', candles));
        out.lines.push(L('Signal', 'line', pad(r.signalLine, n), '#f5b13b', candles));
        out.lines.push(L('Hist', 'histogram', pad(histogram, n), '#7b88a0', candles));
        break;
      }
      case 'atr':         out.lines.push(L('ATR', 'line', pad(its.atr(h, l, c, { period: p('period', 14) }).atrLine, n), '#5aa2e6', candles)); break;
      case 'bb': {
        // BBConfig only accepts `period`; indicatorts derives the 2-stdDev bands internally.
        const r = its.bb(c, { period: p('period', 20) });
        if (r && r.upper && r.lower && r.middle) {
          const upper = pad(r.upper, n);
          const lower = pad(r.lower, n);
          const middle = pad(r.middle, n);
          out.bands.push({ 
            label: 'BB', upper, lower, middle, 
            upperColor: '#5aa2e6', lowerColor: '#5aa2e6', middleColor: '#7b88a0',
            upperData: mapData(upper, candles), lowerData: mapData(lower, candles), middleData: mapData(middle, candles)
          });
        }
        break;
      }
    }
  } catch (e) {
    console.warn(`Indicator ${def.id} compute failed:`, e);
  }

  return out;
}