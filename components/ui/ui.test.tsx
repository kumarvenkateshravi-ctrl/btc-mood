import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Panel, Badge, Stat, Bar, Num, KpiCard, Gauge, Ring, Sparkline, Donut, PriceCell, PnlCell, PercentCell, QtyCell, ScoreCell, TimestampCell, StatusCell, PositionRow, PositionCard, AICard, DataTable, type Column, LineChart, ChartPanel, DirectionTag, RegimeTag, RiskBadge, VolatilityTag, LiquidityTag, ConfidenceMeter } from './index';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('ui primitives render and follow the foundation', () => {
  it('Num base formats per the B5 contract with tabular numerals', () => {
    const out = html(<Num value={62764.8} precision={1} />);
    expect(out).toContain('62,764.8');
    expect(out).toContain('class="num"');
  });
  it('Num semantic variants encode their own grammar', () => {
    expect(html(<Num.Price value={109421.52} />)).toContain('$109,421.52');
    // Pnl: always signed + semantic color
    expect(html(<Num.Pnl value={1234.56} />)).toContain('text-bull-bright');
    expect(html(<Num.Pnl value={-1234.56} />)).toContain('-$1,234.56');
    expect(html(<Num.Pnl value={-1234.56} />)).toContain('text-bear-bright');
    // Pct + Delta
    expect(html(<Num.Pct value={3.82} />)).toContain('+3.82%');
    expect(html(<Num.Delta value={-1.1} percent />)).toContain('▼');
    expect(html(<Num.Delta value={-1.1} percent />)).toContain('text-bear-bright');
    // RR, Qty, Score, Compact
    expect(html(<Num.RR ratio={2.4} />)).toContain('1 : 2.4');
    expect(html(<Num.Qty value={0.18} unit="BTC" />)).toContain('BTC');
    expect(html(<Num.Score value={94} band />)).toContain('94');
    expect(html(<Num.Compact value={2.14e12} currency="USD" />)).toContain('$2.14T');
  });
  it('Panel carries the elevation class and renders its slots', () => {
    const out = html(<Panel title="Stack Score" badge="Live" n={3}>body</Panel>);
    expect(out).toContain('elev-1');
    expect(out).toContain('Stack Score');
    expect(out).toContain('Live');
    expect(out).toContain('body');
  });
  it('Badge tints by tone', () => {
    expect(html(<Badge tone="bull">Win</Badge>)).toContain('text-bull-bright');
    expect(html(<Badge tone="bear">Loss</Badge>)).toContain('text-bear-bright');
  });
  it('Stat and Bar render', () => {
    expect(html(<Stat label="Win Rate" value={<Num value={74} />} tone="bull" />)).toContain('Win Rate');
    expect(html(<Bar value={50} />)).toContain('width:50%');
  });
  it('KpiCard renders a Num value, owns the delta grammar, hero glow and a spark', () => {
    const out = html(<KpiCard label="Net Profit" value={<Num.Pnl value={18420.35} />} delta={18.42} deltaPercent deltaCaption="vs last month" hero sparkColor="var(--bull-bright)" />);
    expect(out).toContain('Net Profit');
    expect(out).toContain('+$18,420.35');
    expect(out).toContain('+18.42%');       // delta rendered via Num.Delta
    expect(out).toContain('vs last month');
    expect(out).toContain('blur-2xl');      // hero glow
    expect(out).toContain('<svg');          // spark
  });
  it('Financial Cells add domain semantics over Num', () => {
    // td by default; right-aligned price without a symbol
    const price = html(<PriceCell value={62350} />);
    expect(price).toContain('<td');
    expect(price).toContain('text-right');
    expect(price).toContain('62,350.0');
    // Pnl colored + signed
    expect(html(<PnlCell value={-540} />)).toContain('text-bear-bright');
    expect(html(<PnlCell value={770.5} />)).toContain('+$770.50');
    // Percent default signed+toned; plain disables
    expect(html(<PercentCell value={1.23} />)).toContain('text-bull-bright');
    expect(html(<PercentCell value={73.2} plain />)).not.toContain('text-bull-bright');
    // Qty unit, Score badge, Status -> tone
    expect(html(<QtyCell value={0.18} unit="BTC" />)).toContain('BTC');
    expect(html(<ScoreCell value={92} />)).toContain('92');
    expect(html(<StatusCell value="Long" />)).toContain('text-bull-bright');
    expect(html(<StatusCell value="Loss" />)).toContain('text-bear-bright');
    // Timestamp formats a date; as="div" escapes the table
    expect(html(<TimestampCell value={new Date('2025-05-31T10:00:00Z')} format="date" as="div" />)).toContain('May 31');
    expect(html(<TimestampCell value={Date.now()} as="div" />)).toContain('<div');
  });
  it('PositionRow composes the cells into one trading row', () => {
    const out = html(<table><tbody><PositionRow asset="BTC" direction="Long" entry={62350} current={63120.5} pnl={770.5} pnlPct={1.23} rr={2.6} leverage={10} holdingMin={272} health={92} action="Hold" /></tbody></table>);
    expect(out).toContain('BTCUSDT');
    expect(out).toContain('+$770.50');     // PnlCell
    expect(out).toContain('text-bull-bright'); // Long + positive
    expect(out).toContain('92');            // ScoreCell
    expect(out).toContain('Hold');          // StatusCell
    expect(out).toContain('4h 32m');        // holding 272m
  });
  it('PositionCard is pure composition of Panel + Num + Badge', () => {
    const out = html(<PositionCard asset="BTC" direction="Long" quantity={0.18} entry={104320} current={109421} pnl={8156} pnlPercent={7.82} rr={2.4} health={92} action="Hold" />);
    expect(out).toContain('elev-1');             // Panel shell
    expect(out).toContain('BTCUSDT');
    expect(out).toContain('+$8,156.00');          // Num.Pnl
    expect(out).toContain('+7.82%');              // Num.Pct
    expect(out).toContain('0.18');                // Num.Qty
    expect(out).toContain('1 : 2.4');             // Num.RR
    expect(out).toContain('text-bull-bright');    // Long badge + positive pnl
  });
  it('AICard enforces the Explainable-AI Grammar', () => {
    const out = html(<AICard
      verdict="Hold Position" confidence={84} direction="Bullish"
      evidence={[{ factor: 'Trend strong across 4/6 TFs', weight: 85, direction: 'support' }, { factor: 'RSI approaching overbought', weight: 40, direction: 'oppose' }]}
      risk="Invalidated below 61,200." historical="Setups like this resolved 72% over 45 samples."
      sources={['1H alignment', 'Stack Score']} timestamp="14:21 UTC"
    />);
    expect(out).toContain('Hold Position');         // verdict
    expect(out).toContain('Bullish');               // direction
    // confidence is accent (orthogonal to direction), NOT bull/bear
    expect(out).toContain('text-accent');
    expect(out).toContain('Strong confidence');     // band(84)
    expect(out).toContain('Evidence');
    expect(out).toContain('Counter-signals');       // contradiction surfaced
    expect(out).toContain('RSI approaching overbought');
    expect(out).toContain('Risk:');
    expect(out).toContain('Historical:');
    expect(out).toContain('as of 14:21 UTC');
  });
  it('DataTable composes Financial Cells with a sortable sticky header', () => {
    type Row = { name: string; profit: number; win: number };
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Strategy', align: 'left', cell: (r) => <td className="py-2">{r.name}</td> },
      { key: 'profit', header: 'Profit', align: 'right', sortable: true, sortValue: (r) => r.profit, cell: (r) => <PnlCell value={r.profit} /> },
      { key: 'win', header: 'Win Rate', align: 'right', sortable: true, sortValue: (r) => r.win, cell: (r) => <PercentCell value={r.win} plain /> },
    ];
    const rows: Row[] = [{ name: 'Trend', profit: 7844.5, win: 74.6 }, { name: 'Pullback', profit: 4624.32, win: 69.5 }];
    const out = html(<DataTable columns={cols} rows={rows} rowKey={(r) => r.name} />);
    expect(out).toContain('sticky');           // sticky header
    expect(out).toContain('Strategy');
    expect(out).toContain('+$7,844.50');        // PnlCell via Num
    expect(out).toContain('74.60%');            // PercentCell plain (2dp)
    expect(out).toContain('Trend');
  });
  it('DataTable renders an empty state', () => {
    const out = html(<DataTable columns={[{ key: 'a', header: 'A', cell: () => <td /> }]} rows={[]} rowKey={() => 'x'} empty="Nothing here" />);
    expect(out).toContain('Nothing here');
  });
  it('LineChart + ChartPanel render axes, series and legend', () => {
    const chart = html(<LineChart series={[{ data: [1, 3, 2, 5, 4], color: 'var(--accent)', area: true }]} xLabels={['Jan', 'Feb']} baseline />);
    expect(chart).toContain('<svg');
    expect(chart).toContain('<path');
    const panel = html(<ChartPanel title="Equity Curve" legend={[{ label: 'My Equity', color: 'var(--accent)' }]}><LineChart series={[{ data: [1, 2, 3], color: 'var(--accent)' }]} /></ChartPanel>);
    expect(panel).toContain('elev-1');
    expect(panel).toContain('Equity Curve');
    expect(panel).toContain('My Equity');
  });
  it('Market State components keep each dimension on its own channel', () => {
    expect(html(<DirectionTag direction="Bullish" />)).toContain('text-bull-bright');
    expect(html(<DirectionTag direction="Bearish" />)).toContain('text-bear-bright');
    expect(html(<RegimeTag regime="Trending" />)).toContain('Trending');
    expect(html(<RiskBadge level="High" />)).toContain('High Risk');
    expect(html(<VolatilityTag level="High" value={4.2} />)).toContain('High Vol');
    expect(html(<LiquidityTag level="Thin" />)).toContain('Thin Liquidity');
    // Confidence is accent (orthogonal to direction), never bull/bear
    expect(html(<ConfidenceMeter value={84} />)).toContain('text-accent');
    expect(html(<ConfidenceMeter value={84} />)).toContain('Strong');
  });
  it('viz primitives emit svg', () => {
    expect(html(<Gauge value={94} label="Elite" />)).toContain('<svg');
    expect(html(<Gauge value={94} label="Elite" />)).toContain('94');
    expect(html(<Ring value={73}><span>73</span></Ring>)).toContain('<svg');
    expect(html(<Sparkline data={[1, 2, 3, 4]} />)).toContain('<path');
    expect(html(<Donut slices={[{ value: 40, color: 'var(--dv-1)' }, { value: 60, color: 'var(--dv-2)' }]} />)).toContain('<svg');
  });
});
