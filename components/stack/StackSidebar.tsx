'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ScanLine, Layers, Gauge, Target, Bell, FlaskConical, BookOpen,
  Briefcase, Boxes, FileBarChart, BrainCircuit, HelpCircle, Settings, TrendingUp, type LucideIcon,
} from 'lucide-react';

export interface MarketState {
  state: string;
  volatility: string;
  volume: string;
  energy: string;
}

const ITEMS: { label: string; icon: LucideIcon; href?: string; badge?: string }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/mycryptostack' },
  { label: 'Market Scanner', icon: ScanLine },
  { label: 'Multi-Timeframe', icon: Layers, href: '/multi-timeframe' },
  { label: 'Stack Score', icon: Gauge, href: '/stack-score' },
  { label: 'Trade Setup', icon: Target, href: '/trade-setup' },
  { label: 'Alerts', icon: Bell, href: '/alerts' },
  { label: 'Backtester', icon: FlaskConical, href: '/backtester' },
  { label: 'Journal', icon: BookOpen, href: '/journal' },
  { label: 'Positions', icon: Briefcase, href: '/positions' },
  { label: 'Strategies', icon: Boxes, href: '/strategies' },
  { label: 'Reports', icon: FileBarChart, href: '/reports' },
  { label: 'MyStack IQ', icon: BrainCircuit, href: '/mystack-iq', badge: 'NEW' },
  { label: 'Help & Learn', icon: HelpCircle },
  { label: 'Settings', icon: Settings },
];

function fearGreedLabel(v: number): string {
  if (v >= 75) return 'Extreme Greed';
  if (v >= 55) return 'Greed';
  if (v >= 45) return 'Neutral';
  if (v >= 25) return 'Fear';
  return 'Extreme Fear';
}

export default function StackSidebar({ marketState, fearGreed, extra }: { marketState?: MarketState; fearGreed?: number; extra?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface-1 lg:flex">
      <div className="flex items-center gap-2 border-b border-line px-4 py-4">
        <Layers className="h-5 w-5 text-accent" />
        <span className="font-bold tracking-tight">MyCryptoStack</span>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {ITEMS.map(({ label, icon: Icon, href, badge }) => {
          const active = href ? pathname?.startsWith(href) : false;
          const cls = [
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
            active ? 'bg-accent/15 font-medium text-accent'
              : href ? 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                : 'cursor-default text-ink-faint/60',
          ].join(' ');
          const inner = <><Icon className="h-4 w-4 shrink-0" /><span className="flex-1">{label}</span>{badge && <span className="rounded bg-accent px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">{badge}</span>}</>;
          return href
            ? <Link key={label} href={href} className={cls}>{inner}</Link>
            : <div key={label} className={cls} title="Coming soon">{inner}</div>;
        })}
      </nav>

      <div className="border-t border-line p-3">
        {extra ? extra : marketState ? (
          <>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Market State</div>
            <div className="mb-2 flex items-center gap-1.5 text-base font-bold text-bull-bright">
              <TrendingUp className="h-4 w-4" /> {marketState.state}
            </div>
            <KV k="Volatility" v={marketState.volatility} />
            <KV k="Volume" v={marketState.volume} />
            <KV k="Market Energy" v={marketState.energy} />
            <div className="mt-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Fear &amp; Greed Index</div>
              <FearGreed value={fearGreed ?? 50} />
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  const tone = v === 'High' ? 'text-regime-hot' : v === 'Low' ? 'text-bull-bright' : 'text-ink';
  return <div className="flex items-center justify-between py-0.5 text-xs"><span className="text-ink-faint">{k}</span><span className={['font-medium', tone].join(' ')}>{v}</span></div>;
}

function FearGreed({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const angle = -90 + (v / 100) * 180;
  const color = v >= 55 ? '#26A69A' : v >= 45 ? '#f0a020' : v >= 25 ? '#f2683c' : '#f23645';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-36">
        <path d="M15 105 A 85 85 0 0 1 185 105" fill="none" stroke="#2a3247" strokeWidth="13" strokeLinecap="round" />
        <path d="M15 105 A 85 85 0 0 1 100 20" fill="none" stroke="#f23645" strokeWidth="13" strokeLinecap="round" />
        <path d="M100 20 A 85 85 0 0 1 150 33" fill="none" stroke="#f0a020" strokeWidth="13" />
        <path d="M150 33 A 85 85 0 0 1 185 105" fill="none" stroke="#26A69A" strokeWidth="13" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 105)`}><line x1="100" y1="105" x2="100" y2="40" stroke="#e9eef7" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="105" r="5" fill="#e9eef7" /></g>
      </svg>
      <div className="-mt-3 font-mono text-2xl font-bold" style={{ color }}>{v}</div>
      <div className="text-xs font-semibold" style={{ color }}>{fearGreedLabel(v)}</div>
    </div>
  );
}
