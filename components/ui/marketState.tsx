// MDS — Market State components (Market State Grammar, DESIGN.md §F).
// Direction, confidence, risk, volatility, liquidity and regime are INDEPENDENT
// perceptual channels — no single variable carries two meanings. Each component
// owns its channel: confidence is accent (never bull/bear); risk has its own
// shield + ramp; volatility/liquidity have dedicated indicators, not just a color.

import { TrendingUp, TrendingDown, Minus, Shield, Activity, Droplet } from 'lucide-react';
import { Badge } from './Badge';
import { Ring } from './viz';
import type { Tone } from './util';

export type Direction = 'Bullish' | 'Bearish' | 'Neutral';
const DIR: Record<Direction, { tone: Tone; Icon: typeof TrendingUp }> = {
  Bullish: { tone: 'bull', Icon: TrendingUp },
  Bearish: { tone: 'bear', Icon: TrendingDown },
  Neutral: { tone: 'neutral', Icon: Minus },
};
export function DirectionTag({ direction }: { direction: Direction }) {
  const d = DIR[direction];
  return <Badge tone={d.tone}><d.Icon aria-hidden className="h-3 w-3" />{direction}</Badge>;
}

export type Regime = 'Trending' | 'Ranging' | 'Volatile';
const REGIME: Record<Regime, Tone> = { Trending: 'bull', Ranging: 'neutral', Volatile: 'warn' };
export function RegimeTag({ regime }: { regime: Regime }) {
  return <Badge tone={REGIME[regime]}>{regime}</Badge>;
}

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
const RISK: Record<RiskLevel, Tone> = { Low: 'bull', Medium: 'warn', High: 'bear', Critical: 'bear' };
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge tone={RISK[level]}><Shield aria-hidden className="h-3 w-3" />{level} Risk</Badge>;
}

export type VolLevel = 'Low' | 'Moderate' | 'High';
export function VolatilityTag({ level, value }: { level: VolLevel; value?: number }) {
  const tone: Tone = level === 'High' ? 'warn' : level === 'Low' ? 'info' : 'neutral';
  return <Badge tone={tone}><Activity aria-hidden className="h-3 w-3" />{value != null ? `${value}% ` : ''}{level} Vol</Badge>;
}

export type LiqLevel = 'Deep' | 'Normal' | 'Thin';
export function LiquidityTag({ level }: { level: LiqLevel }) {
  const tone: Tone = level === 'Thin' ? 'warn' : level === 'Deep' ? 'bull' : 'neutral';
  return <Badge tone={tone}><Droplet aria-hidden className="h-3 w-3" />{level} Liquidity</Badge>;
}

/** Confidence, visualized ORTHOGONALLY to direction (accent ring, never bull/bear). */
export function ConfidenceMeter({ value, size = 36 }: { value: number; size?: number }) {
  const band = value >= 91 ? 'Very Strong' : value >= 71 ? 'Strong' : value >= 41 ? 'Moderate' : 'Weak';
  return (
    <span className="inline-flex items-center gap-2">
      <Ring value={value} size={size} color="var(--accent)" glow><span className="num text-[8px] font-bold text-accent">{Math.round(value)}</span></Ring>
      <span className="text-[11px] font-semibold text-ink">{band}</span>
    </span>
  );
}
