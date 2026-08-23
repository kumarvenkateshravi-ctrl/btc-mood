import type { Candle } from '../types';
import type { IndicatorPlot, IndicatorResult } from '../indicatorFramework';
import type { IncrementalIndicatorFactory } from '../incrementalIndicatorEngine';
import { resolveInputs } from './itsTemplates';
import { vwapPeriodKey, type VwapAnchor } from './vwapAnchor';

function source(c: Candle, name: string): number {
  switch (name) {
    case 'open': return c.open;
    case 'high': return c.high;
    case 'low': return c.low;
    case 'hl2': return (c.high + c.low) / 2;
    case 'hlc3': return (c.high + c.low + c.close) / 3;
    case 'ohlc4': return (c.open + c.high + c.low + c.close) / 4;
    case 'close':
    default: return c.close;
  }
}

function replacePlot(result: IndicatorResult, plotId: string, data: IndicatorPlot['data'], signals?: IndicatorResult['signals']): IndicatorResult {
  return {
    ...result,
    plots: result.plots.map(plot => plot.id === plotId ? { ...plot, data } : plot),
    signals: signals ?? result.signals,
  };
}

function appendPlot(result: IndicatorResult, plotId: string, value: IndicatorPlot['data'][number], signal = 'neutral' as const): IndicatorResult {
  return {
    ...result,
    plots: result.plots.map(plot => plot.id === plotId ? { ...plot, data: [...plot.data, value] } : plot),
    signals: [...result.signals, signal],
  };
}

export const incrementalSma: IncrementalIndicatorFactory = ({ compute, config, computedSources }) => {
  const defaults = { length: 9, source: 'close' };
  const { length, source: sourceName } = resolveInputs(config, defaults);
  const period = Math.max(1, Number(length));
  let history: Candle[] = [];
  let values: (number | null)[] = [];
  let result: IndicatorResult;
  const valueAt = (i: number) => {
    if (computedSources?.[`${config?.id ?? ''}:smaLine`]) return computedSources[`${config?.id ?? ''}:smaLine`][i] ?? null;
    return source(history[i], String(sourceName));
  };
  const calculate = (i: number): number | null => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const value = valueAt(j);
      if (value == null || !Number.isFinite(value)) return null;
      sum += value;
    }
    return sum / period;
  };
  const initialize = (next: Candle[]) => {
    history = next.slice();
    result = compute(history, config, computedSources);
    values = (result.plots.find(plot => plot.id === 'smaLine')?.data ?? []).map(value => typeof value === 'number' ? value : null);
    return result;
  };
  const update = (bar: Candle, append: boolean) => {
    if (append) history = [...history, bar]; else history = [...history.slice(0, -1), bar];
    const index = history.length - 1;
    values = values.slice(0, append ? index : index);
    values[index] = calculate(index);
    result = append ? appendPlot(result, 'smaLine', values[index]) : replacePlot(result, 'smaLine', values);
    if (append) values = [...values];
    return result;
  };
  return {
    initialize,
    rebuild: initialize,
    updateLast: bar => update(bar, false),
    append: bar => update(bar, true),
  };
};

export const incrementalObv: IncrementalIndicatorFactory = ({ compute, config }) => {
  let history: Candle[] = [];
  let values: (number | null)[] = [];
  let result: IndicatorResult;
  const calculate = (i: number) => {
    if (i === 0) return null;
    const previous = values[i - 1] ?? 0;
    const change = history[i].close - history[i - 1].close;
    return previous + (change > 0 ? history[i].volume : change < 0 ? -history[i].volume : 0);
  };
  const initialize = (next: Candle[]) => {
    history = next.slice(); result = compute(history, config); 
    values = (result.plots.find(plot => plot.id === 'obv')?.data ?? []).map(value => typeof value === 'number' ? value : null);
    return result;
  };
  const update = (bar: Candle, append: boolean) => {
    if (append) history = [...history, bar]; else history = [...history.slice(0, -1), bar];
    const i = history.length - 1;
    values = values.slice(0, i); values[i] = calculate(i);
    result = append ? appendPlot(result, 'obv', values[i]) : replacePlot(result, 'obv', values);
    return result;
  };
  return { initialize, rebuild: initialize, updateLast: bar => update(bar, false), append: bar => update(bar, true) };
};

