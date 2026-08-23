import type { Candle, Timeframe } from '../types';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';

export type ProfileSourceResolution = Timeframe | '1m' | 'trade';
export type ProfileSourceTier = 'fast' | 'accurate' | 'authoritative';
export type ProfileSourceQuality = 'estimated' | 'higher-accuracy' | 'trade-level';
export type ProfileSourceCompleteness = 'complete' | 'partial' | 'unavailable';

/** Provenance carried with every profile/POC render. */
export interface ProfileSourceProvenance {
  symbol: string;
  sessionTimeframe: string;
  sourceTimeframe: ProfileSourceResolution;
  tier: ProfileSourceTier;
  quality: ProfileSourceQuality;
  completeness: ProfileSourceCompleteness;
  mode: 'live' | 'replay';
  sourceRevision: string;
  replaySessionId?: string;
  replayCutTime?: number;
  fallbackFrom?: ProfileSourceTier;
  fallbackReason?: string;
}

export interface ProfileDataSource {
  candles: Candle[];
  provenance: ProfileSourceProvenance;
}

export interface ProfileDataProvider {
  readonly source: ProfileDataSource;
  readonly provenance: ProfileSourceProvenance;
  readonly cacheIdentity: string;
}

export interface ProfileDataProviderInput {
  context: IndicatorEvaluationContext;
  sessionTimeframe?: string;
  requestedTier?: ProfileSourceTier;
  /** Reserved for the Task 3 lower-timeframe loader. */
  accurateSource?: ProfileDataSource;
  /** Reserved for a future trade-level volume source. */
  authoritativeSource?: ProfileDataSource;
}

function qualityFor(tier: ProfileSourceTier): ProfileSourceQuality {
  if (tier === 'authoritative') return 'trade-level';
  if (tier === 'accurate') return 'higher-accuracy';
  return 'estimated';
}

function isUsable(source: ProfileDataSource | undefined): source is ProfileDataSource {
  return Boolean(source && source.candles.length > 0 && source.provenance.completeness !== 'unavailable');
}

function boundToReplayCut(
  source: ProfileDataSource,
  context: IndicatorEvaluationContext,
): ProfileDataSource {
  const cutTime = context.replay?.cutTime;
  if (context.mode !== 'replay' || cutTime == null) return source;

  const candles = source.candles.filter((candle) => candle.time <= cutTime);
  const sourceWasComplete = source.provenance.completeness === 'complete';
  const completeness = candles.length === source.candles.length
    ? source.provenance.completeness
    : sourceWasComplete ? 'partial' : source.provenance.completeness;
  return {
    candles,
    provenance: { ...source.provenance, completeness, mode: 'replay', replaySessionId: context.replay?.sessionId, replayCutTime: cutTime },
  };
}

function makeFastSource(context: IndicatorEvaluationContext, sessionTimeframe: string): ProfileDataSource {
  return {
    candles: context.rawCandles,
    provenance: {
      symbol: context.symbol,
      sessionTimeframe,
      sourceTimeframe: context.timeframe,
      tier: 'fast',
      quality: 'estimated',
      completeness: context.rawCandles.length > 0 ? 'complete' : 'unavailable',
      mode: context.mode,
      sourceRevision: context.sourceRevision,
      replaySessionId: context.replay?.sessionId,
      replayCutTime: context.replay?.cutTime,
    },
  };
}

function withFallback(
  source: ProfileDataSource,
  requestedTier: ProfileSourceTier,
  reason: string,
): ProfileDataSource {
  if (requestedTier === 'fast' || source.provenance.tier !== 'fast') return source;
  return { ...source, provenance: { ...source.provenance, fallbackFrom: requestedTier, fallbackReason: reason } };
}

/**
 * Resolve the best currently available raw source. This deliberately does not
 * fetch data: Task 2 only establishes the seam for the future 1m loader.
 */
export function createProfileDataProvider(input: ProfileDataProviderInput): ProfileDataProvider {
  const requestedTier = input.requestedTier ?? (input.authoritativeSource ? 'authoritative' : input.accurateSource ? 'accurate' : 'fast');
  const sessionTimeframe = input.sessionTimeframe ?? input.context.timeframe;
  const fast = makeFastSource(input.context, sessionTimeframe);

  const candidate = requestedTier === 'authoritative' && isUsable(input.authoritativeSource)
    ? input.authoritativeSource
    : requestedTier !== 'fast' && isUsable(input.accurateSource)
      ? input.accurateSource
      : fast;
  const selected = candidate === fast
    ? withFallback(fast, requestedTier, `${requestedTier} profile source is unavailable`)
    : candidate;
  const bounded = boundToReplayCut(selected, input.context);
  const provenance: ProfileSourceProvenance = {
    ...bounded.provenance,
    symbol: input.context.symbol,
    sessionTimeframe,
    mode: input.context.mode,
    quality: bounded.provenance.quality ?? qualityFor(bounded.provenance.tier),
    sourceRevision: bounded.provenance.sourceRevision || input.context.sourceRevision,
    replaySessionId: input.context.replay?.sessionId,
    replayCutTime: input.context.replay?.cutTime,
  };
  const source = { candles: bounded.candles, provenance };
  const cacheIdentity = JSON.stringify({
    symbol: provenance.symbol,
    sessionTimeframe: provenance.sessionTimeframe,
    sourceTimeframe: provenance.sourceTimeframe,
    sourceRevision: provenance.sourceRevision,
    tier: provenance.tier,
    quality: provenance.quality,
    completeness: provenance.completeness,
    mode: provenance.mode,
    replaySessionId: provenance.replaySessionId ?? null,
    replayCutTime: provenance.replayCutTime ?? null,
    fallbackFrom: provenance.fallbackFrom ?? null,
  });
  return { source, provenance, cacheIdentity };
}

