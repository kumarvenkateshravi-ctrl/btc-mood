'use client';

// MTF Intelligence UI (Phase 1) — read-only renderers for the M2–M5 stack on the
// Custom MTF page. Pure display: every value comes from props (the marketIntelligence
// aggregator); no engine logic here.
// Spec: docs/superpowers/specs/2026-07-19-mtf-intelligence-ui-phase1-design.md

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Timeframe } from '@/lib/types';
import type { Verdict } from '@/lib/mtf/types';
import type { AgreementResult } from '@/lib/mtf/agreement/agreementTypes';
import type { ConfidenceResult } from '@/lib/mtf/confidence/confidenceTypes';
import type { CategoryResult } from '@/lib/mtf/categoryTypes';
import type { HierarchyResult, OverallMarketState, RegimeType } from '@/lib/mtf/timeframe/timeframeTypes';
import type { TradeContext } from '@/lib/mtf/marketIntelligence';
import type { TrendLifecycleResult } from '@/lib/mtf/lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '@/lib/mtf/probability/probabilityTypes';
import type { MarketIntelligenceResult, QualityLevel, ReadinessState, RiskLevel } from '@/lib/mtf/market/marketTypes';
import type { TradeDecisionResult } from '@/lib/mtf/decision/decisionTypes';
import type { SignalFreshness } from '@/lib/indicators/maFvg/signals';
import type { MaFvgSignalView } from './useMaFvgSignal';
import { Panel } from '@/components/ui';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '4h': '4H', '1d': '1D' };
const TF_ORDER: Timeframe[] = ['1d', '4h', '1h', '30m', '15m', '5m'];
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const title = (s: string) => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const vColor = (v: Verdict) => (v === 'bullish' ? 'text-bull-bright' : v === 'bearish' ? 'text-bear-bright' : 'text-neutral');
const VGlyph = ({ v }: { v: Verdict }) => v === 'bullish' ? <TrendingUp className="h-3 w-3" /> : v === 'bearish' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;

const stateColor = (s: OverallMarketState) =>
  s.startsWith('bullish') ? 'text-bull-bright'
  : s.startsWith('bearish') || s === 'reversal_risk' ? 'text-bear-bright'
  : s === 'expansion' ? 'text-regime-hot' : 'text-neutral';

const REGIME_SHORT: Record<RegimeType, string> = {
  trending_up: 'Up', trending_down: 'Down', ranging: 'Range', compression: 'Compress', expansion: 'Expand',
};

