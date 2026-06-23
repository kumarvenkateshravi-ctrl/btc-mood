'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bitcoin } from 'lucide-react';
import HealthDot from './HealthDot';

export default function Header({ rightControls }: { rightControls?: React.ReactNode }) {
  const pathname = usePathname();
  const isApp = pathname?.startsWith('/app');
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-base/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <Bitcoin className="h-5 w-5 text-regime-hot" />
          <span className="font-semibold tracking-tight text-ink">
            BTC Market Mood
          </span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <HealthDot />
          <Link
            href="/"
            className="text-ink-muted transition-colors hover:text-ink"
          >
            Home
          </Link>
          <Link
            href="/app"
            aria-current={isApp ? 'page' : undefined}
            className={[
              'focus-ring rounded-lg px-3 py-1.5 font-medium transition',
              isApp
                ? 'bg-bull/15 text-bull-bright ring-1 ring-bull/30'
                : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            Dashboard
          </Link>
          {rightControls}
        </nav>
      </div>
    </header>
  );
}
