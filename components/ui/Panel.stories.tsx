import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Panel, FootLink, Num } from './index';

// Panel — the frozen card container (DESIGN.md §C-FREEZE). Every screen composes
// this; it bakes in the .elev-1 elevation recipe and the full title slot set.
const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  tags: ['autodocs'],
  args: { title: 'Stack Score', children: 'Panel body content.' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NumberedWithBadge: Story = {
  args: { n: 3, badge: 'Live', badgeTone: 'bull', subtitle: 'updated 14:21' },
};

export const Eyebrow: Story = {
  args: { eyebrow: true, title: 'Execution Readiness' },
};

export const WithFooter: Story = {
  args: { footer: <FootLink href="#">View full report</FootLink> },
};

export const Interactive: Story = {
  args: { interactive: true, title: 'Open Position', children: <Num.Pnl value={8156} className="text-2xl" /> },
};
