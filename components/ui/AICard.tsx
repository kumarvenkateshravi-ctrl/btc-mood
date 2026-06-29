// MDS — AICard. The canonical implementation of the Explainable-AI Grammar
// (DESIGN.md §E) and MyCryptoStack's product moat. Every AI surface renders
// through this so users learn one grammar.
//
// Enforced rules: confidence is shown ORTHOGONALLY to direction (accent ring,
// never bull/bear); counter-signals are ALWAYS surfaced, never hidden; evidence
// is ranked by weight; no score without evidence; no false precision; an action
// is never shown without risk/reason/timestamp context. See §E1-E8.

import { TrendingUp, TrendingDown, Minus, Sparkles, type LucideIcon } from 'lucide-react';
import { Panel } from './Panel';
import { Badge } from './Badge';
import { Bar } from './Stat';
import { Ring } from './viz';
import { cx, type Tone } from './util';

export type AIDirection = 'Bullish' | 'Bearish' | 'Neutral';
export interface AIEvidence { factor: string; weight: number; direction: 'support' | 'oppose'; }

export interface AICardData {
  title?: string;
  verdict: string;
  confidence: number;            // 0-100; visualized in accent, orthogonal to direction
  direction?: AIDirection;       // colored bull/bear/neutral, with an arrow
  evidence: AIEvidence[];        // supports + opposes; split + ranked internally
  risk?: string;
  historical?: string;           // "setups like this resolved X% over N samples"
  uncertainty?: string;          // a range, not false precision
  sources?: string[];
  timestamp?: string;            // "14:21 UTC"
  action?: { label: string; tone?: Tone };
  stale?: boolean;               // inputs delayed -> dim + downgrade
}

const band = (c: number) => (c >= 91 ? 'Very Strong' : c >= 71 ? 'Strong' : c >= 41 ? 'Moderate' : 'Weak');
const DIR: Record<AIDirection, { tone: Tone; Icon: LucideIcon }> = {
  Bullish: { tone: 'bull', Icon: TrendingUp },
  Bearish: { tone: 'bear', Icon: TrendingDown },
  Neutral: { tone: 'neutral', Icon: Minus },
};

function EvidenceList({ items, oppose }: { items: AIEvidence[]; oppose?: boolean }) {
  const Icon = oppose ? TrendingDown : TrendingUp;
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px]">
          <Icon aria-hidden className={cx('h-3 w-3 shrink-0', oppose ? 'text-bear-bright' : 'text-bull-bright')} />
          <span className="flex-1 text-ink-muted">{e.factor}</span>
          <Bar value={e.weight} color={oppose ? 'var(--bear-bright)' : 'var(--bull-bright)'} className="w-16" height={4} />
          <span className="num w-6 text-right text-[10px] text-ink-faint">{Math.round(e.weight)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AICard({ title = 'AI Coach', verdict, confidence, direction, evidence, risk, historical, uncertainty, sources, timestamp, action, stale, onWhy, onWhatChanged, className }: AICardData & { onWhy?: () => void; onWhatChanged?: () => void; className?: string }) {
  const supports = evidence.filter((e) => e.direction === 'support').sort((a, b) => b.weight - a.weight);
  const opposes = evidence.filter((e) => e.direction === 'oppose').sort((a, b) => b.weight - a.weight);
  const dir = direction ? DIR[direction] : null;

  return (
    <Panel
      title={title} icon={Sparkles} badge="Beta" className={className}
      footer={(onWhy || onWhatChanged) ? (
        <div className="flex items-center justify-center gap-4">
          {onWhy && <button onClick={onWhy} className="text-[11px] font-medium text-accent transition hover:opacity-80">Why?</button>}
          {onWhatChanged && <button onClick={onWhatChanged} className="text-[11px] font-medium text-accent transition hover:opacity-80">What changed?</button>}
        </div>
      ) : undefined}
    >
      {/* Verdict + Direction (direction may be colored; confidence may not) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">{verdict}</span>
        {dir && <Badge tone={dir.tone}><dir.Icon aria-hidden className="h-3 w-3" />{direction}</Badge>}
      </div>

      {/* Confidence — accent ring, ORTHOGONAL to direction */}
      <div className={cx('mt-2 flex items-center gap-2', stale && 'opacity-60')}>
        <Ring value={confidence} size={36} color="var(--accent)" glow={!stale}>
          <span className="num text-[9px] font-bold text-accent">{Math.round(confidence)}</span>
        </Ring>
        <div className="text-[11px]">
          <div className="font-semibold text-ink">{band(confidence)} confidence</div>
          {stale && <div className="text-[10px] text-regime-hot">Inputs delayed, confidence reduced</div>}
        </div>
      </div>

      {/* Evidence */}
      {supports.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Evidence</div>
          <EvidenceList items={supports} />
        </div>
      )}
      {/* Counter-signals — never hidden */}
      {opposes.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">Counter-signals</div>
          <EvidenceList items={opposes} oppose />
        </div>
      )}
      {supports.length === 0 && opposes.length === 0 && (
        <div className="mt-2 text-[11px] text-ink-faint">Insufficient data to evidence this view.</div>
      )}

      {/* Risk / Historical / Uncertainty */}
      {(risk || historical || uncertainty) && (
        <div className="mt-3 space-y-1 border-t border-line/60 pt-2 text-[10px] text-ink-muted">
          {risk && <div><span className="text-ink-faint">Risk:</span> {risk}</div>}
          {historical && <div><span className="text-ink-faint">Historical:</span> {historical}</div>}
          {uncertainty && <div><span className="text-ink-faint">Uncertainty:</span> {uncertainty}</div>}
        </div>
      )}

      {/* Source + timestamp */}
      {(sources?.length || timestamp) && (
        <div className="mt-2 text-[9px] text-ink-faint">
          {sources?.length ? `Based on: ${sources.join(', ')}` : ''}
          {timestamp ? `${sources?.length ? ' · ' : ''}as of ${timestamp}` : ''}
        </div>
      )}

      {/* Primary action */}
      {action && (
        <button className={cx('focus-ring mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90', action.tone === 'bear' ? 'bg-bear' : action.tone === 'warn' ? 'bg-regime-hot' : action.tone === 'bull' ? 'bg-bull' : 'bg-accent')}>{action.label}</button>
      )}
    </Panel>
  );
}
