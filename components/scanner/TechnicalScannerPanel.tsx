'use client';

// Technical Scanner — the builder panel (right dock). METADATA-DRIVEN: every
// dropdown (sources, outputs, params, operators, timeframes) comes from the
// registry — adding indicator #80 = register it, zero UI changes here.
// Sections: My Strategies · New/Builder (recursive groups) · live Validation ·
// Strategy Inspector · Versions · Chart Visibility · Save / Save-as-version /
// Archive. Editing NEVER mutates history: saves append immutable versions.

import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui';
import { TIMEFRAMES, type Timeframe, type Candle } from '@/lib/types';
import { versionComparison } from '@/lib/scanner/analytics';
import { SCANNER_SOURCE_LIST, SCANNER_SOURCES } from '@/lib/scanner/registry';
import { OPERATORS } from '@/lib/scanner/operators';
import { validateStrategy } from '@/lib/scanner/validate';
import {
  listStrategies, createStrategy, saveNewVersion, setStrategyEnabled,
  setActiveVersion, setChartVisible, archiveStrategy,
} from '@/lib/scanner/scannerStore';
import type { Condition, GroupNode, OperatorId, ScannerStrategy, SeriesRef, SourceGroup } from '@/lib/scanner/types';
import { isCondition } from '@/lib/scanner/types';

const GROUP_LABEL: Record<SourceGroup, string> = {
  standard: 'Standard', structure: 'Structure', intelligence: 'Intelligence',
};

const defaultCondition = (): Condition => ({
  left: { source: 'rsi', output: 'rsi' }, op: 'gt', right: 55, tf: '15m',
});

const defaultParams = (sourceId: string): Record<string, number | string> | undefined => {
  const src = SCANNER_SOURCES[sourceId];
  if (!src || src.params.length === 0) return undefined;
  return Object.fromEntries(src.params.map((p) => [p.id, p.default as number | string]));
};

// ---- Draft strategy assembled for LIVE validation on every edit -------------

interface Draft {
  id: string | null; // null = creating
  name: string;
  direction: 'long' | 'short';
  exits: ScannerStrategy['exits'];
  tree: GroupNode;
  note: string;
}

const draftToStrategy = (d: Draft): ScannerStrategy => ({
  id: d.id ?? 'draft', name: d.name, direction: d.direction, schemaVersion: 1,
  versions: [{ v: 1, createdAt: 0, note: d.note, tree: d.tree }],
  activeVersion: 1, enabled: false, archived: false, exits: d.exits,
  ownerId: null, visibility: 'private', createdAt: 0, updatedAt: 0,
  parentStrategy: null, forkCount: 0, likes: 0,
});

