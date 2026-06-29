// @vitest-environment jsdom
//
// Automated accessibility guard for the frozen MDS primitives (DESIGN.md §D8 +
// the Component Contract's "Accessibility (roles, ARIA, contrast)" clause). We
// render each primitive into a real DOM and run axe-core's structural rules:
// missing accessible names, invalid ARIA, sort semantics, decorative-icon
// hiding, focusable-control names, list/table structure.
//
// Notes:
//  - jsdom (not happy-dom) so axe has the DOM APIs it needs (per-file env).
//  - `color-contrast` is disabled: jsdom does not lay out / compute colors, so
//    the rule can't run. Contrast is governed separately by the OKLCH/APCA token
//    pairs in DESIGN.md §B2 and verified visually.
//  - `region` is disabled: these are component fragments, not whole pages, so
//    landmark requirements don't apply at this level.

import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import {
  Panel, Pill, FootLink, Badge, Stat, Bar, Num, KpiCard,
  Gauge, Ring, Sparkline, Donut,
  PositionRow, PositionCard, AICard, DataTable, type Column,
  LineChart, ChartPanel,
  DirectionTag, RegimeTag, RiskBadge, VolatilityTag, LiquidityTag, ConfidenceMeter,
} from './index';

const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
};

async function audit(ui: ReactElement) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(ui);
  document.body.appendChild(host);
  try {
    const { violations } = await axe.run(host, AXE_OPTIONS);
    return violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
  } finally {
    host.remove();
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MDS primitives have no axe violations', () => {
  it('Panel + Pill + FootLink', async () => {
    expect(await audit(
      <Panel title="Stack Score" badge="Live" n={3} info footer={<FootLink href="/reports">View report</FootLink>}>
        <Pill tone="accent">BTCUSDT</Pill>
      </Panel>,
    )).toEqual([]);
  });

  it('Stat / Bar / KpiCard / Num', async () => {
    expect(await audit(
      <div>
        <Stat label="Win Rate" value={<Num value={74} />} tone="bull" />
        <Bar value={50} />
        <KpiCard label="Net Profit" value={<Num.Pnl value={18420.35} />} delta={18.42} deltaPercent deltaCaption="vs last month" hero sparkColor="var(--bull-bright)" />
      </div>,
    )).toEqual([]);
  });

  it('Badge tones', async () => {
    expect(await audit(<div><Badge tone="bull">Win</Badge><Badge tone="bear">Loss</Badge></div>)).toEqual([]);
  });

  it('DataTable — sortable headers (aria-sort) + clickable rows', async () => {
    type Row = { name: string; profit: number; win: number };
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Strategy', align: 'left', cell: (r) => <td className="py-2">{r.name}</td> },
      { key: 'profit', header: 'Profit', align: 'right', sortable: true, sortValue: (r) => r.profit, cell: (r) => <td className="text-right"><Num.Pnl value={r.profit} /></td> },
      { key: 'win', header: 'Win Rate', align: 'right', sortable: true, sortValue: (r) => r.win, cell: (r) => <td className="text-right"><Num.Pct value={r.win} signed={false} /></td> },
    ];
    const rows: Row[] = [{ name: 'Trend', profit: 7844.5, win: 74.6 }, { name: 'Pullback', profit: 4624.32, win: 69.5 }];
    expect(await audit(<DataTable columns={cols} rows={rows} rowKey={(r) => r.name} onRowClick={() => {}} initialSort={{ key: 'profit', dir: 'desc' }} />)).toEqual([]);
  });

  it('PositionRow (in a table)', async () => {
    expect(await audit(
      <table><tbody>
        <PositionRow asset="BTC" direction="Long" entry={62350} current={63120.5} pnl={770.5} pnlPct={1.23} rr={2.6} leverage={10} holdingMin={272} health={92} action="Hold" />
      </tbody></table>,
    )).toEqual([]);
  });

  it('PositionCard — clickable (keyboard-reachable)', async () => {
    expect(await audit(
      <PositionCard asset="BTC" direction="Long" quantity={0.18} entry={104320} current={109421} pnl={8156} pnlPercent={7.82} rr={2.4} health={92} action="Hold" onClick={() => {}} />,
    )).toEqual([]);
  });

  it('AICard (full grammar) with action + footer buttons', async () => {
    expect(await audit(
      <AICard
        verdict="Hold Position" confidence={84} direction="Bullish"
        evidence={[{ factor: 'Trend strong across 4/6 TFs', weight: 85, direction: 'support' }, { factor: 'RSI approaching overbought', weight: 40, direction: 'oppose' }]}
        risk="Invalidated below 61,200." historical="Setups like this resolved 72% over 45 samples."
        sources={['1H alignment', 'Stack Score']} timestamp="14:21 UTC"
        action={{ label: 'Move SL to break-even', tone: 'accent' }}
        onWhy={() => {}} onWhatChanged={() => {}}
      />,
    )).toEqual([]);
  });

  it('ChartPanel + LineChart (role=img + label)', async () => {
    expect(await audit(
      <ChartPanel title="Equity Curve" legend={[{ label: 'My Equity', color: 'var(--accent)' }]}>
        <LineChart series={[{ data: [1, 3, 2, 5, 4], color: 'var(--accent)', area: true }]} xLabels={['Jan', 'Feb']} baseline ariaLabel="Equity over time" />
      </ChartPanel>,
    )).toEqual([]);
  });

  it('Market State tags + ConfidenceMeter', async () => {
    expect(await audit(
      <div>
        <DirectionTag direction="Bullish" />
        <RegimeTag regime="Trending" />
        <RiskBadge level="High" />
        <VolatilityTag level="High" value={4.2} />
        <LiquidityTag level="Thin" />
        <ConfidenceMeter value={84} />
      </div>,
    )).toEqual([]);
  });

  it('viz primitives (decorative svgs hidden from AT)', async () => {
    expect(await audit(
      <div>
        <Gauge value={94} label="Elite" />
        <Ring value={73}><span>73</span></Ring>
        <Sparkline data={[1, 2, 3, 4]} />
        <Donut slices={[{ value: 40, color: 'var(--dv-1)' }, { value: 60, color: 'var(--dv-2)' }]} />
      </div>,
    )).toEqual([]);
  });
});
