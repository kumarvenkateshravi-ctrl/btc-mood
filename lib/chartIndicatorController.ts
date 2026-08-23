import { useMemo, useRef } from 'react';
import type { Candle, Timeframe } from './types';
import { CUSTOM_INDICATORS } from './customIndicatorsLibrary';
import { IncrementalIndicatorEngine } from './incrementalIndicatorEngine';
import type { IndicatorResult, IndicatorSettings } from './indicatorFramework';
import {
  createIndicatorEvaluationContext,
  evaluationIdentity,
  projectIndicatorResultToDisplay,
  selectIndicatorCandles,
  type IndicatorEvaluationContext,
  type IndicatorEvaluationMode,
} from './indicatorEvaluation';
import { createProfileDataProvider } from './indicators/profileDataProvider';

type IndicatorDefinition = (typeof CUSTOM_INDICATORS)[number];

export interface ChartIndicatorEvaluationInput {
  rawCandles: Candle[];
  displayCandles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  mode: IndicatorEvaluationMode;
  transform?: IndicatorEvaluationContext['transform'];
  replay?: IndicatorEvaluationContext['replay'];
  sourceRevision?: string;
  hasFormingBar?: boolean;
  provenance?: Partial<IndicatorEvaluationContext['provenance']>;
}

export interface ChartIndicatorControllerInput {
  activeIndicatorIds: string[];
  indicatorSettings: Record<string, IndicatorSettings>;
  context: IndicatorEvaluationContext;
  loading?: boolean;
}

export interface IndicatorDiagnostic {
  key: string;
  message: string;
  error: unknown;
}

export interface ChartIndicatorControllerOutput {
  evaluationContext: IndicatorEvaluationContext;
  results: Array<{ key: string; result: IndicatorResult }>;
  diagnostics: IndicatorDiagnostic[];
}

export function createChartIndicatorEvaluationContext(input: ChartIndicatorEvaluationInput): IndicatorEvaluationContext {
  const last = input.rawCandles.at(-1);
  const closed = input.rawCandles.length > 1 ? input.rawCandles.at(-2) : last;
  const sourceRevision = input.sourceRevision ?? [
    input.mode,
    input.replay?.sessionId ?? 'live',
    input.rawCandles.length,
    input.rawCandles[0]?.time ?? 0,
    last?.time ?? 0,
    closed?.open ?? 0,
    closed?.high ?? 0,
    closed?.low ?? 0,
    closed?.close ?? 0,
    closed?.volume ?? 0,
  ].join(':');
  return createIndicatorEvaluationContext({
    rawCandles: input.rawCandles,
    displayCandles: input.displayCandles,
    hasFormingBar: input.hasFormingBar,
    symbol: input.symbol,
    timeframe: input.timeframe,
    mode: input.mode,
    replay: input.replay,
    transform: input.transform,
    sourceRevision,
    provenance: {
      raw: input.provenance?.raw,
      display: input.provenance?.display ?? (input.transform === 'heikinAshi' || input.transform === 'renko' ? input.transform : 'raw'),
    },
  });
}

export function evaluateChartIndicators(
  input: ChartIndicatorControllerInput,
  engines: Map<string, IncrementalIndicatorEngine> = new Map(),
  definitions: readonly IndicatorDefinition[] = CUSTOM_INDICATORS,
): ChartIndicatorControllerOutput {
  const { context } = input;
  if (input.loading || context.displayCandles.length === 0) {
    return { evaluationContext: context, results: [], diagnostics: [] };
  }

  const computedSources: Record<string, (number | null)[]> = {};
  const results: Array<{ key: string; result: IndicatorResult }> = [];
  const diagnostics: IndicatorDiagnostic[] = [];
  const activeKeys = new Set(input.activeIndicatorIds);
  for (const key of engines.keys()) {
    if (!activeKeys.has(key)) engines.delete(key);
  }

  input.activeIndicatorIds.forEach((id) => {
    const def = definitions.find((candidate) => candidate.id === id.split('::')[0]);
    if (!def) return;

    const declaration = def.evaluation;
    const sourceCandles = declaration
      ? selectIndicatorCandles(context, declaration.sourcePolicy, declaration.finalityPolicy)
      : context.displayCandles;
    const shouldProject = sourceCandles !== context.displayCandles;
    const config = { id, settings: input.indicatorSettings[id] };
    let result: IndicatorResult;
    try {
      if (def.incremental && Object.keys(computedSources).length === 0) {
        let engine = engines.get(id);
        if (!engine) {
          engine = new IncrementalIndicatorEngine({ compute: def.compute, incremental: def.incremental });
          engines.set(id, engine);
        }
        const profileSourceIdentity = id.split('::')[0] === 'session_volume_profile'
          ? createProfileDataProvider({
              context,
              sessionTimeframe: String(input.indicatorSettings[id]?.inputs?.sessions ?? 'daily'),
            }).cacheIdentity
          : '';
        const identity = [
          evaluationIdentity(context),
          profileSourceIdentity,
          id,
          JSON.stringify(input.indicatorSettings[id] ?? {}),
        ].join('|');
        result = engine.update(sourceCandles, {
          config,
          identity,
          evaluationContext: context,
        });
      } else {
        result = def.compute(sourceCandles, config, computedSources, context);
      }
      if (shouldProject) result = projectIndicatorResultToDisplay(result, sourceCandles, context.displayCandles);
    } catch (error) {
      console.error('Indicator "' + id + '" failed to compute:', error);
      diagnostics.push({ key: id, message: `Indicator "${id}" failed to compute`, error });
      result = {
        plots: [],
        signals: Array.from({ length: context.displayCandles.length }, () => 'neutral' as const),
      };
    }
    results.push({ key: id, result });
    result.plots.forEach((plot) => {
      if (plot.type !== 'line' && plot.type !== 'histogram') return;
      computedSources[`${id}:${plot.id}`] = plot.data.map((value) => {
        if (typeof value === 'number') return value;
        if (!value) return null;
        return 'value' in value ? value.value : null;
      });
    });
  });

  return { evaluationContext: context, results, diagnostics };
}

export interface ChartIndicatorControllerHookInput {
  activeIndicatorIds: string[];
  indicatorSettings: Record<string, IndicatorSettings>;
  loading?: boolean;
  context?: IndicatorEvaluationContext;
  sources?: ChartIndicatorEvaluationInput;
}

export function useChartIndicatorController(input: ChartIndicatorControllerHookInput): ChartIndicatorControllerOutput {
  const enginesRef = useRef(new Map<string, IncrementalIndicatorEngine>());
  const context = useMemo(
    () => input.context ?? (input.sources ? createChartIndicatorEvaluationContext(input.sources) : undefined),
    [input.context, input.sources],
  );
  const runtime = useMemo(() => {
    if (!context) throw new Error('Chart indicator controller requires evaluation sources');
    return { activeIndicatorIds: input.activeIndicatorIds, indicatorSettings: input.indicatorSettings, context, loading: input.loading };
  }, [input.activeIndicatorIds, input.indicatorSettings, context, input.loading]);
  return useMemo(
    () => evaluateChartIndicators(runtime, enginesRef.current),
    [runtime],
  );
}