function Stat({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-xs">
      <span className="text-ink-faint">{k}</span>
      <span className={cx('font-mono tabular-nums font-semibold', tone ?? 'text-ink')}>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------- 1. MTF board
export function MTFIntelligenceBoard({ hierarchy }: { hierarchy: HierarchyResult }) {
  const { overallMarketState, htfBias, alignment, conflict, controller, controllerAuthority, transition, perTimeframe } = hierarchy;
  const transferred = hierarchy.contributors.length > 0 && hierarchy.contributors[0].timeframe !== controller;
  const tfs = TF_ORDER.filter((tf) => perTimeframe[tf]);

  return (
    <Panel eyebrow title="MTF Intelligence Board" badge="M2–M5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cx('text-lg font-bold', stateColor(overallMarketState))}>{title(overallMarketState)}</span>
        <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', vColor(htfBias), 'bg-surface-3')}>{htfBias}</span>
        {transition && <span className="rounded bg-regime-hot/15 px-1.5 py-0.5 text-[10px] font-semibold text-regime-hot">Transition</span>}
      </div>
      <div className="grid grid-cols-3 gap-x-4">
        <Stat k="Alignment" v={`${alignment}%`} />
        <Stat k="Conflict" v={`${conflict}%`} tone={conflict >= 50 ? 'text-bear-bright' : 'text-ink'} />
        <Stat k="Controller" v={`${TF_LABEL[controller]} · ${controllerAuthority}`} tone="text-accent" />
      </div>
      {transferred && (
        <div className="mt-1 text-[10px] text-regime-hot">Control transferred from {TF_LABEL[hierarchy.contributors[0].timeframe]} → {TF_LABEL[controller]}</div>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-ink-faint">
              <th className="pb-1 font-medium">TF</th><th className="pb-1 font-medium">Bias</th>
              <th className="pb-1 font-medium">Regime</th><th className="pb-1 text-right font-medium">Conf</th>
              <th className="pb-1 text-right font-medium">Auth</th><th className="pb-1 text-center font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {tfs.map((tf) => {
              const e = perTimeframe[tf]!;
              return (
                <tr key={tf} className={cx('border-t border-line/40', e.agreesWithHTF ? '' : 'bg-bear/[0.04]')}>
                  <td className="py-1 font-semibold text-ink">{TF_LABEL[tf]}</td>
                  <td className={cx('py-1', vColor(e.bias))}><span className="inline-flex items-center gap-1"><VGlyph v={e.bias} />{e.bias}</span></td>
                  <td className="py-1 text-ink-muted">{REGIME_SHORT[e.regime]}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{e.confidence}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{e.authority}</td>
                  <td className="py-1 text-center text-[9px] uppercase text-ink-faint">{e.role[0]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ------------------------------------------------- 2. agreement & confidence
export function AgreementConfidencePanel({ agreement, confidence, timeframe }: { agreement: AgreementResult; confidence: ConfidenceResult; timeframe: Timeframe }) {
  const notes = [...confidence.signals.slice(0, 2), ...confidence.warnings.slice(0, 2)];
  return (
    <Panel eyebrow title={`Agreement & Confidence · ${TF_LABEL[timeframe]}`} badge="M3 / M4">
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Agreement</div>
          <div className={cx('font-mono text-2xl font-bold', vColor(agreement.dominantBias))}>{agreement.agreement}%</div>
          <div className="text-[11px] text-ink-muted">{title(agreement.consensus)} · conflict {agreement.conflict}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Confidence</div>
          <div className="font-mono text-2xl font-bold text-ink">{confidence.confidence}%</div>
          <div className="text-[11px] text-ink-muted">{title(confidence.state)}</div>
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-1 text-[11px] leading-snug text-ink-muted">
          {notes.map((n) => <li key={n.code} className={n.severity === 'warning' ? 'text-regime-hot' : ''}>· {n.message}</li>)}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------- 3. category strip
export function CategoryStrip({ categories }: { categories: CategoryResult[] }) {
  return (
    <Panel eyebrow title="Category Intelligence" badge="M2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => (
          <div key={c.id} className="rounded-lg border border-line bg-base/40 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold capitalize text-ink">{c.id}</span>
              <span className="font-mono text-[11px] tabular-nums text-ink-muted">{c.confidence}%</span>
            </div>
            <div className={cx('text-[11px]', vColor(c.verdict))}>{title(c.state)}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${c.strength}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ------------------------------------------------ Phase 1b shared helpers
const readinessColor = (s: ReadinessState) =>
  s === 'ready' ? 'text-bull-bright' : s === 'avoid' ? 'text-bear-bright' : s === 'wait' ? 'text-regime-hot' : 'text-neutral';
const qualityColor = (l: QualityLevel) =>
  l === 'excellent' || l === 'good' ? 'text-bull-bright' : l === 'average' ? 'text-regime-hot' : 'text-bear-bright';
const riskColor = (l: RiskLevel) =>
  l === 'very_low' || l === 'low' ? 'text-bull-bright' : l === 'medium' ? 'text-regime-hot' : 'text-bear-bright';

function MiniBar({ label, value, tone = 'bg-accent/70' }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="text-ink-faint">{label}</span>
        <span className="font-mono tabular-nums text-ink-muted">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------- 5. market intelligence verdict (M8)
export function MarketIntelligenceVerdict({ result }: { result: MarketIntelligenceResult }) {
  const { headline, quality, opportunity, risk, readiness } = result;
  return (
    <Panel eyebrow title="Market Intelligence Verdict" badge="M8 · single source of truth">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cx('text-lg font-bold', stateColor(headline.state))}>{title(headline.state)}</span>
        <span className={cx('rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase', vColor(headline.bias))}>{headline.bias}</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted">{title(headline.stage)}</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted">{REGIME_SHORT[headline.regime]}</span>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{TF_LABEL[headline.controller]} controls</span>
        {headline.calibration === 'prior' && (
          <span className="rounded bg-regime-hot/12 px-1.5 py-0.5 text-[10px] text-regime-hot">model priors</span>
        )}
      </div>

      <div className="mb-2 rounded-lg border border-line bg-base/40 p-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">Readiness</span>
        <div className={cx('text-xl font-bold uppercase', readinessColor(readiness.state))}>{readiness.state.replace('_', ' ')}</div>
        <div className="text-[11px] text-ink-muted">{readiness.reason}</div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-base/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Quality</div>
          <div className={cx('text-sm font-bold capitalize', qualityColor(quality.level))}>{quality.level} · {quality.score}</div>
          {quality.reasons.slice(0, 2).map((r) => <div key={r} className="text-[10px] text-ink-faint">· {r}</div>)}
        </div>
        <div className="rounded-lg border border-line bg-base/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Opportunity</div>
          <div className="text-sm font-bold text-ink">{opportunity.grade} · {opportunity.score}</div>
        </div>
        <div className="rounded-lg border border-line bg-base/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Risk</div>
          <div className={cx('text-sm font-bold capitalize', riskColor(risk.level))}>{risk.level.replace('_', ' ')} · {risk.score}</div>
          {risk.reasons.slice(0, 2).map((r) => <div key={r} className="text-[10px] text-ink-faint">· {r}</div>)}
        </div>
      </div>
    </Panel>
  );
}

// --------------------------------------------------- 6. trend lifecycle (M6)
export function TrendLifecyclePanel({ lifecycle }: { lifecycle: TrendLifecycleResult }) {
  const { stage, direction, progression, expectation, nextStageConfidence, invalidation } = lifecycle;
  return (
    <Panel eyebrow title="Trend Lifecycle" badge="M6">
      <div className="flex items-baseline gap-2">
        <span className={cx('text-lg font-bold', vColor(direction))}>{title(stage)}</span>
        <span className="text-[11px] text-ink-muted">
          {progression.previous ? `${title(progression.previous)} → ` : ''}{title(progression.current)} · {progression.trajectory}
        </span>
      </div>
      <Stat k="Expected Next" v={`${title(expectation.expected)} (${nextStageConfidence}%)`} />
      {invalidation.invalidated && (
        <div className="text-[11px] text-bear-bright">Invalidated: {invalidation.condition}</div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <MiniBar label="Strength" value={lifecycle.lifecycleStrength} />
        <MiniBar label="Freshness" value={lifecycle.freshness} />
        <MiniBar label="Exhaustion" value={lifecycle.exhaustion} tone="bg-bear-bright/70" />
      </div>
    </Panel>
  );
}

// ------------------------------------------------------ 7. probability (M7)
export function ProbabilityPanel({ probability }: { probability: ProbabilityResult }) {
  const pct = (p: number) => Math.round(p * 100);
  return (
    <Panel eyebrow title="Outcome Probability" badge="M7">
      <div className="space-y-1">
        {probability.marketOutcomes.map((o) => {
          const dominant = o.outcome === probability.mostLikelyOutcome.outcome;
          return (
            <div key={o.outcome} className="flex items-center gap-2 text-[11px]">
              <span className={cx('w-24 shrink-0', dominant ? 'font-semibold text-ink' : 'text-ink-muted')}>{title(o.outcome)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={cx('h-full rounded-full', dominant ? 'bg-accent' : 'bg-accent/40')} style={{ width: `${pct(o.probability)}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right font-mono tabular-nums">{pct(o.probability)}%</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 border-t border-line pt-1 text-[11px]">
        {probability.directional.map((d) => (
          <span key={d.direction} className={vColor(d.direction === 'sideways' ? 'neutral' : d.direction)}>
            {title(d.direction)} {pct(d.probability)}%
          </span>
        ))}
      </div>
      {probability.calibration === 'prior' && (
        <p className="mt-1 text-[10px] text-ink-faint">Estimates from model priors, not measured frequencies.</p>
      )}
    </Panel>
  );
}

// -------------------------------------------- 8. narrative + evidence (M8)
export function NarrativeEvidencePanel({ result }: { result: MarketIntelligenceResult }) {
  return (
    <Panel eyebrow title="Executive Summary & Evidence" badge="M8">
      <ul className="space-y-0.5 text-[11px] leading-snug text-ink-muted">
        {result.narrative.map((s) => <li key={s}>{s}</li>)}
      </ul>
      <div className="mt-2 grid grid-cols-1 gap-2 border-t border-line pt-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-bull-bright">Supporting</div>
          <ul className="space-y-0.5 text-[11px] text-ink-muted">
            {result.evidence.supporting.map((e) => <li key={e.text}><span className="text-ink-faint">[{e.source}]</span> {e.text}</li>)}
            {result.evidence.supporting.length === 0 && <li className="text-ink-faint">none</li>}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-bear-bright">Opposing</div>
          <ul className="space-y-0.5 text-[11px] text-ink-muted">
            {result.evidence.opposing.map((e) => <li key={e.text}><span className="text-ink-faint">[{e.source}]</span> {e.text}</li>)}
            {result.evidence.opposing.length === 0 && <li className="text-ink-faint">none</li>}
          </ul>
        </div>
      </div>
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-1 text-[11px] text-regime-hot">
          {result.warnings.slice(0, 3).map((w) => <li key={w.code}>⚠ [{w.source}] {w.message}</li>)}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------- 4. trade context
export function TradeContextCard({ context }: { context: TradeContext }) {
  const riskTone = context.risk === 'Low' ? 'text-bull-bright' : context.risk === 'High' ? 'text-bear-bright' : 'text-regime-hot';
  return (
    <Panel eyebrow title="Trade Context" badge="read-only">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Stat k="Overall Market State" v={title(context.overallMarketState)} tone={stateColor(context.overallMarketState)} />
        <Stat k="Controller" v={TF_LABEL[context.controller]} tone="text-accent" />
        <Stat k="Execution TF" v={TF_LABEL[context.executionTf]} tone="text-accent" />
        <Stat k="Risk" v={context.risk} tone={riskTone} />
        <Stat k="Current Opportunity" v={context.opportunity} />
        <Stat k="Recommended Action" v={context.action} />
      </div>
      <p className="mt-1 border-t border-line pt-1 text-[10px] text-ink-faint">
        Deterministic interpretation of the current multi-timeframe state — context only, not a trade signal.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------- 9. trade decision (M9)
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const SOURCE_SHORT: Record<string, string> = {
  atr: 'ATR', swing: 'swing', smc_orderblock: 'OB', smc_fvg: 'FVG', smc_liquidity: 'LIQ',
};

export function TradeDecisionPanel({ decision, smcEnabled, onToggleSmc }: {
  decision: TradeDecisionResult;
  smcEnabled: boolean;
  onToggleSmc: () => void;
}) {
  const { action, gate, executionTf, setup, riskTier, confluence, calibration, explanation, warnings } = decision;
  const actionTone = action === 'long' ? 'text-bull-bright' : action === 'short' ? 'text-bear-bright' : 'text-neutral';
  const tierTone = riskTier === 'full' ? 'text-bull-bright' : riskTier === 'none' ? 'text-ink-faint' : 'text-regime-hot';

  return (
    <Panel eyebrow title="Trade Decision" badge="M9 · conditional proposal">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cx('text-lg font-bold uppercase', actionTone)}>{action.replace('_', ' ')}</span>
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{TF_LABEL[executionTf]} executes</span>
        <span className={cx('rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase', tierTone)}>risk: {riskTier}</span>
        {calibration === 'prior' && (
          <span className="rounded bg-regime-hot/12 px-1.5 py-0.5 text-[10px] text-regime-hot">model priors</span>
        )}
        <button
          type="button"
          onClick={onToggleSmc}
          className={cx(
            'ml-auto rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            smcEnabled ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface-3 text-ink-faint',
          )}
        >
          SMC confluence: {smcEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {action === 'no_trade' && (
        <div className="mb-2 rounded-lg border border-line bg-base/40 p-2">
          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">{gate.blockedBy}</span>
          <div className="mt-1 text-[11px] text-ink-muted">{gate.reason}</div>
        </div>
      )}

      {setup && (
        <div className="mb-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Stat k={`Entry Zone (${setup.entry.type})`} v={`${fmt(setup.entry.zone[0])}–${fmt(setup.entry.zone[1])}`} tone="text-accent" />
          <Stat k="Stop (invalidation)" v={`${fmt(setup.stop.price)} · ${setup.stop.distancePct}% · ${SOURCE_SHORT[setup.stop.source]}`} tone="text-bear-bright" />
          {setup.targets.map((t, i) => (
            <Stat key={t.price} k={`Target ${i + 1}`} v={`${fmt(t.price)} · RR ${t.rr} · ${SOURCE_SHORT[t.source]}`} tone="text-bull-bright" />
          ))}
          <Stat k="Headline RR" v={setup.rr} />
          <Stat k="ATR" v={fmt(setup.atr)} />
        </div>
      )}

      {confluence.length > 0 && (
        <ul className="mb-2 space-y-0.5 border-t border-line pt-1 text-[11px] text-ink-muted">
          {confluence.map((n) => (
            <li key={n.code}>
              <span className="font-mono text-[10px] text-accent">[{n.code}]</span> {n.message} ({fmt(n.before)} → {fmt(n.after)})
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-[11px] text-regime-hot">
          {warnings.map((w) => <li key={w.code}>⚠ {w.message}</li>)}
        </ul>
      )}

      <ul className="space-y-0.5 border-t border-line pt-1 text-[11px] leading-snug text-ink-muted">
        {explanation.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------- 10. MA-FVG 5m signal card
const FRESH: Record<SignalFreshness, { label: string; dot: string; tone: string }> = {
  active: { label: 'Active', dot: 'bg-bull-bright', tone: 'text-bull-bright' },
  aging: { label: 'Aging', dot: 'bg-regime-hot', tone: 'text-regime-hot' },
  stale: { label: 'Stale', dot: 'bg-ink-faint', tone: 'text-ink-faint' },
};

/** Local-timezone "DD Mon YYYY, h:mm AM/PM" for a UNIX-seconds bar time. */
function fmtSignalTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function MaFvgSignalCard({ signal }: { signal: MaFvgSignalView }) {
  const { latest, recent, context } = signal;
  return (
    <Panel eyebrow title="Moving Averages & FVG" badge="5M · indicator decides">
      {latest ? (
        <div className="mb-2 rounded-lg border border-line bg-base/40 p-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('text-xl font-bold uppercase', latest.side === 'buy' ? 'text-bull-bright' : 'text-bear-bright')}>{latest.side}</span>
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">conf {latest.confidence}%</span>
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-ink-muted">@ {fmt(latest.price)}</span>
            <span className={cx('ml-auto inline-flex items-center gap-1 text-[11px] font-semibold', FRESH[latest.freshness].tone)}>
              <span className={cx('h-2 w-2 rounded-full', FRESH[latest.freshness].dot)} />{FRESH[latest.freshness].label}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">
            Generated: {fmtSignalTime(latest.barTime)} • {latest.barsAgo} {latest.barsAgo === 1 ? 'bar' : 'bars'} ago
          </div>
        </div>
      ) : (
        <div className="mb-2 rounded-lg border border-line bg-base/40 p-2.5 text-sm text-ink-muted">No active signal on 5m.</div>
      )}

      {recent.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1 text-[10px]">
          {recent.map((r) => (
            <span key={`${r.side}-${r.barTime}`} className={cx('rounded px-1.5 py-0.5 font-semibold', r.side === 'buy' ? 'bg-bull/15 text-bull-bright' : 'bg-bear/15 text-bear-bright')}>
              {r.side.toUpperCase()} · {r.barsAgo}b
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-1.5">
        <div className="text-[10px] uppercase tracking-wider text-ink-faint">Context — not used to confirm the signal</div>
        <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {context.mtf5m && (
            <Stat k="MTF 5m" v={`${title(context.mtf5m.bias)} · ${REGIME_SHORT[context.mtf5m.regime]} · ${context.mtf5m.confidence}`} tone={vColor(context.mtf5m.bias)} />
          )}
          {context.smc && (
            <Stat k="SMC Structure" v={`${title(context.smc.trend)} · ${title(context.smc.zone)}`} tone={vColor(context.smc.trend)} />
          )}
          {context.smc?.lastEvent && (
            <Stat k="Last SMC Event" v={`${context.smc.lastEvent.type} (${context.smc.lastEvent.direction})`} />
          )}
        </div>
      </div>
    </Panel>
  );
}
