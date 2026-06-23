'use client';

import { useEffect, useState } from 'react';
import TradeHistory from './trade/TradeHistory';
import BacktestStats from './trade/BacktestStats';
import BacktestPanel from './BacktestPanel';
import AlertsPanel from './AlertsPanel';
import ConfluenceRibbon from './ConfluenceRibbon';
import TimeframeStrip from './TimeframeStrip';
import IndicatorPicker, { type ActiveIndicator } from './trade/IndicatorPicker';
import { type IndicatorDef } from '@/lib/indicatorLibrary';
import { type Candle, type Timeframe, TIMEFRAMES } from '@/lib/types';
import { type TFSnapshot } from '@/lib/signals';
import { ChevronDown } from 'lucide-react';

export default function BottomDock({
  tf,
  candles,
  activeIndicators,
  onToggleIndicator,
  onAddIndicator,
  onRemoveIndicator,
  showVolume,
  onToggleVolume,
  onToggleCollapse,
  // Confluence-tab data
  candlesByTf,
  snapshots,
  prices,
  changes,
  errors,
  selected,
  onSelectTf,
}: {
  tf: Timeframe;
  candles: Candle[];
  activeIndicators?: ActiveIndicator[];
  onToggleIndicator?: (id: string) => void;
  onAddIndicator?: (def: IndicatorDef) => void;
  onRemoveIndicator?: (id: string) => void;
  showVolume?: boolean;
  onToggleVolume?: () => void;
  onToggleCollapse?: () => void;
  candlesByTf: Record<Timeframe, Candle[]>;
  snapshots: Record<Timeframe, TFSnapshot | null>;
  prices: Record<Timeframe, number | null>;
  changes: Record<Timeframe, number | null>;
  errors: Record<Timeframe, string | null>;
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
}) {
  type TabId = 'confluence' | 'trades' | 'stats' | 'backtest' | 'alerts' | 'indicators';
  const [activeTab, setActiveTab] = useState<TabId>('confluence');

  // Restore the last-open tab (client-only, after mount to stay SSR-safe).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bottomDockTab') as TabId | null;
      if (saved && ['confluence', 'trades', 'stats', 'backtest', 'alerts', 'indicators'].includes(saved)) {
        setActiveTab(saved);
      }
    } catch {}
  }, []);

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    try {
      localStorage.setItem('bottomDockTab', id);
    } catch {}
  };

  // Live clock — ticks every second
  const [clockText, setClockText] = useState<string>('');
  useEffect(() => {
    const fmt = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const off = -now.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const absOff = Math.abs(off);
      const oh = Math.floor(absOff / 60);
      const om = absOff % 60;
      const tz = om === 0 ? `UTC${sign}${oh}` : `UTC${sign}${oh}:${String(om).padStart(2, '0')}`;
      return `${hh}:${mm}:${ss} ${tz}`;
    };
    setClockText(fmt());
    const id = setInterval(() => setClockText(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  const tabs = [
    { id: 'confluence', label: 'Confluence' },
    { id: 'trades', label: 'Trades' },
    { id: 'stats', label: 'Stats' },
    { id: 'backtest', label: 'Backtest' },
    { id: 'alerts', label: 'Alerts' },
    { id: 'indicators', label: 'Indicators' },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* Tabs Row */}
      <div className="flex shrink-0 border-b border-line px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            className={[
              'px-4 py-2 text-[14px] font-medium transition-colors border-b-2',
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
        {/* Spacer */}
        <div className="flex-1" />
        {/* Live clock */}
        {clockText && (
          <div className="flex items-center px-4 font-mono text-[13px] tabular-nums tracking-tight" style={{ color: '#4dc7d9' }}>
            {clockText}
          </div>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center px-3 text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            title="Toggle panel"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-base p-4">
        {activeTab === 'confluence' && (
          <div className="flex flex-col gap-4">
            <ConfluenceRibbon
              candlesByTf={candlesByTf}
              timeframes={TIMEFRAMES}
              selected={selected}
              snapshots={snapshots}
              onSelectTf={onSelectTf}
            />
            <TimeframeStrip
              selected={selected}
              onSelect={onSelectTf}
              prices={prices}
              changes={changes}
              snapshots={snapshots}
              errors={errors}
              timeframes={TIMEFRAMES}
            />
          </div>
        )}
        {activeTab === 'trades' && <TradeHistory />}
        {activeTab === 'stats' && <BacktestStats />}
        {activeTab === 'backtest' && <BacktestPanel tf={tf} candles={candles} />}
        {activeTab === 'alerts' && <AlertsPanel defaultTf={tf} />}
        {activeTab === 'indicators' && (
          <IndicatorPicker
            active={activeIndicators ?? []}
            onToggle={onToggleIndicator ?? (() => {})}
            onAdd={onAddIndicator ?? (() => {})}
            onRemove={onRemoveIndicator ?? (() => {})}
            onParam={() => {}} // Removed in favor of gear icon on chart
            showVolume={showVolume ?? true}
            onToggleVolume={onToggleVolume ?? (() => {})}
          />
        )}
      </div>
    </div>
  );
}