export default function TechnicalScannerPanel({
  candlesByTf,
  evalTf = '15m',
}: {
  candlesByTf?: Partial<Record<Timeframe, Candle[]>>;
  evalTf?: Timeframe;
} = {}) {
  const [rev, setRev] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [statsFor, setStatsFor] = useState<string | null>(null);
  const bump = () => setRev((r) => r + 1);
  const strategies = useMemo(() => listStrategies().filter((s) => !s.archived), [rev]);
  const statsStrategy = statsFor ? strategies.find((s) => s.id === statsFor) : undefined;

  const openNew = () => setDraft({
    id: null, name: '', direction: 'long',
    exits: { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    tree: { logic: 'AND', children: [defaultCondition()] },
    note: 'Initial version',
  });
  const openEdit = (s: ScannerStrategy) => {
    const active = s.versions.find((v) => v.v === s.activeVersion) ?? s.versions[s.versions.length - 1];
    setDraft({
      id: s.id, name: s.name, direction: s.direction, exits: { ...s.exits },
      tree: JSON.parse(JSON.stringify(active.tree)) as GroupNode, note: '',
    });
  };

  return (
    <Panel title="Technical Scanner">
      <p className="mb-2 text-[10px] text-ink-faint">
        Closed-bar, non-repainting strategies. Paper &amp; educational — not financial advice.
      </p>
      {draft ? (
        <StrategyEditor draft={draft} onChange={setDraft} onDone={() => { setDraft(null); bump(); }} />
      ) : statsStrategy && candlesByTf ? (
        <StrategyStats strategy={statsStrategy} candlesByTf={candlesByTf} evalTf={evalTf} onBack={() => setStatsFor(null)} />
      ) : (
        <StrategyList strategies={strategies} onNew={openNew} onEdit={openEdit} onBump={bump}
          onStats={candlesByTf ? setStatsFor : undefined} />
      )}
    </Panel>
  );
}

// ---- Analytics: per-version backtest comparison (Sprint 7) -------------------

function StrategyStats({
  strategy, candlesByTf, evalTf, onBack,
}: {
  strategy: ScannerStrategy;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
  evalTf: Timeframe;
  onBack: () => void;
}) {
  const rows = useMemo(
    () => versionComparison(strategy, candlesByTf, evalTf),
    [strategy, candlesByTf, evalTf],
  );
  const pf = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">{strategy.name} — backtest ({evalTf}, loaded history)</span>
        <button type="button" onClick={onBack} className="focus-ring text-[10px] text-ink-faint hover:text-ink">← back</button>
      </div>
      {rows.map((r) => (
        <div key={r.version}
          className={`rounded-md border px-2 py-1.5 font-mono text-[10px] tabular-nums ${r.version === strategy.activeVersion ? 'border-accent/50 bg-surface-2' : 'border-line bg-surface-2/50'}`}>
          <p className="font-sans text-ink">
            v{r.version}{r.version === strategy.activeVersion ? ' · active' : ''} <span className="text-ink-faint">— {r.note || 'no note'}</span>
          </p>
          {r.resolved === 0 ? (
            <p className="text-ink-faint">{r.signals} signal{r.signals === 1 ? '' : 's'} · none resolved yet</p>
          ) : (
            <>
              <p className="text-ink-muted">
                {r.signals} sig · win {(r.winRate * 100).toFixed(0)}% ({r.wins}/{r.resolved}) · exp {r.expectancy.toFixed(2)}R · PF {pf(r.profitFactor)}
              </p>
              <p className="text-ink-faint">
                TP1 {r.tp1Hits} · TP2 {r.tp2Hits} · TP3 {r.tp3Hits} · SL {r.stopped} · maxDD {r.maxDrawdownR.toFixed(1)}R
              </p>
              <p className="text-ink-faint">
                streaks +{r.bestStreak}/−{r.worstStreak} · {r.avgBarsHeld.toFixed(0)} bars avg · MFE {r.avgMfeR.toFixed(1)}R · MAE {r.avgMaeR.toFixed(1)}R
              </p>
            </>
          )}
        </div>
      ))}
      <p className="text-[10px] text-ink-faint">
        Deterministic closed-bar backtest — identical to live evaluation over the same bars.
      </p>
    </div>
  );
}

// ---- My Strategies -----------------------------------------------------------

