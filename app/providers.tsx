'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The WebSocket handles live updates; the React Query cache
            // just keeps the historical bars fresh on focus and
            // deduplicates concurrent fetches.
            staleTime: 5_000,
            gcTime: 60_000,
            refetchOnWindowFocus: true,
            retry: 1,
            retryDelay: (attempt) => Math.min(2_000 * 2 ** attempt, 10_000),
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
