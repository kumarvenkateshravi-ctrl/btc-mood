import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Num } from './index';

// Num — the Financial Information Language (DESIGN.md §B5-FREEZE). The ONLY legal
// way to render a financial value; semantic variants encode their own grammar.
const meta = {
  title: 'Primitives/Num',
  component: Num,
  tags: ['autodocs'],
  args: { value: 62764.8, precision: 1 },
} satisfies Meta<typeof Num>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Base: Story = {};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
    <span className="text-ink-faint">{label}</span>
    <span className="num">{children}</span>
  </div>
);

export const SemanticVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, minWidth: 280 }}>
      <Row label="Price"><Num.Price value={109421.52} /></Row>
      <Row label="Pnl +"><Num.Pnl value={1234.56} /></Row>
      <Row label="Pnl −"><Num.Pnl value={-1234.56} /></Row>
      <Row label="Pct"><Num.Pct value={3.82} /></Row>
      <Row label="Delta"><Num.Delta value={-1.1} percent /></Row>
      <Row label="R:R"><Num.RR ratio={2.4} /></Row>
      <Row label="Qty"><Num.Qty value={0.18} unit="BTC" /></Row>
      <Row label="Score"><Num.Score value={94} band /></Row>
      <Row label="Compact"><Num.Compact value={2.14e12} currency="USD" /></Row>
    </div>
  ),
};
