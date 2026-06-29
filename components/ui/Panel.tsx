// MDS Phase C — Panel (the card container), Pill, FootLink.
// Panel bakes in the B3 elevation recipe (.elev-1). Title supports the full
// slot superset the pages use: number badge, icon, sym, count, info, badge,
// action (right), footer. See DESIGN.md §C.
//
// FROZEN (2026-06-27, DESIGN.md §C-FREEZE): every screen uses this Panel. Do NOT
// add a local panel/card/widget in a page. Need new behavior? Extend THIS file
// with a prop and re-run the Visual Regression Checklist, never fork a variant.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Info, type LucideIcon } from 'lucide-react';
import { cx, type Tone } from './util';

const BADGE_TONE: Record<Tone, string> = {
  accent: 'bg-accent/15 text-accent', warn: 'bg-regime-hot/15 text-regime-hot',
  bull: 'bg-bull/15 text-bull-bright', bear: 'bg-bear/15 text-bear-bright',
  info: 'bg-info/15 text-info', gold: 'bg-gold/15 text-gold',
  neutral: 'bg-surface-3 text-ink-muted', muted: 'bg-surface-3 text-ink-faint',
};

export interface PanelProps {
  title?: string;
  /** Accent uppercase-tracked title (legacy eyebrow style) instead of ink-semibold. */
  eyebrow?: boolean;
  /** Small descriptive text after the title. */
  subtitle?: string;
  /** Leading numbered step badge (e.g. workflow sections). */
  n?: number;
  /** Parenthetical symbol after the title, e.g. "(BTCUSDT)". */
  sym?: string;
  /** Small count chip after the title. */
  count?: number;
  icon?: LucideIcon;
  badge?: string;
  /** Semantic tint for the badge (default accent). */
  badgeTone?: Tone;
  info?: boolean;
  action?: ReactNode;
  footer?: ReactNode;
  /** Adds the e1 -> e2 hover lift. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, eyebrow, subtitle, n, sym, count, icon: Icon, badge, badgeTone = 'accent', info, action, footer, interactive, className, children }: PanelProps) {
  const hasHeader = title != null || action != null || Icon != null || n != null;
  return (
    <section className={cx('elev-1 flex flex-col rounded-xl p-3', interactive && 'interactive', className)}>
      {hasHeader && (
        <div className="mb-2.5 flex items-center gap-1.5">
          {n != null && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent ring-1 ring-accent/25">{n}</span>}
          {Icon && <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent"><Icon className="h-3.5 w-3.5" /></span>}
          {title && (
            <h3 className={cx('inline-flex items-center gap-1.5', eyebrow ? 'text-[11px] font-semibold uppercase tracking-wider text-accent' : 'text-[12px] font-semibold text-ink')}>
              {title}
              {sym && <span className="font-normal text-ink-faint">({sym})</span>}
              {count != null && <span className="rounded bg-surface-3 px-1.5 text-[10px] text-ink-muted">{count}</span>}
              {info && <Info aria-hidden className="h-3 w-3 text-ink-faint" />}
            </h3>
          )}
          {subtitle && <span className="text-[9px] text-ink-faint">{subtitle}</span>}
          {badge && <span className={cx('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider', BADGE_TONE[badgeTone])}>{badge}</span>}
          {action && <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint">{action}</span>}
        </div>
      )}
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-3 border-t border-line/60 pt-2 text-center">{footer}</div>}
    </section>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'accent' | 'muted' }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-[10px]', tone === 'accent' ? 'text-accent' : 'text-ink-muted')}>{children}</span>;
}

export function FootLink({ href, children }: { href?: string; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-1 text-[11px] font-medium text-accent transition hover:opacity-80';
  const inner = <>{children}<ArrowRight aria-hidden className="h-3 w-3" /></>;
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button className={cls}>{inner}</button>;
}
