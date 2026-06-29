import type { Candle } from '../types';
import type { GoldenFixture, GoldenTolerance } from './goldenMaster';
import { DEFAULT_TOLERANCE } from './goldenMaster';

export interface TradingViewCsvPlotColumn {
  /** Existing app plot id, e.g. "rsi" or "rsiMa". */
  plotId: string;
  /** CSV column header exported by TradingView. */
  column: string;
}

export interface BuildTradingViewFixtureOptions {
  indicator: string;
  csv: string;
  params: Record<string, unknown>;
  plots: TradingViewCsvPlotColumn[];
  capturedAt?: string;
  note?: string;
  tolerance?: GoldenTolerance;
  /** Capture only the last N rows. Defaults to every non-empty exported value. */
  lastN?: number;
}

type CsvRecord = Record<string, string>;

const REQUIRED_CANDLE_COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

export function buildTradingViewFixtureFromCsv(
  opts: BuildTradingViewFixtureOptions,
): GoldenFixture {
  const rows = parseCsv(opts.csv);
  if (rows.length === 0) throw new Error('TradingView CSV has no data rows.');

  assertColumns(rows[0], [...REQUIRED_CANDLE_COLUMNS, ...opts.plots.map((p) => p.column)]);

  const candles = rows.map(rowToCandle);
  const start = opts.lastN == null ? 0 : Math.max(0, rows.length - opts.lastN);
  const expected: GoldenFixture['expected']['plots'] = {};

  for (const plot of opts.plots) {
    const values: Record<string, number | null> = {};
    for (let i = start; i < rows.length; i++) {
      const cell = parseMaybeNumber(readColumn(rows[i], plot.column));
      if (cell !== undefined) values[String(i)] = cell;
    }
    expected[plot.plotId] = values;
  }

  return {
    indicator: opts.indicator,
    source: 'tradingview',
    capturedAt: opts.capturedAt ?? new Date().toISOString().slice(0, 10),
    note: opts.note,
    params: opts.params,
    tolerance: opts.tolerance ?? DEFAULT_TOLERANCE,
    candles,
    expected: { plots: expected },
  };
}

export function parseTradingViewCsv(csv: string): CsvRecord[] {
  return parseCsv(csv);
}

function parseCsv(csv: string): CsvRecord[] {
  const rows = parseCsvRows(csv.trim());
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const record: CsvRecord = {};
      headers.forEach((header, i) => {
        record[header] = row[i]?.trim() ?? '';
      });
      return record;
    });
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const next = csv[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function assertColumns(row: CsvRecord, columns: string[]): void {
  const available = new Set(Object.keys(row).map((c) => c.toLowerCase()));
  const missing = columns.filter((c) => !available.has(c.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`TradingView CSV missing column(s): ${missing.join(', ')}`);
  }
}

function rowToCandle(row: CsvRecord): Candle {
  return {
    time: parseTimeSeconds(readColumn(row, 'time')),
    open: parseRequiredNumber(readColumn(row, 'open'), 'open'),
    high: parseRequiredNumber(readColumn(row, 'high'), 'high'),
    low: parseRequiredNumber(readColumn(row, 'low'), 'low'),
    close: parseRequiredNumber(readColumn(row, 'close'), 'close'),
    volume: parseRequiredNumber(readColumn(row, 'volume'), 'volume'),
  };
}

function readColumn(row: CsvRecord, name: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  return key == null ? '' : row[key];
}

function parseTimeSeconds(raw: string): number {
  const value = raw.trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.round(numeric / 1000) : numeric;

  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`Invalid TradingView time value: ${raw}`);
  return Math.floor(millis / 1000);
}

function parseRequiredNumber(raw: string, column: string): number {
  const value = parseMaybeNumber(raw);
  if (typeof value !== 'number') throw new Error(`Invalid TradingView ${column} value: ${raw}`);
  return value;
}

function parseMaybeNumber(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === '') return undefined;
  if (value.toLowerCase() === 'na' || value.toLowerCase() === 'nan') return null;
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid TradingView numeric value: ${raw}`);
  return parsed;
}
