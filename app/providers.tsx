'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { DensityProvider } from '@/lib/hooks/useDensity';
import { ToastProvider } from '@/components/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            gcTime: 60_000,
            refetchOnWindowFocus: true,
            retry: 1,
            retryDelay: (attempt) => Math.min(2_000 * 2 ** attempt, 10_000),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DensityProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </DensityProvider>
    </QueryClientProvider>
  );
}
