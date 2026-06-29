// MDS Pass-2 — Stat (light label/value row), Bar (progress), KpiCard (the rich
// metric tile). Numbers inside these come from <Num.* /> (the Financial
// Information Language). KpiCard owns the delta grammar; the value grammar is the
// caller's Num choice. See DESIGN.md §B5-FREEZE.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clamp, cx, toneText, type Tone } from './util';
import { Ring, Sparkline } from './viz';
import Num from './Num';

const DEFAULT_SPARK = [10, 12, 9, 13, 11, 15, 14, 16, 15, 20];

/** A light label/value row (the KV pattern). `value` is normally a <Num.* />. */
export function Stat({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className={cx('font-semibold', toneText[tone])}>{value}</span>
    </div>
  );
}

/** Horizontal progress bar (goals, suitability, margins). */
export function Bar({ value, max = 100, color = 'var(--bull-bright)', height = 6, className }: {
  value: number; max?: number; color?: string; height?: number; className?: string;
}) {
  const pct = clamp((value / max) * 100, 0, 100);
  return (
    <div className={cx('overflow-hidden rounded-full bg-surface-3', className)} style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** The rich KPI tile: eyebrow label (+optional icon), a Num value, a standardized
 *  delta (rendered via Num.Delta + a caption), and an optional spark or ring. */
export function KpiCard({
  label, value, unit, sub, delta, deltaPercent, deltaCaption,
  spark, sparkColor, ring, accessory, icon: Icon, hero, valueTone = 'neutral', className,
}: {
  label: string;
  value: ReactNode;          // a <Num.* /> node
  unit?: string;
  sub?: string;              // a small caption under the value (e.g. "22 / 100")
  delta?: number;            // a number; KpiCard renders Num.Delta (arrow + color)
  deltaPercent?: boolean;
  deltaCaption?: string;     // e.g. "vs last month"
  spark?: number[];
  sparkColor?: string;
  ring?: number;
  accessory?: ReactNode;     // custom right-side node (e.g. a shield); overrides spark/ring
  icon?: LucideIcon;
  hero?: boolean;
  valueTone?: Tone;
  className?: string;
}) {
  return (
    <div className={cx('elev-1 relative overflow-hidden rounded-xl p-3', hero && 'border-accent/40', className)}>
      {hero && <div className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-accent/20 blur-2xl" />}
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-1">
        <div className={cx('num text-2xl font-bold leading-none tracking-tight', toneText[valueTone])}>
          {value}{unit && <span className="ml-1 text-[10px] font-medium text-ink-faint">{unit}</span>}
        </div>
        {accessory ?? (ring != null
          ? <Ring value={ring} size={36} glow><span className="num text-[8px] font-semibold text-bull-bright">{Math.round(ring)}</span></Ring>
          : (spark || sparkColor) ? <Sparkline data={spark ?? DEFAULT_SPARK} color={sparkColor ?? 'var(--bull-bright)'} dot width={56} height={24} /> : null)}
      </div>
      {sub && <div className="mt-1 text-[9px] text-ink-faint">{sub}</div>}
      {delta != null && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px]">
          <Num.Delta value={delta} percent={deltaPercent} />
          {deltaCaption && <span className="text-ink-faint">{deltaCaption}</span>}
        </div>
      )}
    </div>
  );
}
