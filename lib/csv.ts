import type { Candle } from './types';
import type { PaperTrade } from './paper';
import { tradeDirection, tradeExit, tradePnlPct, tradeRR, tradeOutcome } from './trading';

const CSV_HEADER = 'time,open,high,low,close,volume';

const TRADE_HEADER =
  '#,Side,Entry Price,Exit Price,Entry Time,Exit Time,Quantity,R:R,P&L ($),P&L (%),Outcome';

const isoOrBlank = (sec?: number) => (sec ? new Date(sec * 1000).toISOString() : '');

/** Serialize closed trades to CSV (newest-first, numbered from the top). */
export function tradesToCsv(trades: PaperTrade[]): string {
  const rows: string[] = [TRADE_HEADER];
  trades.forEach((t, i) => {
    const rr = tradeRR(t);
    const pct = tradePnlPct(t);
    rows.push(
      [
        i + 1,
        tradeDirection(t).toUpperCase(),
        t.entryPrice ?? '',
        tradeExit(t),
        isoOrBlank(t.entryTs),
        isoOrBlank(t.ts),
        t.units,
        rr != null ? rr.toFixed(2) : '',
        t.realizedPnl.toFixed(2),
        pct != null ? pct.toFixed(2) : '',
        tradeOutcome(t),
      ]
        .map(escapeField)
        .join(','),
    );
  });
  return rows.join('\n');
}

function escapeField(v: string | number): string {
  if (typeof v === 'number') return String(v);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function candlesToCsv(candles: Candle[]): string {
  const rows: string[] = [CSV_HEADER];
  for (const c of candles) {
    rows.push(
      [
        new Date(c.time * 1000).toISOString(),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
      ]
        .map(escapeField)
        .join(','),
    );
  }
  return rows.join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
