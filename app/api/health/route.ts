import { NextResponse } from 'next/server';
import { getCounters } from '../klines/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BINANCE_PING = 'https://data-api.binance.vision/api/v3/ping';
const TIMEOUT_MS = 3000;

export async function GET() {
  const counters = getCounters();

  // Ping Binance to confirm the upstream is reachable right now.
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let upstreamStatus: 'up' | 'down' | 'timeout' = 'up';
  let upstreamLatencyMs: number | null = null;
  let upstreamHttpStatus: number | null = null;
  try {
    const t0 = Date.now();
    const res = await fetch(BINANCE_PING, { cache: 'no-store', signal: ac.signal });
    upstreamLatencyMs = Date.now() - t0;
    upstreamHttpStatus = res.status;
    if (!res.ok) upstreamStatus = 'down';
  } catch (err) {
    const isAbort = (err as { name?: string }).name === 'AbortError';
    upstreamStatus = isAbort ? 'timeout' : 'down';
  } finally {
    clearTimeout(timeoutId);
  }

  const body = {
    ok: upstreamStatus === 'up',
    upstream: {
      status: upstreamStatus,
      httpStatus: upstreamHttpStatus,
      latencyMs: upstreamLatencyMs,
    },
    counters: {
      ...counters,
      // Don't leak the raw lastError message if it's been a while; it
      // might be confusing in dashboards. Keep it for an hour.
      lastErrorAgeMs:
        counters.lastErrorAt > 0 ? Date.now() - counters.lastErrorAt : null,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
