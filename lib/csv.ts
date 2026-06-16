import type { Candle } from './types';

const CSV_HEADER = 'time,open,high,low,close,volume';

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
