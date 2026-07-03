import { type ReactNode } from 'react';
import { useDensity } from '@/lib/hooks/useDensity';
import { cx } from './util';

export function DashboardGrid({ children, className }: { children: ReactNode; className?: string }) {
  const { gap, p } = useDensity();
  
  return (
    <div className={cx(`flex-1 overflow-auto flex flex-col`, p, className)}>
      <div className={cx(`flex flex-col`, gap)}>
        {children}
      </div>
    </div>
  );
}

export function DashboardRow({ children, className, cols = 1 }: { children: ReactNode; className?: string; cols?: number | string }) {
  const { gap } = useDensity();
  
  // A simplified generic grid row. In production this could map 'cols' to actual grid classes.
  return (
    <div className={cx('grid gap-3 lg:gap-4', gap, className)}>
      {children}
    </div>
  );
}
