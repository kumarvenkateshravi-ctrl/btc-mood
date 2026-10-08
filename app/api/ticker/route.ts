import { NextRequest, NextResponse } from 'next/server';
import { COMPARE_SYMBOLS, isCompareSymbol } from '@/lib/compare';
import { fetchBinanceRest } from '@/lib/marketData/binanceRest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function invalidSymbolResponse() {
  return NextResponse.json(
    { error: `Invalid symbol. Allowed: ${COMPARE_SYMBOLS.map((item) => item.symbol).join(', ')}` },
    { status: 400 },
  );
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  const symbolsParam = req.nextUrl.searchParams.get('symbols');

  if ((symbol == null) === (symbolsParam == null)) {
    return NextResponse.json(
      { error: 'Provide exactly one of symbol or symbols.' },
      { status: 400 },
    );
  }

  let upstreamPath: string;
  if (symbol != null) {
    if (!isCompareSymbol(symbol)) return invalidSymbolResponse();
    upstreamPath = `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  } else {
    let symbols: unknown;
    try {
      symbols = JSON.parse(symbolsParam!);
    } catch {
      return NextResponse.json({ error: 'symbols must be a JSON array.' }, { status: 400 });
    }
    if (
      !Array.isArray(symbols)
      || symbols.length === 0
      || symbols.length > COMPARE_SYMBOLS.length
      || !symbols.every((item): item is string => typeof item === 'string' && isCompareSymbol(item))
    ) {
      return invalidSymbolResponse();
    }
    upstreamPath = `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  }

  try {
    const { response, baseUrl } = await fetchBinanceRest(upstreamPath);
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
        'X-Upstream': baseUrl,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
