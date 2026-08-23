'use client';

import SignalMatrix from './SignalMatrix';
import TradingPanel from './trade/TradingPanel';
import SignalsPanel from './trade/SignalsPanel';
import VdTradesPanel from './trade/VdTradesPanel';
import type { Timeframe } from '@/lib/types';
import type { TFSnapshot } from '@/lib/signals';
import type { CompareSymbol } from '@/lib/compare';
import type { IndicatorCell } from './SignalMatrix';
import type { SdSignal } from '@/lib/indicators/signalTypes';
import type { TradePresentationFacade } from '@/lib/trade/presentationFacade';

interface DashboardAsideProps {
  snapshots: Record<Timeframe, TFSnapshot | null>;
  timeframes: Timeframe[];
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  indicatorRows: Array<{ key: string; label: string; sub: string; cells: Record<string, IndicatorCell> }>;
  symbol: CompareSymbol;
  midPrice: number;
  tab: 'signals' | 'trade' | 'trades';
  onTabChange: (t: 'signals' | 'trade' | 'trades') => void;
  signals: SdSignal[];
  tradePresentation: TradePresentationFacade;
}

export default function DashboardAside({
  snapshots,
  timeframes,
  selected,
  onSelectTf,
  indicatorRows,
  symbol,
  midPrice,
  tab,
  onTabChange,
  signals,
  tradePresentation,
}: DashboardAsideProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex rounded-lg border border-line bg-base/40 p-0.5">
        {(['signals', 'trade', 'trades'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={[
              'flex-1 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition',
              tab === t ? 'bg-surface-2 text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            {t === 'signals' ? 'Signals' : t === 'trade' ? 'Trade' : 'Trades'}
          </button>
        ))}
      </div>

      {tab === 'signals' ? (
        <SignalMatrix
          snapshots={snapshots}
          timeframes={timeframes}
          selected={selected}
          onSelectTf={onSelectTf}
          indicatorRows={indicatorRows}
        />
      ) : tab === 'trades' ? (
        <VdTradesPanel symbol={symbol} tf={selected} midPrice={midPrice} />
      ) : (
        <>
          <TradingPanel symbol={symbol} midPrice={midPrice} presentation={tradePresentation} />
          <SignalsPanel signals={signals} />
        </>
      )}
    </div>
  );
}
