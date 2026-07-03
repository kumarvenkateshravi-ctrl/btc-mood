import { Eye, EyeOff, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import IndicatorSettingsModal from '../trade/IndicatorSettingsModal';
import type { IndicatorRender } from './types';
import { TvSettingsIcon } from './TvSettingsIcon';

/** Accent color for the open/active indicator legend row (TradingView blue).
 *  Behaviour-preserving: the original Chart.tsx hardcoded this across all themes. */
const LEGEND_ACCENT = '#2962FF';

interface ChartLegendProps {
  legendKeys: string[];
  renderResults: IndicatorRender[];
  indicatorSettingsMap?: Record<string, IndicatorSettings>;
  hiddenKeys: Set<string>;
  settingsForKey: string | null;
  isLegendExpanded: boolean;
  onToggleHidden: (key: string) => void;
  onOpenSettings: (key: string) => void;
  onRemove: (key: string) => void;
  onToggleExpand: () => void;
  onCloseSettings: () => void;
  onSaveSettings: (key: string, settings: IndicatorSettings) => void;
}

export function ChartLegend({
  legendKeys,
  renderResults,
  indicatorSettingsMap,
  hiddenKeys,
  settingsForKey,
  isLegendExpanded,
  onToggleHidden,
  onOpenSettings,
  onRemove,
  onToggleExpand,
  onCloseSettings,
  onSaveSettings,
}: ChartLegendProps) {
  if (legendKeys.length === 0) return null;
  const resultByKey = new Map(renderResults.map((r) => [r.key, r.result] as const));

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-[60px] z-10 flex flex-col gap-0">
        {isLegendExpanded && legendKeys.map((key) => {
          const def = CUSTOM_INDICATORS.find((d) => d.id === key);
          if (!def) return null;
          const result = resultByKey.get(key);
          const settings = indicatorSettingsMap?.[key];
          const hidden = hiddenKeys.has(key);
          const isOpen = settingsForKey === key;

          const inputs = settings?.inputs ?? {};
          const paramText = (def.inputs ?? [])
            .filter((inp) => inp.type === 'number')
            .map((inp) => inputs[inp.id] ?? inp.default)
            .slice(0, 4)
            .join(' ');

          let latestValue: number | null = null;
          let valueColor = LEGEND_ACCENT;
          const plot = result?.plots?.[0];
          if (plot && plot.data.length) {
            const last = plot.data[plot.data.length - 1];
            if (typeof last === 'number') latestValue = last;
            else if (last && typeof last === 'object' && 'value' in last) latestValue = last.value;
            valueColor = settings?.styles?.[plot.id]?.color || plot.color || valueColor;
          }
          const displayValue =
            latestValue != null
              ? Number(latestValue).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })
              : '';
          const showValuesInStatusLine = settings?.valuesInStatusLine ?? true;

          return (
            <div
              key={key}
              className={`pointer-events-auto group flex cursor-default items-center gap-2 rounded px-2 py-0 transition-colors ${isOpen ? 'bg-white/[0.08]' : 'bg-transparent hover:bg-white/[0.04]'}`}
            >
              <div className={`flex items-baseline gap-1.5 text-[13px] transition-opacity duration-200 ${hidden ? 'opacity-40' : 'opacity-100'}`}>
                <span className="font-medium" style={{ color: isOpen ? LEGEND_ACCENT : undefined }}>{def.name}</span>
                {paramText && <span className="text-ink-muted">{paramText}</span>}
                {displayValue && showValuesInStatusLine && <span style={{ color: valueColor }}>{displayValue}</span>}
              </div>
              <div className={`flex items-center transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <button
                  className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title={hidden ? 'Show' : 'Hide'}
                  onClick={() => onToggleHidden(key)}
                >
                  {hidden ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
                </button>
                <button
                  className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title="Settings"
                  onClick={() => onOpenSettings(key)}
                >
                  <TvSettingsIcon size={18} strokeWidth={1.5} />
                </button>
                <button
                  className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title="Remove"
                  onClick={() => onRemove(key)}
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          );
        })}
        <div className="pointer-events-auto mt-0.5 flex">
          <button
            className="flex h-[20px] w-[20px] items-center justify-center rounded border border-line bg-surface-1/80 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            title={isLegendExpanded ? 'Hide indicator legend' : 'Show indicator legend'}
            onClick={onToggleExpand}
          >
            {isLegendExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {settingsForKey && (() => {
        const def = CUSTOM_INDICATORS.find((d) => d.id === settingsForKey);
        if (!def) return null;
        const activeIndicatorsContext = renderResults
          .filter((r) => r.key !== settingsForKey)
          .map((r) => {
            const d = CUSTOM_INDICATORS.find((dd) => dd.id === r.key);
            return {
              id: r.key,
              name: d?.name || r.key,
              plots: r.result.plots.filter((p) => p.type === 'line' || p.type === 'histogram').map((p) => ({ id: p.id, title: p.title })),
            };
          })
          .filter((ctx) => ctx.plots.length > 0);

        return (
          <IndicatorSettingsModal
            indicatorDef={def}
            initialSettings={indicatorSettingsMap?.[settingsForKey]}
            activeIndicatorsContext={activeIndicatorsContext}
            onClose={onCloseSettings}
            onSave={(settings) => onSaveSettings(settingsForKey, settings)}
          />
        );
      })()}
    </>
  );
}
