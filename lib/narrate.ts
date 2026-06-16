// Deterministic mood narration. Turns the already-computed signals
// (MoodVerdict + per-timeframe TFSnapshot) into plain language for the
// Casual and Analyst views. No randomness, no backend: fully testable.
// The shape is intentionally LLM-ready — a future model can replace
// `buildNarration` and return the same `Narration` object without any
// UI change.

import type { MoodVerdict, TFSnapshot } from './signals';
import type { Signal, Timeframe } from './types';

export interface NarrationFactor {
  tf: Timeframe;
  side: Signal['side'];
  /** One-line rationale, e.g. "EMA9 above EMA21 (+0.42%), RSI 58, calm". */
  text: string;
  fresh: boolean;
}

export interface Narration {
  side: 'bullish' | 'bearish' | 'neutral';
  leaning: boolean;
  /** Short, confident headline. */
  headline: string;
  /** Friendly, plain-language summary for the Casual view. */
  summary: string;
  /** Analytic one-liner naming the drivers, for the Analyst view. */
  detail: string;
  /** Per-timeframe breakdown, for the Analyst rationale panel. */
  factors: NarrationFactor[];
  /** True when there isn't enough data to read the market yet. */
  insufficient: boolean;
}

const HIGHER_TFS: Timeframe[] = ['1h', '4h', '1d'];

function displaySide(mood: MoodVerdict): { side: Narration['side']; leaning: boolean } {
  if (mood.side === 'bullish') return { side: 'bullish', leaning: false };
  if (mood.side === 'bearish') return { side: 'bearish', leaning: false };
  if (mood.bearishCount > mood.bullishCount) return { side: 'bearish', leaning: true };
  if (mood.bullishCount > mood.bearishCount) return { side: 'bullish', leaning: true };
  return { side: 'neutral', leaning: false };
}

function dominantRegime(
  snapshots: Record<Timeframe, TFSnapshot | null>,
  timeframes: Timeframe[],
): 'calm' | 'normal' | 'hot' | null {
  const counts: Record<'calm' | 'normal' | 'hot', number> = { calm: 0, normal: 0, hot: 0 };
  let any = false;
  for (const tf of timeframes) {
    const r = snapshots[tf]?.regime?.label;
    if (r) {
      counts[r] += 1;
      any = true;
    }
  }
  if (!any) return null;
  return (Object.entries(counts) as [keyof typeof counts, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0][0];
}

function fmtSigned(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function factorText(s: TFSnapshot): string {
  const parts: string[] = [];
  if (s.ema9 != null && s.ema21 != null && s.ema21 !== 0) {
    const gap = ((s.ema9 - s.ema21) / s.ema21) * 100;
    parts.push(`EMA9 ${gap >= 0 ? 'above' : 'below'} EMA21 (${fmtSigned(gap)})`);
  }
  if (s.rsi14 != null) parts.push(`RSI ${Math.round(s.rsi14)}`);
  if (s.regime) parts.push(s.regime.label);
  return parts.join(', ') || 'warming up';
}

const REGIME_PHRASE: Record<'calm' | 'normal' | 'hot', string> = {
  calm: 'volatility is calm',
  normal: 'volatility is normal',
  hot: 'volatility is running hot',
};

export function buildNarration(
  mood: MoodVerdict,
  snapshots: Record<Timeframe, TFSnapshot | null>,
  timeframes: Timeframe[],
): Narration {
  const factors: NarrationFactor[] = timeframes
    .map((tf) => {
      const s = snapshots[tf];
      if (!s) return null;
      return { tf, side: s.signal.side, text: factorText(s), fresh: s.signal.fresh };
    })
    .filter((f): f is NarrationFactor => f !== null);

  const { side, leaning } = displaySide(mood);
  const total = mood.totalCount;

  if (total === 0 || factors.length === 0) {
    return {
      side: 'neutral',
      leaning: false,
      headline: 'Reading the market',
      summary: 'Waiting for enough candles to read the mood across timeframes.',
      detail: 'Signals warm up once each timeframe has enough history.',
      factors,
      insufficient: true,
    };
  }

  const aligned =
    side === 'bullish'
      ? mood.bullishCount
      : side === 'bearish'
      ? mood.bearishCount
      : mood.neutralCount;

  // Are the higher timeframes carrying the verdict?
  const want: Signal['side'] = side === 'bullish' ? 'buy' : side === 'bearish' ? 'sell' : 'neutral';
  const higherPresent = HIGHER_TFS.map((tf) => snapshots[tf]?.signal.side).filter(
    (x): x is Signal['side'] => x != null,
  );
  const higherAgree = higherPresent.filter((s) => s === want).length;
  const higherLead = higherPresent.length > 0 && higherAgree * 2 >= higherPresent.length;

  const regime = dominantRegime(snapshots, timeframes);
  const dir = side === 'bullish' ? 'up' : side === 'bearish' ? 'down' : 'sideways';

  const headline =
    side === 'neutral'
      ? 'Mixed signals, no clear edge'
      : leaning
      ? `Leaning ${side}`
      : higherLead
      ? `${cap(side)}, and the trend is broad`
      : `${cap(side)}, but mostly on lower timeframes`;

  const leadClause =
    side === 'neutral'
      ? 'the timeframes disagree'
      : higherLead
      ? 'the higher timeframes are leading'
      : 'the move is concentrated on shorter timeframes';

  const regimeClause = regime ? `, and ${REGIME_PHRASE[regime]}` : '';

  const summary =
    side === 'neutral'
      ? `Bitcoin is moving ${dir} for now: ${aligned} of ${total} timeframes are undecided${regimeClause}. No strong edge either way.`
      : `Bitcoin is pointing ${dir}: ${aligned} of ${total} timeframes agree and ${leadClause}${regimeClause}.`;

  const detail =
    side === 'neutral'
      ? `Confluence is split (${mood.bullishCount} up / ${mood.bearishCount} down / ${mood.neutralCount} flat). Higher timeframes carry more weight in the verdict.`
      : `Weighted confluence favors ${side} (${aligned}/${total} aligned, higher timeframes weighted more); ${leadClause}${regimeClause}.`;

  return { side, leaning, headline, summary, detail, factors, insufficient: false };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
