'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Bitcoin, CandlestickChart, ChevronLeft, LoaderCircle, ShieldCheck } from 'lucide-react';
import { initializePersistentChallenges, retryChallengeRecovery, useChallengeUi } from '@/lib/challenges/ui/store';
import { Button, Panel } from '@/components/ui';

const RECOVERY_LABELS: Record<string, string> = {
  DATASET_UNAVAILABLE: 'Dataset unavailable',
  UNSUPPORTED_VERSION: 'Unsupported version',
  CORRUPT: 'Corrupt attempt',
  NOT_FOUND: 'Attempt unavailable',
};

export default function ChallengeShell({ children, recover = true, challengeId }: { children: React.ReactNode; recover?: boolean; challengeId?: string }) {
  const pathname = usePathname();
  const challenge = useChallengeUi();
  const { readModel } = challenge;
  useEffect(() => { if (recover) void initializePersistentChallenges(); }, [recover]);
  const chartHref = challengeId ? '/app?challenge=' + challengeId : readModel ? '/app?challenge=' + readModel.identity.challengeId : '/app';
  return (
    <div className="challenge-shell min-h-[100dvh] bg-base text-ink">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-base/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <Link href="/mycryptostack" className="focus-ring inline-flex items-center gap-2 rounded-lg text-sm font-semibold tracking-tight text-ink">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-regime-hot"><Bitcoin className="h-4 w-4" /></span>
              <span className="hidden sm:inline">MyCryptoStack</span>
            </Link>
            <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
            <Link href="/challenges" aria-current={pathname === '/challenges' ? 'page' : undefined} className="focus-ring rounded-md text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted transition-colors duration-200 hover:text-ink">
              Prop Challenges
            </Link>
          </div>
          <nav aria-label="Challenge navigation" className="flex items-center gap-2">
            <Link href={chartHref} className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted transition-colors duration-200 hover:bg-surface-2 hover:text-ink">
              <CandlestickChart className="h-3.5 w-3.5" /> Chart
            </Link>
            {pathname !== '/challenges' && (
              <Link href="/challenges" className="focus-ring hidden h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-ink-muted transition-colors duration-200 hover:bg-surface-2 hover:text-ink sm:inline-flex">
                <ChevronLeft className="h-3.5 w-3.5" /> Overview
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {recover && challenge.recovery === 'RESTORING' ? (
          <Panel className="mx-auto max-w-xl p-8 text-center" aria-live="polite">
            <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-accent motion-reduce:animate-none" />
            <h1 className="mt-5 text-xl font-semibold">Restoring Challenge</h1>
            <p className="mt-2 text-sm text-ink-muted">Validating the frozen dataset, journal, branch, and checkpoint.</p>
          </Panel>
) : recover && challenge.recovery === 'ERROR' ? (
          <Panel className="mx-auto max-w-xl border border-bear/30 p-8 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-bear-bright" />
            <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-bear-bright">{challenge.recoveryCode ? RECOVERY_LABELS[challenge.recoveryCode] ?? challenge.recoveryCode : 'Recovery failed'}</div>
            <h1 className="mt-2 text-xl font-semibold">Recovery failed</h1>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{challenge.recoveryMessage}</p>
            <Button className="mt-6" variant="outline" onClick={retryChallengeRecovery}>Retry recovery</Button>
          </Panel>
        ) : (
          <>
            {recover && (challenge.recovery === 'RECOVERED' || challenge.recoveryCode === 'LEASE_CONFLICT') && (
              <div className="mx-auto mb-5 max-w-7xl rounded-lg border border-regime-hot/25 bg-regime-hot/5 px-4 py-3 text-xs text-ink-muted" role="status">
                <span className="font-semibold text-regime-hot">{challenge.recoveryCode === 'LEASE_CONFLICT' ? 'Read-only Challenge' : 'Challenge recovered'}.</span>{' '}{challenge.recoveryMessage}
              </div>
            )}
            {children}
          </>
        )}
      </main>
      <footer className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 pb-8 text-[10px] uppercase tracking-[0.14em] text-ink-faint sm:px-6 lg:px-8">
        <ShieldCheck className="h-3.5 w-3.5" /> Deterministic Challenge v1 accounting
      </footer>
    </div>
  );
}

