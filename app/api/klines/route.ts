import { NextRequest, NextResponse } from 'next/server';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import { parseCandlesFromBinance } from '@/lib/schemas';
import { COMPARE_SYMBOLS, isCompareSymbol } from '@/lib/compare';
import {
  DEFAULT_DATA_SOURCE_ID,
  hasDataSource,
  listDataSourceMetas,
} from '@/lib/dataSource';

// Sourced from the canonical TIMEFRAMES so this allowlist can never drift
// (e.g. when 30m was added). Binance accepts each of these interval strings.
const VALID_TIMEFRAMES: Timeframe[] = [...TIMEFRAMES];
const CACHE_TTL_MS = 5000;
// Older history pages are immutable, so cache them far longer.
const HISTORY_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000; // Binance spot klines hard cap
const CACHE_MAX_ENTRIES = 64; // LRU cap to prevent unbounded growth
const BINANCE_BASE = 'https://data-api.binance.vision/api/v3/klines';

// Per-IP rate limit: fixed window. A normal dashboard does ~12 req/min
// (6 timeframes reconciled every 30s); this leaves generous headroom
// for symbol switches and refreshes while blocking scripted abuse of
// the open proxy.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_IPS = 5_000; // cap the tracking map's memory

// IMPORTANT: the cache, counters, and rate-limiter below are
// module-level state and therefore live only inside a single Node
// process. They work as intended for a long-running server (e.g.
// `next start`, a container, a VM). On multi-instance serverless
// platforms each instance keeps its own copy: the cache hit-rate drops,
// the health counters under-report, and the rate limit is enforced
// per-instance rather than globally. For shared state across instances,
// back these with an external store (e.g. Redis). This is a deliberate,
// documented trade-off for the single-process deployment target.

// In-memory counters for the /api/health endpoint.
const counters = {
  hits: 0,
  misses: 0,
  upstream429: 0,
  upstream5xx: 0,
  parseErrors: 0,
  rateLimited: 0,
  lastError: null as string | null,
  lastErrorAt: 0,
};

type RateEntry = { count: number; windowStart: number };
const rateLimitMap = new Map<string, RateEntry>();

function clientIp(req: NextRequest): string {
  // `x-forwarded-for` is a comma-separated list; the first entry is the
  // original client. Fall back to `x-real-ip`, then a constant so a
  // missing header collapses to a single shared bucket rather than
  // bypassing the limit entirely.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Returns true if the request is over the limit (should be rejected). */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // New window. Opportunistically evict the oldest bucket if the map
    // has grown too large (insertion-order iteration = oldest first).
    if (rateLimitMap.size >= RATE_LIMIT_MAX_IPS) {
      const oldest = rateLimitMap.keys().next().value;
      if (oldest !== undefined) rateLimitMap.delete(oldest);
    }
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

export function getCounters() {
  return { ...counters };
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CacheEntry = {
  expiresAt: number;
  payload: string;
  status: number;
};

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // LRU: refresh recency on read.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, payload: string, status: number, ttl: number = CACHE_TTL_MS) {
  // If updating an existing key, drop it first so the new entry is the
  // most-recently-used in the insertion-order iteration.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, {
    expiresAt: Date.now() + ttl,
    payload,
    status,
  });
  // Evict oldest entries (Map iteration order = insertion order) until
  // we're under the cap.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function recordError(message: string) {
  counters.lastError = message;
  counters.lastErrorAt = Date.now();
}

