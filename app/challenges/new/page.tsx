'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Bitcoin, CalendarClock, Check, Database, ShieldCheck } from 'lucide-react';
import ChallengeShell from '@/components/challenges/ChallengeShell';
import { Button, Panel, Tab, Tabs } from '@/components/ui';
import { useReplayDataset } from '@/lib/replay/replayDataset';
import { useReplayState } from '@/lib/replay/replayState';
import { startChallengeAttempt } from '@/lib/challenges/ui/store';
import type { ChallengeType } from '@/lib/challenges/domain/types';
import { formatReplayMoment } from '@/lib/challenges/ui/format';

const CAPITALS = ['10000', '25000', '50000', '100000'] as const;

export default function NewChallengePage() {
  const router = useRouter();
  const dataset = useReplayDataset();
  const replay = useReplayState();
  const [type, setType] = useState<ChallengeType>('twoStep');
  const [capital, setCapital] = useState<(typeof CAPITALS)[number]>('10000');
  const [error, setError] = useState<string | null>(null);
  const executionCandles = dataset.candlesByTf[dataset.executionTf] ?? [];
  const ready = dataset.active && dataset.symbol === 'BTCUSDT' && executionCandles.length > 1;
  const startCandle = executionCandles[Math.max(0, Math.min(executionCandles.length - 1, replay.playIndex))];

  async function start() {
    try {
      const next = await startChallengeAttempt({ type, capital, replayDataset: dataset, startingCursor: replay.playIndex });
      const id = next.readModel?.identity.challengeId;
      if (id) router.push(`/challenges/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Challenge could not be started.');
    }
  }

  return (
    <ChallengeShell>
      <section className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Prop Challenge</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">Build your practice evaluation</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink-muted">Freeze your rules and current BTC replay dataset into one deterministic attempt.</p>
        </div>

        <Panel className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-[1.12fr_.88fr]">
            <div className="space-y-8 p-6 sm:p-8 lg:border-r lg:border-line/60">
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Challenge type</legend>
                <Tabs value={type} onChange={(value) => setType(value as ChallengeType)} aria-label="Challenge type" className="grid w-full grid-cols-2">
                  <Tab id="oneStep">One-Step</Tab>
                  <Tab id="twoStep">Two-Step</Tab>
                </Tabs>
                <p className="mt-2 text-xs leading-5 text-ink-muted">{type === 'twoStep' ? 'Two independent phases. Capital and drawdown references reset for Phase 2.' : 'One evaluation phase with a 10% profit target.'}</p>
              </fieldset>

              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Account size</legend>
                <div role="radiogroup" aria-label="Account size" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CAPITALS.map((value) => {
                    const selected = capital === value;
                    return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setCapital(value)} className={`focus-ring group relative rounded-xl border px-3 py-3 text-left transition-all duration-200 ${selected ? 'border-accent/60 bg-accent/12 text-ink shadow-[inset_0_1px_0_var(--specular)]' : 'border-line bg-surface-2/50 text-ink-muted hover:border-line-strong hover:bg-surface-2'}`}>
                      <span className="num text-base font-semibold text-ink">{'$'}{Number(value) / 1000}K</span>
                      {selected && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-accent" />}
                    </button>;
                  })}
                </div>
              </fieldset>

              <div>
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Replay configuration</div>
                <div className="divide-y divide-line/60 rounded-xl border border-line/70 bg-surface-2/35">
                  <ConfigRow icon={Bitcoin} label="Market" value="BTCUSDT" />
                  <ConfigRow icon={Database} label="Dataset" value={ready ? dataset.sessionId : 'No active replay dataset'} />
                  <ConfigRow icon={CalendarClock} label="Timeframe" value={ready ? dataset.executionTf : '—'} />
                  <ConfigRow icon={CalendarClock} label="Starting point" value={startCandle ? formatReplayMoment(startCandle.time) : 'Select a BTC replay point'} />
                </div>
                {!ready && <div className="mt-3 flex items-start gap-2 rounded-lg border border-regime-hot/25 bg-regime-hot/[0.06] px-3 py-2.5 text-xs leading-5 text-regime-hot"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Start Bar Replay on the BTC chart first. The Challenge will freeze that exact dataset and starting point.</div>}
              </div>
            </div>

            <div className="flex flex-col bg-surface-2/20 p-6 sm:p-8">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Rules at a glance</h2></div>
              <div className="mt-6 space-y-3">
                <Rule label="Profit target" value={type === 'twoStep' ? '10% / 8%' : '10%'} />
                <Rule label="Daily loss" value="5%" />
                <Rule label="Maximum loss" value="10% static" />
                <Rule label="Trading days" value="3 finalized" />
                <Rule label="Profitable days" value="3 finalized" />
                <Rule label="Profitable day" value="+0.1%" />
                <Rule label="Maximum leverage" value="20x" />
                <Rule label="Daily reset" value="00:00 UTC" />
              </div>
              <div className="mt-7 border-t border-line/70 pt-6">
                <Method title="Daily loss methodology">Daily floor = day-start cash minus 5% of phase starting cash. Evaluated against equity.</Method>
                <Method title="Maximum loss methodology">Static floor = phase starting cash minus 10%. Evaluated against equity.</Method>
              </div>
              <div className="mt-auto pt-8">
                {error && <p role="alert" className="mb-3 text-xs text-bear-bright">{error}</p>}
                <Button onClick={start} disabled={!ready} variant="solid" size="lg" className="w-full" icon={<ArrowRight className="h-4 w-4" />}>Start Challenge</Button>
                <p className="mt-3 text-center text-[10px] leading-4 text-ink-faint">Rules, BTC instrument policy, execution policy, and dataset are frozen for this attempt.</p>
              </div>
            </div>
          </div>
        </Panel>
      </section>
    </ChallengeShell>
  );
}
function ConfigRow({ icon: Icon, label, value }: { icon: typeof Bitcoin; label: string; value: string }) {
  return <div className="grid grid-cols-[24px_88px_1fr] items-center gap-2 px-3 py-3 text-xs"><Icon className="h-3.5 w-3.5 text-ink-faint" /><span className="text-ink-faint">{label}</span><span className="min-w-0 truncate text-right font-medium text-ink">{value}</span></div>;
}
function Rule({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4"><span className="text-xs text-ink-muted">{label}</span><span className="num text-xs font-semibold text-ink">{value}</span></div>;
}
function Method({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mb-4 last:mb-0"><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{title}</div><p className="mt-1 text-[11px] leading-5 text-ink-muted">{children}</p></div>;
}
