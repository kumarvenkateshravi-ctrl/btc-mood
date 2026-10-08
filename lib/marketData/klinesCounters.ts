export const klinesCounters = {
  hits: 0,
  misses: 0,
  upstream429: 0,
  upstream5xx: 0,
  parseErrors: 0,
  rateLimited: 0,
  lastError: null as string | null,
  lastErrorAt: 0,
};

export function getKlinesCounters() {
  return { ...klinesCounters };
}

export function recordKlinesError(message: string) {
  klinesCounters.lastError = message;
  klinesCounters.lastErrorAt = Date.now();
}
