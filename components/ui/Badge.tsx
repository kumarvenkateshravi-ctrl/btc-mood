// MDS Phase C — Badge. Semantic tints only; color communicates state (DESIGN.md §G2).

import type { ReactNode } from 'react';
import { cx, type Tone } from './util';

const TINT: Record<Tone, string> = {
  bull: 'bg-bull/15 text-bull-bright',
  bear: 'bg-bear/15 text-bear-bright',
  warn: 'bg-regime-hot/12 text-regime-hot',
  info: 'bg-info/15 text-info',
  accent: 'bg-accent/15 text-accent',
  gold: 'bg-gold/15 text-gold',
  neutral: 'bg-surface-3 text-ink-muted',
  muted: 'bg-surface-3 text-ink-faint',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', TINT[tone], className)}>{children}</span>;
}
