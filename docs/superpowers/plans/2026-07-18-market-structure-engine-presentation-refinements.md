# Market Structure Engine — Presentation Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11 approved presentation refinements (plus the "Key Observations" rename) to the Market Structure Engine card, keeping the engine authoritative and the card a dumb renderer.

**Architecture:** Derived, cross-section, or determinism-sensitive values are added as fields on `MarketStructureSnapshot` in `lib/mtf/structureEngine.ts` (each with a unit test); the card `components/mtf/MarketStructureCard.tsx` only renders. A new shared `InfoTip` primitive lands in `components/ui`. `SNAPSHOT_VERSION` bumps `'1.0' → '1.1'`.

**Tech Stack:** TypeScript, React (client component), Tailwind (MDS tokens), Vitest, `lucide-react`, axe-core (a11y test).

## Global Constraints

- **No composite/opaque scores.** Item #12 (Structure Health Meter) is out of scope.
- **Narratives are descriptive-only.** No predictive vocabulary; the banned-vocabulary regex `/\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i` must never match any narrative `text` or `quality.summary`.
- **Engine is deterministic:** identical inputs ⇒ identical snapshot except `metadata.createdAt` and `metadata.computationTimeMs`. No UI/React/network imports in `structureEngine.ts`.
- **Card is pure display:** every number comes from the snapshot; no market logic in the component.
- **MDS conventions:** import primitives from `@/components/ui`; use design tokens (`text-bull-bright`, `text-bear-bright`, `text-neutral`, `text-ink`, `text-ink-muted`, `text-ink-faint`, `border-line`, `bg-base/40`); files begin with a short purpose comment referencing the spec.
- **Spec:** `docs/superpowers/specs/2026-07-18-market-structure-engine-presentation-refinements-design.md`.
- **Test runner:** `npx vitest run <path>` for a file; `npx vitest run <path> -t "<name>"` for one test. Typecheck: `npx tsc --noEmit`.

---

## Task 1: Engine — snapshot version bump + `qualityWord` + typed narratives

**Files:**
- Modify: `lib/mtf/structureEngine.ts`
- Test: `lib/mtf/structureEngine.test.ts`

**Interfaces:**
- Consumes: existing `StructureData`, `MarketStructureSnapshot`, `TrendWord`, `createMarketStructureSnapshot`.
- Produces:
  - `SNAPSHOT_VERSION = '1.1'`.
  - `type StructureQualityWord = 'Strong' | 'Moderate' | 'Developing'`.
  - `StructureData.qualityWord: StructureQualityWord`.
  - `type NarrativeCategory = 'Liquidity' | 'Structure' | 'FVG' | 'Premium'`.
  - `interface Narrative { category: NarrativeCategory; text: string }`.
  - `MarketStructureSnapshot.narratives: Narrative[]`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mtf/structureEngine.test.ts` inside the top-level `describe`:

```typescript
it('snapshot version is 1.1', () => {
  const ms = createMarketStructureSnapshot(input(snap()));
  expect(ms.metadata.snapshotVersion).toBe('1.1');
});

it('qualityWord maps confidence at the 70 / 45 boundaries', () => {
  const word = (institutional: number) =>
    createMarketStructureSnapshot(input(snap({ institutional }))).structure.data!.qualityWord;
  expect(word(70)).toBe('Strong');
  expect(word(69)).toBe('Moderate');
  expect(word(45)).toBe('Moderate');
  expect(word(44)).toBe('Developing');
});

