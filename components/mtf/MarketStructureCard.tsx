'use client';

// Market Structure Engine card — first renderer of MarketStructureSnapshot.
// Pure display: every number comes from the snapshot; no scoring or market
// logic lives here. Spec:
// docs/superpowers/specs/2026-07-18-market-structure-engine-design.md

import { ArrowDown } from 'lucide-react';
import type { Timeframe } from '@/lib/types';
import type { MarketStructureSnapshot, Section } from '@/lib/mtf/structureEngine';
import { isDebugEnabled } from '@/lib/debug';
import { Panel } from '@/components/ui';

const TF_LABEL: Record<Timeframe, string> = { '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '4h': '4H', '1d': '1D' };

const trendColor = (t: string) =>
  t === 'bullish' || t === 'Bullish' ? 'text-bull-bright' : t === 'bearish' || t === 'Bearish' ? 'text-bear-bright' : 'text-neutral';

function SectionShell({ title, section, children }: {
  title: string;
  section: Section<unknown>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-base/40 p-2.5">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
      {section.state === 'ready' ? children : (
        <div className="py-2 text-center text-[11px] text-ink-faint">
          {section.state === 'insufficient_history' ? 'Insufficient history' : 'Warming up…'}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-ink-faint">{k}</span>
      <span className={['font-mono tabular-nums', tone ?? 'text-ink'].join(' ')}>{v}</span>
    </div>
  );
}

export interface MarketStructureCardProps {
  snapshot: MarketStructureSnapshot;
  cacheHit: boolean;
  tfOptions: Timeframe[];
  selectedTf: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
}

export default function MarketStructureCard({ snapshot, cacheHit, tfOptions, selectedTf, onSelectTf }: MarketStructureCardProps) {
  const { structure, liquidity, fvg, orderBlocks, structureBreaks, premiumDiscount, timeline, phase, quality, narratives, metadata } = snapshot;
  const debug = isDebugEnabled('marketStructure');

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-accent">MARKET STRUCTURE ENGINE</h2>
          <span className="text-[11px] text-ink-faint">{metadata.symbol} · live SMC state, no composite score</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-base p-0.5">
          {tfOptions.map((tf) => (
            <button key={tf} onClick={() => onSelectTf(tf)}
              className={['rounded px-2 py-1 text-[11px] font-medium transition', selectedTf === tf ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink'].join(' ')}>
              {TF_LABEL[tf]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {/* Current Structure */}
        <SectionShell title="Current Structure" section={structure}>
          {structure.data && (
            <>
              <div className={['text-lg font-bold', trendColor(structure.data.trend)].join(' ')}>
                {structure.data.trend.charAt(0).toUpperCase() + structure.data.trend.slice(1)}
              </div>
              {structure.data.sequence.length > 0 && (
                <div className="font-mono text-xs text-ink-muted">{structure.data.sequence.join(' → ')}</div>
              )}
              <Row k="Confidence" v={`${structure.data.confidence}%`} />
              <Row k="Structure Age" v={structure.data.ageBars != null ? `Established ${structure.data.ageBars} bars ago` : 'Not yet established'} />
            </>
          )}
        </SectionShell>

        {/* Liquidity */}
        <SectionShell title="Liquidity" section={liquidity}>
          {liquidity.data && (
            <div className="grid grid-cols-2 gap-x-3">
              {([['Buy-side', liquidity.data.buySide], ['Sell-side', liquidity.data.sellSide]] as const).map(([label, s]) => (
                <div key={label}>
                  <div className="mb-0.5 text-[10px] font-medium text-ink-muted">{label} Pools</div>
                  <Row k="Created" v={s.created} />
                  <Row k="Swept" v={s.swept} />
                  <Row k="Still Active" v={s.active} tone="text-ink font-semibold" />
                  <Row k="Today" v={s.createdToday} tone="text-ink-muted" />
                </div>
              ))}
            </div>
          )}
        </SectionShell>

        {/* Fair Value Gaps */}
        <SectionShell title="Fair Value Gaps" section={fvg}>
          {fvg.data && (
            <>
              <div className="grid grid-cols-2 gap-x-3">
                {([['Bullish', fvg.data.bullish, 'text-bull-bright'], ['Bearish', fvg.data.bearish, 'text-bear-bright']] as const).map(([label, s, tone]) => (
                  <div key={label}>
                    <div className={['mb-0.5 text-[10px] font-medium', tone].join(' ')}>{label}</div>
                    <Row k="Created" v={s.created} />
                    <Row k="Still Open" v={s.open} tone="text-ink font-semibold" />
                    <Row k="Filled" v={s.filled} />
                    <Row k="Stacked" v={s.stacked} />
                    <Row k="Today" v={s.createdToday} tone="text-ink-muted" />
                  </div>
                ))}
              </div>
              <div className="mt-1 border-t border-line pt-1">
                <Row k="Net FVG Bias" tone={fvg.data.netBias > 0 ? 'text-bull-bright font-semibold' : fvg.data.netBias < 0 ? 'text-bear-bright font-semibold' : 'text-neutral'}
                  v={fvg.data.netBias > 0 ? `+${fvg.data.netBias} Bullish` : fvg.data.netBias < 0 ? `${-fvg.data.netBias} Bearish` : 'Balanced'} />
                <Row k="Freshest" v={fvg.data.freshestBarsAgo != null ? `${fvg.data.freshestBarsAgo} bars ago` : '—'} />
              </div>
            </>
          )}
        </SectionShell>

        {/* Order Blocks */}
        <SectionShell title="Order Blocks" section={orderBlocks}>
          {orderBlocks.data && (
            <>
              <div className="grid grid-cols-2 gap-x-3">
                {([['Bullish', orderBlocks.data.bullish, 'text-bull-bright'], ['Bearish', orderBlocks.data.bearish, 'text-bear-bright']] as const).map(([label, s, tone]) => (
                  <div key={label}>
                    <div className={['mb-0.5 text-[10px] font-medium', tone].join(' ')}>{label}</div>
                    <Row k="Created" v={s.created} />
                    <Row k="Fresh" v={s.fresh} tone="text-ink font-semibold" />
                    <Row k="Mitigated" v={s.mitigated} />
                    <Row k="Broken" v={s.broken} />
                  </div>
                ))}
              </div>
              <div className="mt-1 border-t border-line pt-1">
                {([['Nearest Bullish', orderBlocks.data.nearestBullish], ['Nearest Bearish', orderBlocks.data.nearestBearish]] as const).map(([label, nb]) => (
                  <Row key={label} k={label} v={nb ? `${nb.price.toLocaleString(undefined, { maximumFractionDigits: 1 })} · ${nb.distancePct}%` : '—'} />
                ))}
              </div>
            </>
          )}
        </SectionShell>

        {/* Market Structure (windowed breaks) */}
        <SectionShell title={`Market Structure · last ${structureBreaks.data?.windowBars ?? 20} bars`} section={structureBreaks}>
          {structureBreaks.data && (
            <>
              <div className="grid grid-cols-2 gap-x-3">
                <div>
                  <Row k="Bullish BOS" v={structureBreaks.data.window.bullishBos} tone="text-bull-bright" />
                  <Row k="Bullish CHoCH" v={structureBreaks.data.window.bullishChoch} tone="text-bull-bright" />
                </div>
                <div>
                  <Row k="Bearish BOS" v={structureBreaks.data.window.bearishBos} tone="text-bear-bright" />
                  <Row k="Bearish CHoCH" v={structureBreaks.data.window.bearishChoch} tone="text-bear-bright" />
                </div>
              </div>
              {structureBreaks.data.perTf.length > 0 && (
                <div className="mt-1 border-t border-line pt-1">
                  <div className="mb-0.5 text-[10px] text-ink-faint">BOS / CHoCH by timeframe</div>
                  <div className="grid grid-cols-6 gap-1 text-center">
                    {structureBreaks.data.perTf.map((p) => (
                      <div key={p.timeframe} className="rounded border border-line/60 py-1">
                        <div className="text-[9px] text-ink-faint">{TF_LABEL[p.timeframe]}</div>
                        <div className="font-mono text-[10px] tabular-nums">
                          <span className="text-bull-bright">{p.bullishBos + p.bullishChoch}</span>
                          <span className="text-ink-faint"> / </span>
                          <span className="text-bear-bright">{p.bearishBos + p.bearishChoch}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </SectionShell>

        {/* Premium / Discount */}
        <SectionShell title="Premium / Discount" section={premiumDiscount}>
          {premiumDiscount.data && (
            <>
              <div className={['text-base font-bold', premiumDiscount.data.zone === 'discount' ? 'text-bull-bright' : premiumDiscount.data.zone === 'premium' ? 'text-bear-bright' : 'text-neutral'].join(' ')}>
                {premiumDiscount.data.zone.charAt(0).toUpperCase() + premiumDiscount.data.zone.slice(1)} Zone
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">{premiumDiscount.data.description}</p>
            </>
          )}
        </SectionShell>

        {/* Timeline + Current Phase */}
        <SectionShell title="Latest Events" section={timeline}>
          {timeline.data && (
            <div className="flex flex-col items-start gap-0.5">
              {timeline.data.items.map((item) => (
                <div key={item.eventId} className="flex flex-col items-start gap-0.5">
                  <span className={['text-xs', trendColor(item.direction)].join(' ')}>✓ {item.label}</span>
                  <ArrowDown className="ml-1 h-3 w-3 text-ink-faint" />
                </div>
              ))}
              <div className="mt-0.5 rounded border border-line bg-surface-2/50 px-2 py-1 text-xs">
                <span className="text-ink-faint">Current Phase · </span>
                <span className="font-medium text-ink">{phase.data?.label ?? 'Warming up…'}</span>
              </div>
            </div>
          )}
        </SectionShell>

        {/* Structure Quality */}
        <SectionShell title="Structure Quality" section={quality}>
          {quality.data && (
            <>
              <div className={['text-lg font-bold', quality.data.classification === 'Excellent' || quality.data.classification === 'Strong' ? 'text-bull-bright' : quality.data.classification === 'Moderate' ? 'text-regime-hot' : 'text-bear-bright'].join(' ')}>
                {quality.data.classification}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">{quality.data.summary}</p>
            </>
          )}
        </SectionShell>

        {/* Narratives */}
        <SectionShell title="Reading the Market" section={{ state: narratives.length > 0 ? 'ready' : 'warming_up', data: narratives }}>
          <ul className="space-y-1 text-[11px] leading-snug text-ink-muted">
            {narratives.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </SectionShell>
      </div>

      {debug && (
        <details className="mt-2 rounded-lg border border-line bg-base/40 p-2 text-[11px] text-ink-muted">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Engine Diagnostics</summary>
          <div className="mt-1 grid grid-cols-2 gap-x-4 md:grid-cols-3">
            <Row k="Snapshot Version" v={metadata.snapshotVersion} />
            <Row k="Timeframe" v={metadata.timeframe} />
            <Row k="Order Blocks" v={(orderBlocks.data?.bullish.created ?? 0) + (orderBlocks.data?.bearish.created ?? 0)} />
            <Row k="FVGs" v={(fvg.data?.bullish.created ?? 0) + (fvg.data?.bearish.created ?? 0)} />
            <Row k="Liquidity Pools" v={(liquidity.data?.buySide.created ?? 0) + (liquidity.data?.sellSide.created ?? 0)} />
            <Row k="Timeline Events" v={timeline.data?.items.length ?? 0} />
            <Row k="Computation" v={`${metadata.computationTimeMs} ms`} />
            <Row k="Snapshot Time" v={new Date(metadata.lastClosedBarTime).toISOString().slice(11, 16) + ' UTC'} />
            <Row k="Cache Hit" v={cacheHit ? 'yes' : 'no'} />
          </div>
        </details>
      )}
    </Panel>
  );
}
