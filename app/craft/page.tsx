// CRAFT PROTOTYPE — elevated KPI card, BEFORE vs AFTER, compact (5-up).
// Uses MDS tokens (text-ink, bg-surface-1, bull/bear) so it's theme-aware.

import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

type Kpi = {
  label: string;
  value: string;
  delta: string;
  caption: string;
  down?: boolean;
  spark: number[];
};

const KPIS: Kpi[] = [
  { label: 'Portfolio Value', value: '$128,420', delta: '+12.4%', caption: 'vs last month', spark: [0.35, 0.5, 0.42, 0.6, 0.55, 0.72, 0.66, 0.85, 0.8, 1] },
  { label: 'Net P&L · 30D', value: '+$18,420', delta: '+18.42%', caption: 'realized', spark: [0.3, 0.4, 0.38, 0.52, 0.48, 0.64, 0.7, 0.66, 0.82, 0.95] },
  { label: 'Win Rate', value: '68.5%', delta: '+3.2%', caption: '90 trades', spark: [0.5, 0.46, 0.55, 0.5, 0.62, 0.58, 0.68, 0.64, 0.74, 0.78] },
  { label: 'Sharpe', value: '2.41', delta: '+0.18', caption: 'risk-adj.', spark: [0.4, 0.44, 0.5, 0.47, 0.58, 0.6, 0.66, 0.7, 0.75, 0.82] },
  { label: 'Max Drawdown', value: '−8.2%', delta: '−1.4%', caption: 'this month', down: true, spark: [0.8, 0.72, 0.78, 0.64, 0.66, 0.55, 0.6, 0.5, 0.46, 0.42] },
];

/* ── quiet supporting sparkline (one accent, low ink) ── */
function Spark({ data, down }: { data: number[]; down?: boolean }) {
  const w = 64, h = 34, p = 3, n = data.length;
  const stroke = down ? 'var(--bear-bright)' : 'var(--bull-bright)';
  const pts = data.map((v, i) => [p + (i / (n - 1)) * (w - 2 * p), h - p - v * (h - 2 * p)] as const);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ');
  const area = `M${pts[0][0]} ${h} ` + pts.map((q) => `L${q[0]} ${q[1]}`).join(' ') + ` L${pts[n - 1][0]} ${h} Z`;
  const id = down ? 'craftSparkDn' : 'craftSparkUp';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="2.4" fill={stroke} />
    </svg>
  );
}

/* ── BEFORE: today's basic card (flat, tight, colored number) ── */
function BeforeCard({ k }: { k: Kpi }) {
  const tone = k.down ? 'text-bear-bright' : 'text-bull-bright';
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{k.label}</div>
      <div className={`num mt-1 text-lg font-bold ${tone}`}>{k.value}</div>
      <div className={`num text-xs ${tone}`}>{k.delta}</div>
    </div>
  );
}

/* ── AFTER: the elevated card (compact) ── */
function AfterCard({ k }: { k: Kpi }) {
  const Arrow = k.down ? ArrowDownRight : ArrowUpRight;
  const tone = k.down ? 'text-bear-bright' : 'text-bull-bright';
  const borderTone = k.down ? 'border-bear-bright/45 hover:border-bear-bright/70' : 'border-bull-bright/45 hover:border-bull-bright/70';
  const bloomTone = k.down ? 'bg-bear-bright/10' : 'bg-bull-bright/10';
  return (
    <div className={`group relative overflow-hidden rounded-2xl border ${borderTone} bg-surface-1 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.25),0_12px_30px_-16px_rgba(0,0,0,0.6)] transition duration-200 hover:-translate-y-0.5`}>
      {/* direction-tinted bloom + top sheen — calm depth */}
      <div className={`pointer-events-none absolute -right-8 -top-10 h-20 w-20 rounded-full ${bloomTone} blur-2xl`} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <span className="relative block truncate text-sm font-medium text-ink-muted">{k.label}</span>

      <div className="relative mt-3.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={`num text-[22px] font-bold leading-none tracking-tight ${tone}`}>{k.value}</div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
              <Arrow className="h-3 w-3" strokeWidth={2.5} />{k.delta}
            </span>
            <span className="truncate text-ink-faint">{k.caption}</span>
          </div>
        </div>
        <Spark data={k.spark} down={k.down} />
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">{children}</span>;
}

export default function CraftPrototype() {
  return (
    <div className="relative min-h-screen w-full px-8 py-10 text-ink" style={{ background: '#31353f' }}>
      <div className="relative z-10 mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">KPI card — craft prototype</h1>
        <p className="mt-1 text-sm text-ink-muted">Compact, 5-up, on the flat <code className="text-accent">#31353f</code> surface, framed by a border. Built on MDS tokens.</p>

        {/* BEFORE */}
        <div className="mt-9 flex items-center gap-3">
          <Tag>Before</Tag>
          <span className="text-xs text-ink-faint">today&apos;s basic card — flat, tight, the number itself is colored</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {KPIS.map((k) => <BeforeCard key={k.label} k={k} />)}
        </div>

        {/* AFTER */}
        <div className="mt-10 flex items-center gap-3">
          <Tag>After</Tag>
          <span className="text-xs text-ink-faint">elevated &amp; compact — air, focal number, one accent, quiet support</span>
        </div>
        {/* Border framing the entire 5-card group. */}
        <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {KPIS.map((k) => <AfterCard key={k.label} k={k} />)}
          </div>
        </div>

        {/* WHAT CHANGED */}
        <div className="mt-12 rounded-2xl border border-line bg-surface-1 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">What changed</div>
          <ul className="mt-3 grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
            <li><span className="text-ink">Density:</span> narrow cards, 5 per row — holds more without feeling cramped.</li>
            <li><span className="text-ink">Hierarchy:</span> the value leads (22px bold); the label is a quiet caption.</li>
            <li><span className="text-ink">Direction color:</span> value, delta, sparkline and <span className="text-bull-bright">border</span> all read <span className="text-bull-bright">green</span> up / <span className="text-bear-bright">red</span> down.</li>
            <li><span className="text-ink">Finish:</span> a faint direction-tinted glow + 1px top sheen + layered shadow = calm depth.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