it('narratives are typed { category, text }', () => {
  const ms = createMarketStructureSnapshot(input(snap()));
  expect(ms.narratives.length).toBeGreaterThan(0);
  for (const n of ms.narratives) {
    expect(['Liquidity', 'Structure', 'FVG', 'Premium']).toContain(n.category);
    expect(typeof n.text).toBe('string');
  }
});
```

Also update the two existing assertions that will now fail:
- Line ~61 `expect(ms.metadata.snapshotVersion).toBe('1.0');` → `'1.1'`.
- The banned-vocabulary test loop (currently `for (const line of [...ms.narratives, ms.quality.data?.summary ?? ''])`) → iterate text:

```typescript
const lines = [...ms.narratives.map((n) => n.text), ms.quality.data?.summary ?? ''];
for (const line of lines) {
  expect(line).not.toMatch(banned);
}
expect(ms.narratives.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mtf/structureEngine.test.ts`
Expected: FAIL — new `qualityWord`/typed-narrative assertions fail (property missing / narratives are strings), version assertion mismatches.

- [ ] **Step 3: Implement in `lib/mtf/structureEngine.ts`**

Bump the version constant:

```typescript
const SNAPSHOT_VERSION = '1.1';
```

Add the new types near `StructureData` (after `TrendWord`):

```typescript
export type StructureQualityWord = 'Strong' | 'Moderate' | 'Developing';
export type NarrativeCategory = 'Liquidity' | 'Structure' | 'FVG' | 'Premium';
export interface Narrative { category: NarrativeCategory; text: string; }

function qualityWordFor(confidence: number): StructureQualityWord {
  return confidence >= 70 ? 'Strong' : confidence >= 45 ? 'Moderate' : 'Developing';
}
```

Extend `StructureData`:

```typescript
export interface StructureData {
  trend: TrendWord;
  sequence: SwingLabel[];
  confidence: number;
  ageBars: number | null;
  qualityWord: StructureQualityWord;
}
```

Change the snapshot narratives type:

```typescript
  // in interface MarketStructureSnapshot
  narratives: Narrative[];
```

Set `qualityWord` where `structure` is built (the `established` branch):

```typescript
        data: {
          trend,
          sequence: swingSequence(events),
          confidence: smc.scores.institutional,
          ageBars: structureAgeBars(events, lastBarIndex),
          qualityWord: qualityWordFor(smc.scores.institutional),
        },
```

Convert the narrative pushes to typed objects. Replace the `const narratives: string[] = [];` block:

```typescript
  const narratives: Narrative[] = [];
  if (established && opposingSweeps > 0) {
    narratives.push({
      category: 'Liquidity',
      text: `${trend === 'bullish' ? 'Sell-side' : 'Buy-side'} liquidity has been swept while ${trend} structure remains intact.`,
    });
  }
  const obData = orderBlocks.data!;
  if (obData.bullish.created !== obData.bearish.created) {
    const [a, b] = obData.bullish.created > obData.bearish.created ? ['Bullish', 'bearish'] : ['Bearish', 'bullish'];
    narratives.push({ category: 'Structure', text: `${a} order blocks outnumber ${b} order blocks.` });
  }
  if (bullFvg.open !== bearFvg.open) {
    const [a, b] = bullFvg.open > bearFvg.open ? ['bullish', 'bearish'] : ['bearish', 'bullish'];
    narratives.push({ category: 'FVG', text: `Open ${a} fair value gaps outnumber ${b} gaps.` });
  }
  narratives.push({
    category: 'Premium',
    text: zone === 'equilibrium'
      ? 'Price currently trades near equilibrium of the dealing range.'
      : `Price currently trades inside a ${zone} zone.`,
  });
```

The empty-history return already sets `narratives: []` — leave it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mtf/structureEngine.test.ts`
Expected: PASS (all, including banned-vocabulary and empty-history).

- [ ] **Step 5: Commit**

```bash
git add lib/mtf/structureEngine.ts lib/mtf/structureEngine.test.ts
git commit -m "feat(mtf): snapshot v1.1 — qualityWord + typed narratives"
```

---

## Task 2: Engine — liquidity dominance

**Files:**
- Modify: `lib/mtf/structureEngine.ts`
- Test: `lib/mtf/structureEngine.test.ts`

**Interfaces:**
- Consumes: `LiquidityData`, `LiquiditySideData` (from Task 1 state).
- Produces:
  - `type LiquidityDominance = 'buy' | 'sell' | 'balanced'`.
  - `LiquidityData.net: number` (`buySide.active − sellSide.active`).
  - `LiquidityData.dominance: LiquidityDominance`.

- [ ] **Step 1: Write the failing test**

```typescript
it('liquidity dominance from active pools', () => {
  const lp = (direction: 'bullish' | 'bearish', state: SmcObject['state']) =>
    obj({ kind: 'liquidityPool', direction, state });
  // pool direction 'bearish' = buy-side; 'bullish' = sell-side (see engine comment)
  const buyHeavy = createMarketStructureSnapshot(input(snap({
    liquidityPools: [lp('bearish', 'active'), lp('bearish', 'active'), lp('bullish', 'active')],
  }))).liquidity.data!;
  expect(buyHeavy.net).toBe(1);
  expect(buyHeavy.dominance).toBe('buy');

  const sellHeavy = createMarketStructureSnapshot(input(snap({
    liquidityPools: [lp('bullish', 'active'), lp('bearish', 'mitigated')],
  }))).liquidity.data!;
  expect(sellHeavy.net).toBe(-1);
  expect(sellHeavy.dominance).toBe('sell');

  const balanced = createMarketStructureSnapshot(input(snap({
    liquidityPools: [lp('bullish', 'active'), lp('bearish', 'active')],
  }))).liquidity.data!;
  expect(balanced.net).toBe(0);
  expect(balanced.dominance).toBe('balanced');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/mtf/structureEngine.test.ts -t "liquidity dominance"`
Expected: FAIL — `net`/`dominance` undefined.

- [ ] **Step 3: Implement**

Add the type near `LiquidityData`:

```typescript
export type LiquidityDominance = 'buy' | 'sell' | 'balanced';
export interface LiquidityData {
  buySide: LiquiditySideData;
  sellSide: LiquiditySideData;
  net: number;
  dominance: LiquidityDominance;
}
```

Update where `liquidityData` is built:

```typescript
  const buySide = sideStats('bearish');
  const sellSide = sideStats('bullish');
  const liqNet = buySide.active - sellSide.active;
  const liquidityData: LiquidityData = {
    buySide, sellSide, net: liqNet,
    dominance: liqNet > 0 ? 'buy' : liqNet < 0 ? 'sell' : 'balanced',
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/mtf/structureEngine.test.ts -t "liquidity dominance"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mtf/structureEngine.ts lib/mtf/structureEngine.test.ts
git commit -m "feat(mtf): liquidity dominance (net + side)"
```

---

## Task 3: Engine — structure-break verdict + richer quality fields

**Files:**
- Modify: `lib/mtf/structureEngine.ts`
- Test: `lib/mtf/structureEngine.test.ts`

**Interfaces:**
- Consumes: `StructureBreaksData`, `QualityData`, `BreakCounts`, `TrendWord`, `LiquidityData.dominance` (Task 2).
- Produces:
  - `interface StructureVerdict { tone: TrendWord; text: string }`.
  - `StructureBreaksData.verdict: StructureVerdict`.
  - `QualityData.trend: TrendWord`.
  - `QualityData.liquidityBias: 'buy' | 'sell' | 'mixed'`.
  - `QualityData.recentBreaks: string`.

- [ ] **Step 1: Write the failing tests**

```typescript
it('structure-break verdict is neutral when the window is empty', () => {
  const ms = createMarketStructureSnapshot(input(snap({ events: [] })));
  expect(ms.structureBreaks.data!.verdict.tone).toBe('neutral');
  expect(ms.structureBreaks.data!.verdict.text).toBe('No BOS or CHoCH in the last 20 bars.');
  expect(ms.structureBreaks.data!.verdict.text).not.toMatch(/predict|will|likely/i);
});

it('structure-break verdict names an in-window break', () => {
  const bos = ev({ type: 'BOS', direction: 'bullish', barIndex: 99, scope: 'swing' });
  const ms = createMarketStructureSnapshot(input(snap({ events: [bos] })));
  expect(ms.structureBreaks.data!.verdict.tone).toBe('bullish');
  expect(ms.structureBreaks.data!.verdict.text).toMatch(/Bullish BOS/);
});

it('quality carries trend, liquidityBias and recentBreaks', () => {
  const ms = createMarketStructureSnapshot(input(snap({
    swingTrend: 1,
    liquidityPools: [obj({ kind: 'liquidityPool', direction: 'bearish', state: 'active' })],
  })));
  expect(ms.quality.data!.trend).toBe('bullish');
  expect(ms.quality.data!.liquidityBias).toBe('buy');
  expect(ms.quality.data!.recentBreaks).toBe('None');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mtf/structureEngine.test.ts -t "verdict"`
Expected: FAIL — `verdict` and new quality fields undefined.

- [ ] **Step 3: Implement**

Add a verdict builder above `createMarketStructureSnapshot` (after `breakCounts`):

```typescript
export interface StructureVerdict { tone: TrendWord; text: string; }

/** Descriptive one-liner for the windowed break counts. */
function structureVerdict(w: BreakCounts, windowBars: number): StructureVerdict {
  const bull = w.bullishBos + w.bullishChoch;
  const bear = w.bearishBos + w.bearishChoch;
  if (bull === 0 && bear === 0) {
    return { tone: 'neutral', text: `No BOS or CHoCH in the last ${windowBars} bars.` };
  }
  const parts: string[] = [];
  if (w.bullishBos) parts.push(`${w.bullishBos} Bullish BOS`);
  if (w.bearishBos) parts.push(`${w.bearishBos} Bearish BOS`);
  if (w.bullishChoch) parts.push(`${w.bullishChoch} Bullish CHoCH`);
  if (w.bearishChoch) parts.push(`${w.bearishChoch} Bearish CHoCH`);
  const tone: TrendWord = bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
  return { tone, text: parts.join(' · ') + ' in the last ' + windowBars + ' bars.' };
}
```

Extend the types:

```typescript
export interface StructureBreaksData {
  windowBars: number;
  window: BreakCounts;
  lifetime: BreakCounts;
  perTf: Array<{ timeframe: Timeframe } & BreakCounts>;
  verdict: StructureVerdict;
}

export interface QualityData {
  classification: StructureQuality;
  confidence: number;
  summary: string;
  trend: TrendWord;
  liquidityBias: 'buy' | 'sell' | 'mixed';
  recentBreaks: string;
}
```

In the engine, compute the window counts once so both the section and quality can reuse them. Replace the `structureBreaks` block:

```typescript
  const windowFrom = Math.max(0, lastBarIndex - cfg.structureWindowBars + 1);
  const windowCounts = breakCounts(events, windowFrom);
  const verdict = structureVerdict(windowCounts, cfg.structureWindowBars);
  const structureBreaks: Section<StructureBreaksData> = {
    state: 'ready',
    data: {
      windowBars: cfg.structureWindowBars,
      window: windowCounts,
      lifetime: breakCounts(events, 0),
      perTf: (input.perTf ?? []).map((p) => ({
        timeframe: p.timeframe,
        ...breakCounts(p.events, Math.max(0, p.barsProcessed - cfg.structureWindowBars)),
      })),
      verdict,
    },
  };
```

Extend the quality `data` object (the `established` branch):

```typescript
  const quality: Section<QualityData> = established
    ? {
        state: 'ready',
        data: {
          classification, confidence: score, summary,
          trend,
          liquidityBias: liquidityData.dominance === 'balanced' ? 'mixed' : liquidityData.dominance,
          recentBreaks: verdict.tone === 'neutral' ? 'None' : verdict.text,
        },
      }
    : { state: 'warming_up', data: null };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mtf/structureEngine.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add lib/mtf/structureEngine.ts lib/mtf/structureEngine.test.ts
git commit -m "feat(mtf): structure-break verdict + richer quality fields"
```

---

## Task 4: `InfoTip` shared primitive + glossary

**Files:**
- Create: `components/ui/InfoTip.tsx`
- Modify: `components/ui/index.ts`
- Test: `components/ui/a11y.test.tsx`

**Interfaces:**
- Produces:
  - `SMC_GLOSSARY: Record<string, string>` (keys: `'Stacked FVG'`, `'Order Block'`, `'Liquidity Sweep'`, `'Premium/Discount'`, `'BOS'`, `'CHoCH'`).
  - `InfoTip({ term, content, children, className }: { term?: keyof typeof SMC_GLOSSARY | string; content?: string; children: ReactNode; className?: string })`.
  - Barrel export: `export { InfoTip, SMC_GLOSSARY } from './InfoTip';`.

- [ ] **Step 1: Write the failing a11y test**

Add to `components/ui/a11y.test.tsx` — extend the import list with `InfoTip` and add a case:

```typescript
it('InfoTip — tooltip has role and accessible trigger', async () => {
  expect(await audit(
    <p>Watch for a <InfoTip term="Stacked FVG">Stacked FVG</InfoTip> here.</p>,
  )).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/ui/a11y.test.tsx -t "InfoTip"`
Expected: FAIL — `InfoTip` is not exported.

- [ ] **Step 3: Implement `components/ui/InfoTip.tsx`**

```tsx
'use client';

// MDS — InfoTip. Hover/focus tooltip for specialized terms. role="tooltip",
// keyboard-focusable trigger, dismiss on blur/Escape. Content comes from an
// explicit `content` prop or the SMC glossary keyed by `term`.

import { useId, useState, type ReactNode } from 'react';
import { cx } from './util';

export const SMC_GLOSSARY: Record<string, string> = {
  'Stacked FVG': 'Open Fair Value Gaps overlapping in the same direction. Multiple stacked gaps often indicate stronger imbalance.',
  'Order Block': 'The last opposing candle before an impulsive move — a zone institutions may defend on a retest.',
  'Liquidity Sweep': 'Price runs beyond a prior swing to trigger resting orders, then reverses back inside the range.',
  'Premium/Discount': 'Halves of the current dealing range. Discount is the lower half, premium the upper, split at equilibrium.',
  'BOS': 'Break of Structure — price closes beyond the prior swing in the direction of trend, confirming continuation.',
  'CHoCH': 'Change of Character — the first structural break against the prevailing trend, signalling a possible shift.',
};

export function InfoTip({
  term, content, children, className,
}: {
  term?: string;
  content?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = content ?? (term ? SMC_GLOSSARY[term] : undefined) ?? '';

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        className={cx(
          'cursor-help border-b border-dotted border-ink-faint/60 bg-transparent p-0 text-left',
          className,
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >
        {children}
      </button>
      {open && text && (
        <span
          role="tooltip"
          id={id}
          className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[11px] leading-snug text-ink-muted shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Export from the barrel**

In `components/ui/index.ts`, add after the `Badge` export line:

```typescript
export { InfoTip, SMC_GLOSSARY } from './InfoTip';
```

And add `InfoTip` to the import list in `components/ui/a11y.test.tsx`'s `from './index'` block.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/ui/a11y.test.tsx`
Expected: PASS (InfoTip case + all existing cases).

- [ ] **Step 6: Commit**

```bash
git add components/ui/InfoTip.tsx components/ui/index.ts components/ui/a11y.test.tsx
git commit -m "feat(ui): InfoTip tooltip primitive + SMC glossary"
```

---

## Task 5: Card — render all refinements

**Files:**
- Modify: `components/mtf/MarketStructureCard.tsx`

**Interfaces:**
- Consumes (from Tasks 1–4): `structure.data.qualityWord`; `liquidity.data.{net,dominance}`; `structureBreaks.data.verdict`; `quality.data.{trend,liquidityBias,recentBreaks}`; typed `narratives: Narrative[]`; `InfoTip`, `SMC_GLOSSARY` from `@/components/ui`.
- Produces: no exported types; visual refinements only.

This task is display-only. There is no unit test; it is verified live in Task 6. Apply each edit below.

- [ ] **Step 1: Add imports**

Add `InfoTip` to the `@/components/ui` import, and pull the icons from lucide:

```tsx
import { ArrowDown, ArrowUp, ArrowUpRight, ArrowDownRight, Droplet, Square } from 'lucide-react';
import { Panel, InfoTip } from '@/components/ui';
```

- [ ] **Step 2: Header summary chips (#10)**

Replace the header block's subtitle span (the `<span … >{metadata.symbol} · live SMC state…</span>`) so the title row also renders Bias / Quality / Phase chips. After the existing `<h2>`, inside the `flex items-baseline` div, replace the subtitle span with:

```tsx
          <span className="text-[11px] text-ink-faint">{metadata.symbol}</span>
          {structure.data && (
            <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', tintFor(structure.data.trend))}>
              {cap1(structure.data.trend)}
            </span>
          )}
          {structure.data && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
              {structure.data.qualityWord}
            </span>
          )}
          {phase.data && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-faint">
              {phase.data.label}
            </span>
          )}
```

Add these local helpers near the top of the file (after `trendColor`):

```tsx
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const tintFor = (t: string) =>
  t === 'bullish' ? 'bg-bull/15 text-bull-bright' : t === 'bearish' ? 'bg-bear/15 text-bear-bright' : 'bg-surface-3 text-ink-muted';
```

- [ ] **Step 3: Current Structure — distinct rows (#1)**

Replace the body of the Current Structure `SectionShell` with:

```tsx
          {structure.data && (
            <>
              <div className={cx('text-lg font-bold', trendColor(structure.data.trend))}>
                {cap1(structure.data.trend)}
              </div>
              {structure.data.sequence.length > 0 && (
                <div className="font-mono text-xs text-ink-muted">{structure.data.sequence.join(' → ')}</div>
              )}
              <div className="mt-1 border-t border-line pt-1">
                <Row k="Structure Quality" v={structure.data.qualityWord} />
                <Row k="Established" v={structure.data.ageBars != null ? `${structure.data.ageBars} bars ago` : 'Not yet'} />
                <Row k="Confidence" v={`${structure.data.confidence}%`} />
              </div>
            </>
          )}
```

- [ ] **Step 4: Liquidity dominance (#2)**

After the existing `grid grid-cols-2` block inside the Liquidity `SectionShell`, add a divider + dominance line:

```tsx
              <div className="mt-1 border-t border-line pt-1">
                <Row
                  k="Liquidity Dominance"
                  tone={liquidity.data.dominance === 'buy' ? 'text-bull-bright font-semibold'
                    : liquidity.data.dominance === 'sell' ? 'text-bear-bright font-semibold' : 'text-neutral'}
                  v={liquidity.data.dominance === 'buy' ? `Buy Side · +${liquidity.data.net}`
                    : liquidity.data.dominance === 'sell' ? `Sell Side · ${liquidity.data.net}` : 'Balanced'}
                />
              </div>
```

(The Liquidity `SectionShell` body must be wrapped so both blocks render; change `<div className="grid grid-cols-2 gap-x-3">…</div>` to `<>…<div className="mt-1 …">…</div></>`.)

- [ ] **Step 5: FVG comparison bars (#3)**

Inside the FVG divider block (the `mt-1 border-t` section), above the existing `Net FVG Bias` row, add horizontal bars for open counts:

```tsx
                {(() => {
                  const b = fvg.data.bullish.open, s = fvg.data.bearish.open;
                  const max = Math.max(b, s, 1);
                  return (
                    <div className="mb-1 space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="w-10 text-[10px] text-bull-bright">Bull {b}</span>
                        <span className="h-1.5 rounded bg-bull-bright" style={{ width: `${(b / max) * 100}%` }} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-10 text-[10px] text-bear-bright">Bear {s}</span>
                        <span className="h-1.5 rounded bg-bear-bright" style={{ width: `${(s / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })()}
```

Wrap the "Stacked" row label in the per-side map with an InfoTip:

```tsx
                    <Row k={<InfoTip term="Stacked FVG">Stacked</InfoTip>} v={s.stacked} />
```

(`Row`'s `k` is typed `string`; widen it to `React.ReactNode` — change `function Row({ k, v, tone }: { k: string; …` to `k: React.ReactNode`.)

- [ ] **Step 6: Order Blocks — distance first (#4)**

Replace the nearest-OB rows (the `Nearest Bullish` / `Nearest Bearish` map) with a two-line-per-side layout, distance primary:

```tsx
                {([['Nearest Bullish', orderBlocks.data.nearestBullish], ['Nearest Bearish', orderBlocks.data.nearestBearish]] as const).map(([label, nb]) => (
                  <div key={label} className="flex items-baseline justify-between py-0.5">
                    <span className="text-xs text-ink-faint">{label}</span>
                    {nb ? (
                      <span className="text-right">
                        <span className="font-mono text-sm font-semibold tabular-nums text-ink">{nb.distancePct}%</span>
                        <span className="ml-1 font-mono text-[10px] tabular-nums text-ink-faint">{nb.price.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                      </span>
                    ) : <span className="text-xs text-ink-faint">—</span>}
                  </div>
                ))}
```

Wrap the "Bullish"/"Bearish" side labels' first occurrence with an `InfoTip term="Order Block"` on the section title is optional; at minimum wrap the section title text. Replace the `SectionShell title="Order Blocks"` usage's rendered heading is internal — instead wrap a term inside: change the per-side label line `<div className={['mb-0.5 …', tone].join(' ')}>{label}</div>` is fine; add the tooltip at the section by leaving title as-is. (No InfoTip required here; OB tooltip is covered in Latest Events.)

- [ ] **Step 7: Market Structure verdict (#5)**

At the top of the Market Structure `SectionShell` body (before the `grid grid-cols-2`), add:

```tsx
              <div className={cx('mb-1 text-xs', trendColor(structureBreaks.data.verdict.tone))}>
                {structureBreaks.data.verdict.text}
              </div>
```

Wrap the "Bullish BOS" / "Bullish CHoCH" labels with InfoTips:

```tsx
                  <Row k={<InfoTip term="BOS">Bullish BOS</InfoTip>} v={structureBreaks.data.window.bullishBos} tone="text-bull-bright" />
                  <Row k={<InfoTip term="CHoCH">Bullish CHoCH</InfoTip>} v={structureBreaks.data.window.bullishChoch} tone="text-bull-bright" />
```

- [ ] **Step 8: Premium/Discount teaching line (#6)**

After the description `<p>` in the Premium/Discount `SectionShell`, add a constant preference line, with an InfoTip on the zone name:

```tsx
              <div className="mt-1 border-t border-line pt-1 text-[10px] text-ink-faint">
                <InfoTip term="Premium/Discount">Typical institutional preference</InfoTip>
                <div className="mt-0.5 text-ink-muted">Longs → Discount · Shorts → Premium</div>
              </div>
```

- [ ] **Step 9: Latest Events icons (#7)**

Add an icon map near the top of the file:

```tsx
function eventIcon(type: string, direction: string) {
  const cls = trendColor(direction) + ' h-3 w-3 shrink-0';
  switch (type) {
    case 'LIQUIDITY_SWEEP': return <Droplet className={cls} />;
    case 'CHOCH': return direction === 'bullish' ? <ArrowUpRight className={cls} /> : <ArrowDownRight className={cls} />;
    case 'BOS': return direction === 'bullish' ? <ArrowUp className={cls} /> : <ArrowDown className={cls} />;
    case 'FVG_CREATED': return <Square className={cls} />;
    case 'OB_CREATED': return <Square className={cls} />;
    default: return <Square className={cls} />;
  }
}
```

In the timeline map, prepend the icon to the label span:

```tsx
                  <span className={cx('flex items-center gap-1 text-xs', trendColor(item.direction))}>
                    {eventIcon(item.eventType, item.direction)} {item.label}
                  </span>
```

- [ ] **Step 10: Structure Quality expanded rows (#8)**

Replace the Structure Quality `SectionShell` body with:

```tsx
          {quality.data && (
            <>
              <div className={cx('text-lg font-bold',
                quality.data.classification === 'Excellent' || quality.data.classification === 'Strong' ? 'text-bull-bright'
                : quality.data.classification === 'Moderate' ? 'text-regime-hot' : 'text-bear-bright')}>
                {quality.data.classification}
              </div>
              <div className="mt-1 border-t border-line pt-1">
                <Row k="Confluence" v={`${quality.data.confidence}%`} />
                <Row k="Trend" v={cap1(quality.data.trend)} tone={trendColor(quality.data.trend)} />
                <Row k="Liquidity" v={cap1(quality.data.liquidityBias)} />
                <Row k="Recent Breaks" v={quality.data.recentBreaks} />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">{quality.data.summary}</p>
            </>
          )}
```

- [ ] **Step 11: Key Observations — grouped narratives (#9 + rename)**

Replace the Narratives `SectionShell` with a grouped renderer:

```tsx
        {/* Key Observations */}
        <SectionShell title="Key Observations" section={{ state: narratives.length > 0 ? 'ready' : 'warming_up', data: narratives }}>
          <div className="space-y-1.5">
            {(['Structure', 'Liquidity', 'FVG', 'Premium'] as const).map((category) => {
              const lines = narratives.filter((n) => n.category === category);
              if (lines.length === 0) return null;
              return (
                <div key={category}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{category}</div>
                  <ul className="space-y-0.5 text-[11px] leading-snug text-ink-muted">
                    {lines.map((n) => <li key={n.text}>· {n.text}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </SectionShell>
```

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Fix any token/typing issues — e.g. `Row`'s `k` widened to `React.ReactNode`.)

- [ ] **Step 13: Commit**

```bash
git add components/mtf/MarketStructureCard.tsx
git commit -m "feat(mtf): Market Structure card presentation refinements"
```

---

## Task 6: Full verification + graph update

**Files:** none (verification only).

- [ ] **Step 1: Run the full engine + ui suites**

Run: `npx vitest run lib/mtf/structureEngine.test.ts components/ui/a11y.test.tsx`
Expected: PASS.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Live-verify the card**

Use the `run` skill (or the existing dev server) to open the Custom MTF page with the Market Structure Engine card. Confirm, against BTCUSDT:
- Header shows Bias / Quality / Phase chips.
- Current Structure shows separate Structure Quality / Established / Confidence rows.
- Liquidity shows a Dominance line.
- FVG shows the bullish/bearish comparison bars.
- Order Blocks show distance % as the primary value.
- Market Structure shows the verdict line.
- Premium/Discount shows the institutional-preference line.
- Latest Events show per-type icons.
- Structure Quality shows Confluence/Trend/Liquidity/Recent Breaks rows.
- The card titled "Key Observations" groups statements by category.
- Hovering/focusing a dotted term (e.g. "Stacked") shows a tooltip.

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`
Expected: AST-only refresh, no API cost.

- [ ] **Step 5: Final commit (if graph changed)**

```bash
git add graphify-out
git commit -m "chore: graphify update after MTF presentation refinements"
```

---

## Self-Review Notes

- **Spec coverage:** #1 (Task 1/5 step 3), #2 (Task 2/5 step 4), #3 (Task 5 step 5), #4 (Task 5 step 6), #5 (Task 3/5 step 7), #6 (Task 5 step 8), #7 (Task 5 step 9), #8 (Task 3/5 step 10), #9 + rename (Task 1/5 step 11), #10 (Task 5 step 2), #11 InfoTip (Task 4, applied throughout Task 5). Version bump (Task 1). #12 deferred per spec.
- **Type consistency:** `qualityWord` / `StructureQualityWord`, `dominance`/`net`, `verdict`/`StructureVerdict`, `Narrative`/`NarrativeCategory`, `InfoTip`/`SMC_GLOSSARY` names are used identically across engine, card, and tests. `Row`'s `k` prop is widened to `React.ReactNode` in Task 5 step 5 before InfoTips are passed to it.
- **Banned vocabulary:** verdict/teaching strings are descriptive; covered by the existing banned-vocabulary test (now over `n.text`).
