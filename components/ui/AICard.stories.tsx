import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AICard } from './index';

// AICard — the canonical Explainable-AI Grammar (DESIGN.md §E). Confidence is
// shown ORTHOGONALLY to direction (accent ring, never bull/bear); counter-signals
// are always surfaced; evidence is ranked; an action needs risk/timestamp context.
const meta = {
  title: 'Primitives/AICard',
  component: AICard,
  tags: ['autodocs'],
  args: {
    verdict: 'Hold Position',
    confidence: 84,
    direction: 'Bullish',
    evidence: [
      { factor: 'Trend strong across 4/6 timeframes', weight: 85, direction: 'support' },
      { factor: 'Stack Score above 70', weight: 62, direction: 'support' },
      { factor: 'RSI approaching overbought', weight: 40, direction: 'oppose' },
    ],
    risk: 'Invalidated below 61,200.',
    historical: 'Setups like this resolved 72% over 45 samples.',
    sources: ['1H alignment', 'Stack Score'],
    timestamp: '14:21 UTC',
    action: { label: 'Move SL to break-even', tone: 'accent' },
  },
} satisfies Meta<typeof AICard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bullish: Story = {};

export const Bearish: Story = {
  args: { verdict: 'Reduce Exposure', direction: 'Bearish', confidence: 58, action: { label: 'Trim 25%', tone: 'bear' } },
};

export const Stale: Story = {
  args: { stale: true, confidence: 41 },
};

export const InsufficientEvidence: Story = {
  args: { evidence: [], confidence: 22, action: undefined },
};
