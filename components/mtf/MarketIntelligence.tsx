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
