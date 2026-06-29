import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DataTable, Cell, Num, type Column } from './index';

// DataTable — the frozen "Panel of financial information" (DESIGN.md §H-FREEZE).
// Config-driven Column<T>[]; sortable headers are keyboard-reachable with
// aria-sort, rows are keyboard-activatable (a11y pass). Rendered via `render`
// since the component is generic over the row type.
type Strategy = { name: string; profit: number; win: number; rr: number };

const columns: Column<Strategy>[] = [
  { key: 'name', header: 'Strategy', align: 'left', cell: (r) => <Cell>{r.name}</Cell> },
  { key: 'profit', header: 'Profit', align: 'right', sortable: true, sortValue: (r) => r.profit, cell: (r) => <Cell align="right"><Num.Pnl value={r.profit} /></Cell> },
  { key: 'win', header: 'Win Rate', align: 'right', sortable: true, sortValue: (r) => r.win, cell: (r) => <Cell align="right"><Num.Pct value={r.win} signed={false} /></Cell> },
  { key: 'rr', header: 'R:R', align: 'right', sortable: true, sortValue: (r) => r.rr, cell: (r) => <Cell align="right"><Num.RR ratio={r.rr} /></Cell> },
];

const rows: Strategy[] = [
  { name: 'Trend Continuation', profit: 7844.5, win: 74.6, rr: 2.6 },
  { name: 'Pullback Hunter', profit: 4624.32, win: 69.5, rr: 2.1 },
  { name: 'Breakout Hunter', profit: -1280.1, win: 58.9, rr: 1.8 },
];

const meta: Meta<typeof DataTable> = {
  title: 'Primitives/DataTable',
  component: DataTable,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Sortable: Story = {
  render: () => <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} initialSort={{ key: 'profit', dir: 'desc' }} />,
};

export const Clickable: Story = {
  render: () => <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} onRowClick={() => {}} />,
};

export const Empty: Story = {
  render: () => <DataTable columns={columns} rows={[]} rowKey={(r) => r.name} empty="No strategies yet" />,
};