export const incrementalVwap: IncrementalIndicatorFactory = ({ compute, config, computedSources }) => {
  const { anchor, source: sourceName } = resolveInputs(config, { anchor: 'session' as VwapAnchor, source: 'hlc3' });
  let history: Candle[] = [];
  let values: (number | null)[] = [];
  let result: IndicatorResult;
  const calculate = (i: number) => {
    const key = vwapPeriodKey(history[i].time, anchor as VwapAnchor);
    let pv = 0; let volume = 0;
    for (let j = i; j >= 0 && vwapPeriodKey(history[j].time, anchor as VwapAnchor) === key; j -= 1) {
      const value = computedSources?.[`${config?.id}:vwap`]?.[j] ?? source(history[j], String(sourceName));
      pv += value * history[j].volume; volume += history[j].volume;
    }
    return volume > 0 ? pv / volume : null;
  };
  const initialize = (next: Candle[]) => {
    history = next.slice(); result = compute(history, config, computedSources);
    values = (result.plots.find(plot => plot.id === 'vwap')?.data ?? []).map(value => typeof value === 'number' ? value : null);
    return result;
  };
  const update = (bar: Candle, append: boolean) => {
    if (append) history = [...history, bar]; else history = [...history.slice(0, -1), bar];
    const i = history.length - 1; values = values.slice(0, i); values[i] = calculate(i);
    result = append ? appendPlot(result, 'vwap', values[i]) : replacePlot(result, 'vwap', values); return result;
  };
  return { initialize, rebuild: initialize, updateLast: bar => update(bar, false), append: bar => update(bar, true) };
};

export const incrementalAtr: IncrementalIndicatorFactory = ({ compute, config }) => {
  const { length, smoothing } = resolveInputs(config, { length: 14, smoothing: 'RMA' });
  const period = Math.max(1, Number(length));
  const type = String(smoothing);
  let history: Candle[] = []; let values: (number | null)[] = []; let ranges: number[] = []; let result: IndicatorResult;
  const trAt = (i: number) => i === 0 ? history[0].high - history[0].low : Math.max(history[i].high - history[i].low, Math.abs(history[i].high - history[i - 1].close), Math.abs(history[i].low - history[i - 1].close));
  const calculate = (i: number): number | null => {
    ranges[i] = trAt(i);
    if (type === 'SMA') {
      if (i < period - 1) return null;
      return ranges.slice(i - period + 1, i + 1).reduce((sum, value) => sum + value, 0) / period;
    }
    if (type === 'WMA') {
      if (i < period - 1) return null;
      let sum = 0; let weight = 0;
      for (let j = 0; j < period; j += 1) { sum += ranges[i - j] * (period - j); weight += period - j; }
      return sum / weight;
    }
    if (type === 'EMA') {
      if (i === 0) return ranges[0];
      const prev = values[i - 1]; return prev == null ? ranges[i] : (2 / (period + 1)) * ranges[i] + (1 - 2 / (period + 1)) * prev;
    }
    if (i < period - 1) return null;
    if (i === period - 1) return ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const previous = values[i - 1]; return previous == null ? null : (ranges[i] + (period - 1) * previous) / period;
  };
  const initialize = (next: Candle[]) => {
    history = next.slice(); result = compute(history, config); values = (result.plots[0]?.data ?? []).map(value => typeof value === 'number' ? value : null); ranges = history.map((_, i) => trAt(i)); return result;
  };
  const update = (bar: Candle, append: boolean) => {
    if (append) history = [...history, bar]; else history = [...history.slice(0, -1), bar];
    const i = history.length - 1; values = values.slice(0, i); values[i] = calculate(i);
    result = append ? appendPlot(result, 'atr', values[i]) : replacePlot(result, 'atr', values); return result;
  };
  return { initialize, rebuild: initialize, updateLast: bar => update(bar, false), append: bar => update(bar, true) };
};

