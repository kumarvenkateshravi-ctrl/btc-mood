const DEFAULT_TIMEOUT_MS = 4_000;

// Binance documents these as interchangeable REST API base endpoints. Keep the
// stable primary first and use the others only when the preceding host cannot
// serve the request.
export const BINANCE_REST_BASES = [
  'https://api.binance.com',
  'https://api-gcp.binance.com',
  'https://data-api.binance.vision',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
] as const;

export interface BinanceRestResult {
  response: Response;
  baseUrl: string;
}

/**
 * Fetch a public Binance REST resource with bounded, sequential failover.
 * Rate-limit responses are returned immediately so alternate hosts are never
 * used to evade an upstream limit.
 */
export async function fetchBinanceRest(
  pathAndQuery: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BinanceRestResult> {
  let lastResponse: BinanceRestResult | null = null;
  let lastError: unknown = null;

  for (const baseUrl of BINANCE_REST_BASES) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abortFromCaller();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${pathAndQuery}`, {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = { response, baseUrl };
      if (response.ok || response.status === 418 || response.status === 429) {
        return result;
      }
      lastResponse = result;
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('All Binance REST endpoints failed');
}
