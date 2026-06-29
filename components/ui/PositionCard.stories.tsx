import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PositionCard } from './index';

// PositionCard — the card form of a position (PositionRow is the table form).
// Pure composition over Panel + Num + Badge + Ring. Clickable variant is
// keyboard-reachable (role=button + Enter/Space) per the a11y pass.
const meta = {
  title: 'Primitives/PositionCard',
  component: PositionCard,
  tags: ['autodocs'],
  args: {
    asset: 'BTC',
    direction: 'Long',
    quantity: 0.18,
    entry: 104320,
    current: 109421,
    pnl: 8156,
    pnlPercent: 7.82,
    rr: 2.4,
    leverage: 10,
    health: 92,
    action: 'Hold',
  },
} satisfies Meta<typeof PositionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongInProfit: Story = {};

export const ShortInLoss: Story = {
  args: { direction: 'Short', current: 101200, pnl: -2240, pnlPercent: -2.15, health: 38, action: 'Exit' },
};

export const Clickable: Story = {
  args: { onClick: () => {} },
};
