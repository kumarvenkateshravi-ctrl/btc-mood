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
          const def = CUSTOM_INDICATORS.find((d) => d.id === key.split('::')[0]);
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
            .join(' · ');

          // Per-plot live values, each in its own line color (TV status line).
          const showValuesInStatusLine = settings?.valuesInStatusLine ?? true;
          const plotValues = (result?.plots ?? [])
            .filter((p) => p.type !== 'band')
            .slice(0, 4)
            .map((p) => {
              const st = settings?.styles?.[p.id];
              if (st?.display === false) return null;
              const last = p.data[p.data.length - 1];
              const v =
                typeof last === 'number'
                  ? last
                  : last && typeof last === 'object' && 'value' in last
                    ? last.value
                    : null;
              if (v == null || !Number.isFinite(v)) return null;
              return {
                id: p.id,
                color: st?.color || p.color || LEGEND_ACCENT,
                text: Number(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
              };
            })
            .filter((v): v is NonNullable<typeof v> => v !== null);

          return (
            <div
              key={key}
              className={`pointer-events-auto group flex cursor-default items-center gap-2 rounded px-2 py-0 transition-colors ${isOpen ? 'bg-white/[0.08]' : 'bg-transparent hover:bg-white/[0.04]'}`}
            >
              <div className={`flex items-baseline gap-1.5 text-[12px] transition-opacity duration-200 ${hidden ? 'opacity-40' : 'opacity-100'}`}>
                {/* TV-style: the name is a quiet anchor (regular weight, muted
                    until active); the live plot values carry the colour. */}
                <span
                  className="font-normal"
                  style={{ color: isOpen ? LEGEND_ACCENT : 'var(--ink-muted, #9aa4b2)' }}
                >
                  {def.name}
                </span>
                {paramText && (
                  <span className="rounded bg-white/[0.05] px-1.5 py-px font-mono text-[10px] tabular-nums text-ink-faint">
                    {paramText}
                  </span>
                )}
                {showValuesInStatusLine && plotValues.map((pv) => (
                  <span key={pv.id} className="font-mono text-[11px] tabular-nums" style={{ color: pv.color }}>
                    {pv.text}
                  </span>
                ))}
              </div>
              <div className={`flex items-center transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <button
                  className="rounded p-0.5 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title={hidden ? 'Show' : 'Hide'}
                  onClick={() => onToggleHidden(key)}
                >
                  {hidden ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
                </button>
                <button
                  className="rounded p-0.5 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title="Settings"
                  onClick={() => onOpenSettings(key)}
                >
                  <TvSettingsIcon size={14} strokeWidth={1.75} />
                </button>
                <button
                  className="rounded p-0.5 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                  title="Remove"
                  onClick={() => onRemove(key)}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
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
        const def = CUSTOM_INDICATORS.find((d) => d.id === settingsForKey.split('::')[0]);
        if (!def) return null;
        const activeIndicatorsContext = renderResults
          .filter((r) => r.key !== settingsForKey)
          .map((r) => {
            const d = CUSTOM_INDICATORS.find((dd) => dd.id === r.key.split('::')[0]);
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
