'use client';

// Confluence-at-a-glance: rows = indicators, columns = timeframes,
// cells = B / S / —. Renders from the same per-timeframe TFSnapshot
// data that drives the mood verdict and the chart markers, so the
// matrix can never disagree with what the rest of the dashboard shows.
//
// Each cell carries direction by COLOR + LETTER + position (not hue
// alone), so it reads for colorblind users. The Verdict row is the
// combined signal (EMA + RSI confluence) — the same one the chart's
// BUY/SELL markers use.

import type { TFSnapshot } from '@/lib/signals';
import type { Signal, Timeframe } from '@/lib/types';

export type IndicatorCell = 'buy' | 'sell' | 'neutral';

export interface IndicatorMatrixRow {
  key: string;
  label: string;
  sub: string;
  cells: Record<string, IndicatorCell>;
}

interface SignalMatrixProps {
  snapshots: Record<Timeframe, TFSnapshot | null>;
  timeframes: Timeframe[];
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  /** Per-TF custom indicator directions from activeIndicators. */
  indicatorRows?: IndicatorMatrixRow[];
}

type CellSide = Signal['side']; // 'buy' | 'sell' | 'neutral'

interface Row {
  key: string;
  label: string;
  sub: string;
  cell: (s: TFSnapshot) => CellSide;
}

// EMA9 above EMA21 = bullish bias; below = bearish. Identical to
// scoreSignal's direction component, so this never drifts.
function emaCellSide(s: TFSnapshot): CellSide {
  if (s.ema9 == null || s.ema21 == null) return 'neutral';
  if (s.ema9 > s.ema21) return 'buy';
  if (s.ema9 < s.ema21) return 'sell';
  return 'neutral';
}

// RSI cells reflect the *standard reading*: under 30 oversold (bullish
// reversal lean), over 70 overbought (bearish reversal lean), in
// between is neutral. (Distinct from the scoring rule, which uses
// 60/40 lean and 80/20 veto — this is what a trader expects to see in
// an RSI row.)
function rsiCellSide(s: TFSnapshot): CellSide {
  if (s.rsi14 == null) return 'neutral';
  if (s.rsi14 <= 30) return 'buy';
  if (s.rsi14 >= 70) return 'sell';
  return 'neutral';
}

const ROWS: Row[] = [
  {
    key: 'ema',
    label: 'EMA cross',
    sub: '9 / 21',
    cell: emaCellSide,
  },
  {
    key: 'rsi',
    label: 'RSI',
    sub: '14',
    cell: rsiCellSide,
  },
  {
    key: 'verdict',
    label: 'Verdict',
    sub: 'combined',
    cell: (s) => s.signal.side,
  },
];

const CELL_STYLE: Record<CellSide, string> = {
  buy: 'bg-bull/12 text-bull-bright ring-bull/30',
  sell: 'bg-bear/12 text-bear-bright ring-bear/30',
  neutral: 'bg-neutral/8 text-ink-faint ring-neutral/20',
};

const CELL_LETTER: Record<CellSide, string> = {
  buy: 'B',
  sell: 'S',
  neutral: '—',
};

const CELL_TITLE: Record<CellSide, string> = {
  buy: 'BUY',
  sell: 'SELL',
  neutral: 'WAIT',
};

export default function SignalMatrix({
  snapshots,
  timeframes,
  selected,
  onSelectTf,
  indicatorRows = [],
}: SignalMatrixProps) {
  return (
    <section
      aria-label="Signal matrix"
      className="panel rounded-2xl p-4"
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Signal matrix
        </h2>
        <span className="text-[10px] text-ink-faint">B · S · —</span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1.5">
          <thead>
            <tr>
              <th className="w-[44%] text-left text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                Indicator
              </th>
              {timeframes.map((tf) => {
                const isActive = tf === selected;
                return (
                  <th
                    key={tf}
                    scope="col"
                    className="px-0.5 text-center"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectTf(tf)}
                      aria-pressed={isActive}
                      title={`Focus chart on ${tf}`}
                      className={[
                        'focus-ring inline-block w-full rounded font-mono text-[10px] uppercase tracking-wider transition-colors',
                        isActive ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
                      ].join(' ')}
                    >
                      {tf}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="py-1 pr-2 text-left align-middle font-normal"
                >
                  <span className="block text-xs text-ink">{row.label}</span>
                  <span className="block font-mono text-[10px] text-ink-faint">
                    {row.sub}
                  </span>
                </th>
                {timeframes.map((tf) => {
                  const s = snapshots[tf];
                  const side: CellSide = s ? row.cell(s) : 'neutral';
                  return (
                    <td key={tf} className="px-0.5 py-0.5 align-middle">
                      <Cell side={side} dim={!s} tf={tf} row={row.label} />
                    </td>
                  );
                })}
              </tr>
            ))}
            {indicatorRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="py-1 pr-2 text-left align-middle font-normal">
                  <span className="block text-xs text-ink">{row.label}</span>
                  <span className="block font-mono text-[10px] text-ink-faint">{row.sub}</span>
                </th>
                {timeframes.map((tf) => {
                  const side = row.cells[tf] ?? 'neutral';
                  return (
                    <td key={tf} className="px-0.5 py-0.5 align-middle">
                      <Cell side={side} dim={false} tf={tf} row={row.label} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
        Cells reflect the same signals that drive the mood verdict and chart
        markers. EMA cross = EMA9 vs EMA21 direction. RSI = standard 30 / 70
        overbought/oversold bands. Verdict = combined EMA + RSI confluence.
      </p>
    </section>
  );
}

function Cell({
  side,
  dim,
  tf,
  row,
}: {
  side: CellSide;
  dim: boolean;
  tf: Timeframe;
  row: string;
}) {
  return (
    <span
      title={`${row} · ${tf}: ${CELL_TITLE[side]}`}
      aria-label={`${row}, ${tf}: ${CELL_TITLE[side]}`}
      className={[
        'mx-auto flex h-7 w-full max-w-[34px] items-center justify-center rounded-md font-mono text-xs font-bold ring-1 transition-opacity',
        CELL_STYLE[side],
        dim ? 'opacity-40' : '',
      ].join(' ')}
    >
      {CELL_LETTER[side]}
    </span>
  );
}
