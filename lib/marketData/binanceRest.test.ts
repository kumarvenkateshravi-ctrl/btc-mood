import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINANCE_REST_BASES, fetchBinanceRest } from './binanceRest';

describe('fetchBinanceRest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails over to the next official endpoint when the primary is unreachable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await fetchBinanceRest('/api/v3/ping');

    expect(result.baseUrl).toBe(BINANCE_REST_BASES[1]);
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns rate-limit responses without trying another host', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429 }));

    const result = await fetchBinanceRest('/api/v3/klines');

    expect(result.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
