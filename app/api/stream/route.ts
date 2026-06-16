import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Placeholder for a future server-side WebSocket bridge. The dashboard
// already opens a client-side WebSocket directly to Binance
// (stream.binance.com) via lib/ws.ts and reconciles with a periodic
// 30s poll from React Query. This endpoint exists so a future
// corporate-proxy / mobile-carrier fallback (where the browser can't
// reach Binance) can be wired up without changing the dashboard
// contract.
export async function GET() {
  // 501 Not Implemented — this is a deliberate placeholder, not a
  // working bridge. Returning 501 (rather than 200) means a probe or
  // future client can detect availability from the status code alone
  // instead of having to parse the body.
  return NextResponse.json(
    {
      status: 'not_implemented',
      message:
        'Server-side WebSocket bridge not implemented. Dashboard uses a client-side WS to Binance with 30s reconciliation.',
    },
    { status: 501, headers: { 'Cache-Control': 'no-store' } },
  );
}
