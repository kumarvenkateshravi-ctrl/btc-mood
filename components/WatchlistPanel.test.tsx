import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WatchlistRowView } from './WatchlistPanel';
import type { WatchlistRow } from '@/lib/hooks/useWatchlist';

const row = (over: Partial<WatchlistRow> = {}): WatchlistRow => ({
  symbol: 'BTCUSDT', label: 'BTCUSDT', last: 64602.8, chg: 618.61, chgPct: 0.97, vol: 9180, ...over,
});

describe('WatchlistRowView', () => {
  it('renders symbol, last, chg (no + sign), chg% and compact volume', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row()} active={false} onSelect={() => {}} />);
    expect(html).toContain('BTCUSDT');
    expect(html).toContain('64,602.80');
    expect(html).toContain('618.61');   // positive chg: no leading '+'
    expect(html).toContain('0.97%');    // positive pct: no leading '+'
    expect(html).toContain('9.18K');
    expect(html).toContain('text-bull-bright'); // up → green tone
  });

  it('a negative row uses the bear tone and a leading minus', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row({ symbol: 'ETHUSDT', label: 'ETHUSDT', chg: -12.56, chgPct: -0.31 })} active={false} onSelect={() => {}} />);
    expect(html).toContain('-12.56');
    expect(html).toContain('-0.31%');
    expect(html).toContain('text-bear-bright');
  });

  it('the active row carries the selected style', () => {
    const html = renderToStaticMarkup(<WatchlistRowView row={row()} active={true} onSelect={() => {}} />);
    expect(html).toContain('bg-accent/10');
    expect(html).toContain('aria-pressed="true"');
  });
});
