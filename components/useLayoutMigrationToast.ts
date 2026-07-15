'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { markMigrationToastShown, wasMigrationToastShown } from '@/lib/gridLayout';

/**
 * One-time toast shown when a user with a v1 grid storage entry opens
 * the new layout switcher for the first time. Skips the `single` (1-cell)
 * case because that's the default — only users with a non-trivial v1
 * layout get a heads-up.
 */
export function useLayoutMigrationToast({
  migrated,
  previousCount,
}: {
  migrated: boolean;
  previousCount: number;
}) {
  const { addToast } = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!migrated) return;
    if (previousCount <= 1) return;
    if (wasMigrationToastShown()) return;
    fired.current = true;
    markMigrationToastShown();

    addToast({
      source: 'layout-migration:v1-to-v2',
      type: 'info',
      title: 'New layout options available!',
      message:
        'Multi-pane mode is here — try stacked panes that share one time scale. Open the layout switcher in the toolbar to pick.',
    });
  }, [migrated, previousCount, addToast]);
}
