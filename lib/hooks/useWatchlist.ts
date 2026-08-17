'use client';

import { useEffect, useState } from 'react';

export interface WatchlistRow {
  symbol: string;
  label: string;
  last: number;
  chg: number;
  chgPct: number;
  vol: number;
}

/** The watchlist roster. Both are valid compare symbols (chartable). */
export const WATCHLIST_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: 'BTCUSDT', label: 'BTCUSDT' },
];

/** Compact volume with ALWAYS 2 decimals: 9180 → "9.18K", 6_810_000 → "6.81M". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(Math.round(n));
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
}

/** Map one Binance 24hr ticker to a WatchlistRow (string fields → numbers). */
export function toWatchlistRow(t: BinanceTicker, label: string): WatchlistRow {
  return {
    symbol: t.symbol,
    label,
    last: +t.lastPrice,
    chg: +t.priceChange,
    chgPct: +t.priceChangePercent,
    vol: +t.volume,
  };
}

const POLL_MS = 2000;

/** Real-time Binance 24hr ticker & WebSocket stream for the watchlist roster.
 *  Combines immediate REST fetch + live WebSocket @ticker updates so watchlist prices
 *  and percent changes update instantly in real time alongside MTF mood. */
export function useWatchlist(): { rows: WatchlistRow[]; status: 'loading' | 'live' | 'error' } {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    const symbolsParam = encodeURIComponent(JSON.stringify(WATCHLIST_SYMBOLS.map((s) => s.symbol)));
    const labelOf = new Map(WATCHLIST_SYMBOLS.map((s) => [s.symbol, s.label]));

    const load = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as BinanceTicker[];
        if (!alive) return;
        const bySymbol = new Map(data.map((t) => [t.symbol, t]));
        const next = WATCHLIST_SYMBOLS
          .map((s) => bySymbol.get(s.symbol))
          .filter((t): t is BinanceTicker => !!t)
          .map((t) => toWatchlistRow(t, labelOf.get(t.symbol) ?? t.symbol));
        setRows(next);
        setStatus('live');
      } catch {
        if (alive) setStatus((prev) => (prev === 'live' ? 'live' : 'error'));
      }
    };

    load();
    const pollId = setInterval(load, POLL_MS);

    // Real-time WebSocket @ticker connection for all watchlist symbols
    let ws: WebSocket | null = null;
    if (typeof window !== 'undefined') {
      const streams = WATCHLIST_SYMBOLS.map((s) => `${s.symbol.toLowerCase()}@ticker`).join('/');
      const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
      try {
        ws = new WebSocket(url);
        ws.onmessage = (evt) => {
          if (!alive) return;
          try {
            const json = JSON.parse(evt.data as string);
            const data = json?.data;
            if (data && data.s) {
              const sym = data.s as string;
              const last = Number(data.c);
              const chg = Number(data.p);
              const chgPct = Number(data.P);
              const vol = Number(data.v);
              if (Number.isFinite(last)) {
                setRows((prev) =>
                  prev.map((r) =>
                    r.symbol === sym
                      ? {
                          ...r,
                          last,
                          chg: Number.isFinite(chg) ? chg : r.chg,
                          chgPct: Number.isFinite(chgPct) ? chgPct : r.chgPct,
                          vol: Number.isFinite(vol) ? vol : r.vol,
                        }
                      : r,
                  ),
                );
                setStatus('live');
              }
            }
          } catch {}
        };
      } catch {}
    }

    return () => {
      alive = false;
      clearInterval(pollId);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, []);

  return { rows, status };
}