export async function GET(req: NextRequest) {
  const tf = req.nextUrl.searchParams.get('tf') ?? '15m';
  const symbolParam = req.nextUrl.searchParams.get('symbol') ?? 'BTCUSDT';
  const sourceParam = req.nextUrl.searchParams.get('source') ?? DEFAULT_DATA_SOURCE_ID;

  if (!(VALID_TIMEFRAMES as string[]).includes(tf)) {
    return NextResponse.json(
      { error: `Invalid timeframe. Allowed: ${VALID_TIMEFRAMES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!isCompareSymbol(symbolParam)) {
    return NextResponse.json(
      {
        error: `Invalid symbol. Allowed: ${COMPARE_SYMBOLS.map((c) => c.symbol).join(', ')}`,
      },
      { status: 400 },
    );
  }

  // Data-source seam. The route still hard-codes Binance-specific
  // behavior (rate limiting, cache, upstream URL) because Binance
  // is the only active source today. Unknown / unimplemented sources
  // get a 501 that lists the registered sources so the client can
  // surface a useful error.
  if (sourceParam !== 'binance-spot') {
    if (!hasDataSource(sourceParam)) {
      return NextResponse.json(
        {
          error: 'unknown_source',
          requested: sourceParam,
          available: listDataSourceMetas().map((m) => m.id),
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: 'not_implemented',
        source: sourceParam,
        message:
          'This data source is registered but not yet wired into /api/klines. ' +
          'Only binance-spot is currently active.',
      },
      { status: 501 },
    );
  }

  // Throttle the open proxy per client IP before doing any upstream work.
  if (isRateLimited(clientIp(req))) {
    counters.rateLimited += 1;
    const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    return new NextResponse(
      JSON.stringify({ error: 'rate_limited', scope: 'proxy' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': String(retryAfter),
        },
      },
    );
  }

  const validTf = tf as Timeframe;

  // Pagination: `before` (ms, exclusive upper bound) loads older history;
  // omitted = the latest page. `limit` caps the page size (Binance max 1000).
  const beforeRaw = req.nextUrl.searchParams.get('before');
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT),
  );

  const isHistory = before != null;
  const cacheKey = `${symbolParam}:${validTf}:${before ?? 'latest'}:${limit}`;
  const cacheTtl = isHistory ? HISTORY_CACHE_TTL_MS : CACHE_TTL_MS;

  // Fresh cache → serve.
  const cached = cacheGet(cacheKey);
  if (cached) {
    counters.hits += 1;
    return new NextResponse(cached.payload, {
      status: cached.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'HIT',
      },
    });
  }

  let upstream = `${BINANCE_BASE}?symbol=${encodeURIComponent(symbolParam)}&interval=${encodeURIComponent(validTf)}&limit=${limit}`;
  if (before != null) upstream += `&endTime=${before}`;

  let res: Response;
  try {
    res = await fetch(upstream, { cache: 'no-store' });
  } catch (err) {
    counters.upstream5xx += 1;
    recordError((err as Error).message ?? 'fetch threw');
    const body = JSON.stringify({ error: 'upstream_unreachable' });
    return new NextResponse(body, {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'BYPASS',
      },
    });
  }

  // Map Binance's rate-limit (418/429) and other 5xx explicitly so the
  // client can back off instead of silently falling back to synth data.
  if (res.status === 418 || res.status === 429) {
    counters.upstream429 += 1;
    const retryAfter = res.headers.get('Retry-After');
    recordError(`upstream ${res.status}`);
    const body = JSON.stringify({
      error: 'rate_limited',
      status: res.status,
      retryAfter: retryAfter ? Number(retryAfter) : null,
    });
    return new NextResponse(body, {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'BYPASS',
        'Retry-After': retryAfter ?? '60',
      },
    });
  }

  if (!res.ok) {
    counters.upstream5xx += 1;
    recordError(`upstream ${res.status}`);
    const body = JSON.stringify({ error: `upstream_${res.status}` });
    return new NextResponse(body, {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'BYPASS',
      },
    });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    counters.parseErrors += 1;
    recordError('upstream returned non-JSON');
    return NextResponse.json({ error: 'invalid_upstream_json' }, { status: 502 });
  }

  let candles: Candle[];
  try {
    candles = parseCandlesFromBinance(raw);
  } catch (err) {
    counters.parseErrors += 1;
    recordError(
      `parse failed: ${(err as Error).message ?? 'unknown zod error'}`,
    );
    return NextResponse.json(
      { error: 'upstream_shape_invalid' },
      { status: 502 },
    );
  }

  const payload = JSON.stringify(candles);
  cacheSet(cacheKey, payload, 200, cacheTtl);
  counters.misses += 1;

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Cache': 'MISS',
    },
  });
}