function StrategyList({
  strategies, onNew, onEdit, onBump, onStats,
}: {
  strategies: ScannerStrategy[];
  onNew: () => void;
  onEdit: (s: ScannerStrategy) => void;
  onBump: () => void;
  onStats?: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <button type="button" onClick={onNew}
        className="focus-ring w-full rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs font-semibold text-ink hover:bg-accent/20">
        + New Strategy
      </button>
      {strategies.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-muted">No strategies yet — build your first.</p>
      ) : (
        <ul className="divide-y divide-line text-[11px]">
          {strategies.map((s) => (
            <li key={s.id} className="py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{s.name}</span>
                <span className="font-mono text-[10px] text-ink-faint">v{s.activeVersion} · {s.direction}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px]">
                <label className="flex items-center gap-1 text-ink-muted">
                  <input type="checkbox" checked={s.enabled}
                    onChange={(e) => { setStrategyEnabled(s.id, e.target.checked); onBump(); }}
                    className="h-3 w-3 accent-accent" /> Live
                </label>
                <label className="flex items-center gap-1 text-ink-muted">
                  <input type="checkbox" checked={s.chartVisible !== false}
                    onChange={(e) => { setChartVisible(s.id, e.target.checked); onBump(); }}
                    className="h-3 w-3 accent-accent" /> On chart
                </label>
                {onStats && (
                  <button type="button" onClick={() => onStats(s.id)} className="focus-ring ml-auto text-accent hover:underline">Stats</button>
                )}
                <button type="button" onClick={() => onEdit(s)} className={`focus-ring text-accent hover:underline${onStats ? '' : ' ml-auto'}`}>Edit</button>
                <button type="button" onClick={() => { archiveStrategy(s.id); onBump(); }} className="focus-ring text-ink-faint hover:text-bear-bright">Archive</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Builder (recursive) + Validation + Inspector + Versions ------------------

function StrategyEditor({
  draft, onChange, onDone,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onDone: () => void;
}) {
  const validation = useMemo(() => validateStrategy(draftToStrategy(draft)), [draft]);
  const existing = draft.id ? listStrategies().find((s) => s.id === draft.id) : undefined;
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = () => {
    const res = draft.id
      ? saveNewVersion(draft.id, draft.tree, draft.note || 'Updated')
      : createStrategy({ name: draft.name, direction: draft.direction, tree: draft.tree, note: draft.note, exits: draft.exits });
    if (res.strategy) onDone();
    else setSaveError(res.validation.errors[0]?.message ?? 'invalid strategy');
  };

  return (
    <div className="space-y-2.5 text-[11px]">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Name</span>
          <input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className="focus-ring mt-0.5 w-full rounded border border-line bg-base px-1.5 py-1 text-xs text-ink" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">Direction</span>
          <select value={draft.direction} onChange={(e) => onChange({ ...draft, direction: e.target.value as 'long' | 'short' })}
            className="focus-ring mt-0.5 w-full rounded border border-line bg-base px-1 py-1 text-xs text-ink">
            <option value="long">Long (BUY)</option>
            <option value="short">Short (SELL)</option>
          </select>
        </label>
      </div>

      <GroupEditor node={draft.tree} onChange={(tree) => onChange({ ...draft, tree })} depth={0} />

      <div className="grid grid-cols-4 gap-1.5">
        {(['slAtr', 'tp1R', 'tp2R', 'tp3R'] as const).map((k) => (
          <label key={k} className="block">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">{k === 'slAtr' ? 'SL (ATR)' : `${k.slice(0, 3).toUpperCase()} (R)`}</span>
            <input type="number" step={0.1} value={draft.exits[k]}
              onChange={(e) => onChange({ ...draft, exits: { ...draft.exits, [k]: Number(e.target.value) } })}
              className="focus-ring mt-0.5 w-full rounded border border-line bg-base px-1.5 py-1 font-mono text-xs text-ink" />
          </label>
        ))}
      </div>

      {/* Live validation */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-0.5 text-[10px]">
          {validation.errors.map((e, i) => (
            <p key={i} className="text-bear-bright">✕ {e.message} <span className="text-ink-faint">({e.path})</span></p>
          ))}
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-amber-400">⚠ {w.message}</p>
          ))}
        </div>
      )}

      {/* Strategy Inspector */}
      <div className="rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-[10px] tabular-nums text-ink-muted">
        <p className="mb-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Inspector</p>
        <p>{validation.ok ? '✓ Valid' : '✕ Invalid'} · {validation.complexity.conditions} cond · {validation.complexity.groups} groups · depth {validation.complexity.depth}</p>
        <p>TFs {validation.complexity.timeframes.join(' ') || '—'} · cost {validation.complexity.cost} ({validation.complexity.costUnits}u)</p>
        <p>Uses {validation.complexity.sources.map((id) => SCANNER_SOURCES[id]?.name ?? id).join(', ') || '—'}</p>
        {existing && <p>Version v{existing.activeVersion} → will save v{Math.max(...existing.versions.map((x) => x.v)) + 1}</p>}
      </div>

      {/* Versions (existing strategies) */}
      {existing && existing.versions.length > 0 && (
        <div className="text-[10px]">
          <p className="font-semibold uppercase tracking-wider text-ink-faint">Versions</p>
          <ul className="mt-0.5 space-y-0.5">
            {[...existing.versions].reverse().map((v) => (
              <li key={v.v} className="flex items-center justify-between text-ink-muted">
                <span>v{v.v} · {v.note || '—'}</span>
                {v.v === existing.activeVersion
                  ? <span className="text-accent">active</span>
                  : <button type="button" className="focus-ring text-ink-faint hover:text-ink"
                      onClick={() => { setActiveVersion(existing.id, v.v); onDone(); }}>activate</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">{draft.id ? 'Version note' : 'Note'}</span>
        <input value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })}
          placeholder={draft.id ? 'What changed?' : 'Initial version'}
          className="focus-ring mt-0.5 w-full rounded border border-line bg-base px-1.5 py-1 text-xs text-ink" />
      </label>

      {saveError && <p className="text-[10px] text-bear-bright">✕ {saveError}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!validation.ok}
          className="focus-ring flex-1 rounded-md border border-accent/50 bg-accent/15 px-2 py-1.5 text-xs font-semibold text-ink disabled:opacity-40">
          {draft.id ? 'Save as New Version' : 'Save Strategy'}
        </button>
        <button type="button" onClick={onDone}
          className="focus-ring rounded-md border border-line px-2 py-1.5 text-xs text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

function GroupEditor({
  node, onChange, depth,
}: {
  node: GroupNode;
  onChange: (n: GroupNode) => void;
  depth: number;
}) {
  const setChild = (i: number, child: GroupNode | Condition) =>
    onChange({ ...node, children: node.children.map((c, k) => (k === i ? child : c)) });
  const removeChild = (i: number) =>
    onChange({ ...node, children: node.children.filter((_, k) => k !== i) });

  return (
    <div className={`rounded-md border border-line p-1.5 ${depth > 0 ? 'ml-2 bg-surface-2/50' : 'bg-surface-2'}`}>
      <div className="mb-1 flex items-center gap-2">
        <select value={node.logic} aria-label="Group logic"
          onChange={(e) => onChange({ ...node, logic: e.target.value as 'AND' | 'OR' })}
          className="focus-ring rounded border border-line bg-base px-1 py-0.5 font-mono text-[10px] text-ink">
          <option value="AND">ALL of (AND)</option>
          <option value="OR">ANY of (OR)</option>
        </select>
        <button type="button" onClick={() => onChange({ ...node, children: [...node.children, defaultCondition()] })}
          className="focus-ring text-[10px] text-accent hover:underline">+ Condition</button>
        <button type="button" onClick={() => onChange({ ...node, children: [...node.children, { logic: 'AND', children: [defaultCondition()] }] })}
          className="focus-ring text-[10px] text-accent hover:underline">+ Group</button>
      </div>
      <div className="space-y-1">
        {node.children.map((child, i) => (
          <div key={i} className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              {isCondition(child)
                ? <ConditionEditor cond={child} onChange={(c) => setChild(i, c)} />
                : <GroupEditor node={child} onChange={(g) => setChild(i, g)} depth={depth + 1} />}
            </div>
            <button type="button" aria-label="Remove" onClick={() => removeChild(i)}
              className="focus-ring mt-1 px-1 text-[10px] text-ink-faint hover:text-bear-bright">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Condition row: EVERY option from the registry ---------------------------

function ConditionEditor({ cond, onChange }: { cond: Condition; onChange: (c: Condition) => void }) {
  const source = SCANNER_SOURCES[cond.left.source];
  const op = OPERATORS[cond.op];
  const rhsKinds = op?.rhs ?? [];
  const rhsIsSeries = typeof cond.right === 'object' && !Array.isArray(cond.right);
  const rhsIsRange = Array.isArray(cond.right);
  const rightSource = rhsIsSeries ? SCANNER_SOURCES[(cond.right as SeriesRef).source] : undefined;

  const setSource = (id: string) => {
    const s = SCANNER_SOURCES[id];
    const opOk = s.operators.includes(cond.op) ? cond.op : s.operators[0];
    onChange({
      ...cond,
      left: { source: id, output: s.outputs[0].id, params: defaultParams(id) },
      op: opOk,
      right: typeof cond.right === 'number' ? cond.right : 50,
    });
  };
  const setOp = (id: OperatorId) => {
    const nextOp = OPERATORS[id];
    let right = cond.right;
    if (nextOp.rhs.length > 0) {
      if (nextOp.rhs.includes('range') && !Array.isArray(right)) right = [40, 60];
      else if (!nextOp.rhs.includes('range') && Array.isArray(right)) right = 50;
    }
    onChange({ ...cond, op: id, right });
  };

  const sel = 'focus-ring rounded border border-line bg-base px-1 py-0.5 text-[10px] text-ink';
  const inp = 'focus-ring w-14 rounded border border-line bg-base px-1 py-0.5 font-mono text-[10px] text-ink';

  return (
    <div className="flex flex-wrap items-center gap-1 rounded border border-line bg-surface-1 p-1">
      <select value={cond.left.source} aria-label="Source" onChange={(e) => setSource(e.target.value)} className={sel}>
        {(['standard', 'structure', 'intelligence'] as SourceGroup[]).map((g) => (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {SCANNER_SOURCE_LIST.filter((s) => s.group === g).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {source && source.outputs.length > 1 && (
        <select value={cond.left.output} aria-label="Output"
          onChange={(e) => onChange({ ...cond, left: { ...cond.left, output: e.target.value } })} className={sel}>
          {source.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      {source?.params.map((p) => (
        <input key={p.id} type="number" aria-label={p.name} title={p.name}
          value={Number(cond.left.params?.[p.id] ?? p.default)}
          min={p.min} max={p.max} step={p.step}
          onChange={(e) => onChange({ ...cond, left: { ...cond.left, params: { ...cond.left.params, [p.id]: Number(e.target.value) } } })}
          className={inp} />
      ))}
      <select value={cond.op} aria-label="Operator" onChange={(e) => setOp(e.target.value as OperatorId)} className={sel}>
        {(source?.operators ?? []).map((id) => <option key={id} value={id}>{OPERATORS[id].label}</option>)}
      </select>

      {rhsKinds.length > 0 && (
        <>
          {rhsKinds.includes('number') && rhsKinds.includes('series') && (
            <select aria-label="Compare with" value={rhsIsSeries ? 'series' : 'number'} className={sel}
              onChange={(e) => onChange({ ...cond, right: e.target.value === 'series' ? { source: 'ema', output: 'value', params: defaultParams('ema') } : 50 })}>
              <option value="number">value</option>
              <option value="series">indicator</option>
            </select>
          )}
          {rhsIsRange ? (
            <>
              <input type="number" aria-label="Range low" value={(cond.right as [number, number])[0]}
                onChange={(e) => onChange({ ...cond, right: [Number(e.target.value), (cond.right as [number, number])[1]] })} className={inp} />
              <input type="number" aria-label="Range high" value={(cond.right as [number, number])[1]}
                onChange={(e) => onChange({ ...cond, right: [(cond.right as [number, number])[0], Number(e.target.value)] })} className={inp} />
            </>
          ) : rhsIsSeries ? (
            <>
              <select value={(cond.right as SeriesRef).source} aria-label="Right source" className={sel}
                onChange={(e) => onChange({ ...cond, right: { source: e.target.value, output: SCANNER_SOURCES[e.target.value].outputs[0].id, params: defaultParams(e.target.value) } })}>
                {SCANNER_SOURCE_LIST.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {rightSource?.params.map((p) => (
                <input key={p.id} type="number" aria-label={`Right ${p.name}`} title={p.name}
                  value={Number((cond.right as SeriesRef).params?.[p.id] ?? p.default)}
                  onChange={(e) => onChange({ ...cond, right: { ...(cond.right as SeriesRef), params: { ...(cond.right as SeriesRef).params, [p.id]: Number(e.target.value) } } })}
                  className={inp} />
              ))}
            </>
          ) : (
            <input type="number" aria-label="Value" value={cond.right as number}
              onChange={(e) => onChange({ ...cond, right: Number(e.target.value) })} className={inp} />
          )}
        </>
      )}

      <select value={cond.tf} aria-label="Timeframe" onChange={(e) => onChange({ ...cond, tf: e.target.value as Timeframe })} className={sel}>
        {(source?.tfs ?? TIMEFRAMES).map((tf) => <option key={tf} value={tf}>{tf}</option>)}
      </select>
    </div>
  );
}
