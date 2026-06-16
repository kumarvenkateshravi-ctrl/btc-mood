'use client';

import { useEffect, useState } from 'react';

type HealthResponse = {
  ok: boolean;
  upstream: {
    status: 'up' | 'down' | 'timeout';
    httpStatus: number | null;
    latencyMs: number | null;
  };
  counters: {
    hits: number;
    misses: number;
    upstream429: number;
    upstream5xx: number;
    parseErrors: number;
    lastError: string | null;
    lastErrorAgeMs: number | null;
  };
  timestamp: string;
};

type DotState = 'loading' | 'up' | 'degraded' | 'down' | 'unknown';

const POLL_MS = 30_000;

function classify(h: HealthResponse | null, fetchError: string | null): DotState {
  if (fetchError) return 'unknown';
  if (!h) return 'loading';
  if (h.upstream.status === 'up') {
    const c = h.counters;
    const recentErrors =
      (c.lastErrorAgeMs != null && c.lastErrorAgeMs < POLL_MS * 2) &&
      (c.upstream429 > 0 || c.upstream5xx > 0 || c.parseErrors > 0);
    return recentErrors ? 'degraded' : 'up';
  }
  return 'down';
}

const DOT_STYLES: Record<DotState, string> = {
  loading: 'bg-slate-400 animate-pulse',
  up: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  down: 'bg-rose-500',
  unknown: 'bg-slate-500',
};

const DOT_LABEL: Record<DotState, string> = {
  loading: 'Checking…',
  up: 'Upstream OK',
  degraded: 'Upstream OK · recent errors',
  down: 'Upstream down',
  unknown: 'Health probe unavailable',
};

export default function HealthDot() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) throw new Error(`health_${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(data);
          setFetchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'fetch failed');
        }
      }
    };
    fetchHealth();
    const id = setInterval(fetchHealth, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const state = classify(health, fetchError);
  const title = buildTitle(health, fetchError, state);

  return (
    <span
      role="status"
      aria-label={DOT_LABEL[state]}
      title={title}
      className="inline-flex items-center"
    >
      <span
        className={[
          'h-2 w-2 rounded-full',
          DOT_STYLES[state],
        ].join(' ')}
      />
    </span>
  );
}

function buildTitle(
  h: HealthResponse | null,
  fetchError: string | null,
  state: DotState,
): string {
  if (fetchError) return `Health probe failed: ${fetchError}`;
  if (!h) return DOT_LABEL[state];
  const c = h.counters;
  const latency =
    h.upstream.latencyMs != null ? `${h.upstream.latencyMs}ms` : 'n/a';
  const lines = [
    `Upstream: ${h.upstream.status} (${latency})`,
    `Cache: ${c.hits} hits / ${c.misses} misses`,
    `Errors: 429=${c.upstream429} 5xx=${c.upstream5xx} parse=${c.parseErrors}`,
  ];
  if (c.lastError) lines.push(`Last error: ${c.lastError}`);
  return lines.join('\n');
}
