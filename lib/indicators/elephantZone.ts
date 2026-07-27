// "Elephant Zone" S/R levels — a best-effort reconstruction of the "Elephant
// Zone Support & Resistance Levels" section of "Elephant Edge by AlgoBing V2".
// No Pine source exists for this indicator; this is NOT a golden-master port
// (see elephantZone.test.ts — self-consistency tests only, no reference
// output to compare against).
// Design: docs/superpowers/specs/2026-07-25-elephant-zone-design.md
//
// Model: each new UTC calendar day, anchor = the PREVIOUS day's last close
// (NOT today's open — the source chart is NIFTY, which is closed at the
// 5:30am IST / 00:00 UTC boundary the creator says zones appear at, so
// "today's open" doesn't exist yet at that moment). Four independent,
// centered reaction zones are drawn above (resistance) and below (support)
// that anchor, at each configured point offset, and held fixed until the
// next day's anchor replaces them.

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorPlot, IndicatorResult, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

export interface ElephantZoneInputs {
  level1: number;
  level2: number;
  level3: number;
  level4: number;
  /** Full width of each zone band, centered on anchor +/- level. Not present
   *  in the source panel — an invented, tunable constant (see design doc). */
  zoneWidthPoints: number;
  upperColor: string;
  lowerColor: string;
  /** Pivot centerline color. High alpha — it's a line, not a fill. */
  pivotColor: string;
}

export const ELEPHANT_ZONE_DEFAULTS: ElephantZoneInputs = {
  level1: 15, level2: 29, level3: 51, level4: 92,
  zoneWidthPoints: 6,
  // Muted amber / green: the band primitive draws borders at a fixed high alpha
  // (0.55–0.75), so a softer RGB is how we keep the zone lines from glaring.
  upperColor: 'rgba(176,124,64,1)',
  lowerColor: 'rgba(64,150,108,1)',
  pivotColor: 'rgba(99,102,241,1)', // indigo
};

const SECONDS_PER_DAY = 86400;

interface ZoneSide {
  id: 'R1' | 'R2' | 'R3' | 'R4' | 'S1' | 'S2' | 'S3' | 'S4';
  levelIdx: 0 | 1 | 2 | 3;
  sign: 1 | -1;
}

const SIDES: ZoneSide[] = [
  { id: 'R1', levelIdx: 0, sign: 1 }, { id: 'R2', levelIdx: 1, sign: 1 },
  { id: 'R3', levelIdx: 2, sign: 1 }, { id: 'R4', levelIdx: 3, sign: 1 },
  { id: 'S1', levelIdx: 0, sign: -1 }, { id: 'S2', levelIdx: 1, sign: -1 },
  { id: 'S3', levelIdx: 2, sign: -1 }, { id: 'S4', levelIdx: 3, sign: -1 },
];

export function computeElephantZone(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<ElephantZoneInputs>(config, ELEPHANT_ZONE_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const levels = [inp.level1, inp.level2, inp.level3, inp.level4];
  const half = inp.zoneWidthPoints / 2;
  const dayOf = (t: number) => Math.floor(t / SECONDS_PER_DAY);
  const dayKeys = candles.map((c) => dayOf(c.time));

  // Anchor per day-bucket = close of the last candle in the PREVIOUS bucket.
  // The first bucket in the provided history never gets an anchor (no prior day).
  const anchorForDay = new Map<number, number>();
  for (let i = 1; i < n; i++) {
    const day = dayKeys[i];
    if (dayKeys[i - 1] !== day && !anchorForDay.has(day)) {
      anchorForDay.set(day, candles[i - 1].close);
    }
  }

  const plots: IndicatorPlot[] = SIDES.map(({ id, levelIdx, sign }) => {
    const data = new Array<{ upper: number; lower: number } | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const anchor = anchorForDay.get(dayKeys[i]);
      if (anchor == null) continue;
      const center = anchor + sign * levels[levelIdx];
      data[i] = { upper: center + half, lower: center - half };
    }
    // A real zoneStyle switches the band primitive into bordered "zone mode"
    // (visible border on EVERY day + a name label on the current day). Without
    // it the band renders as a faint borderless fill (the "too light" problem).
    // Resistance is approached from below → boundary 'lower'; support from above
    // → 'upper' (the edge facing price carries the emphasis).
    return {
      id, title: id,
      color: sign === 1 ? inp.upperColor : inp.lowerColor,
      type: 'band', pane: 'overlay', data,
      zoneStyle: { boundary: sign === 1 ? 'lower' : 'upper', lineStyle: 'solid', label: id, emphasis: 0 },
    };
  });

  // Pivot as a LINE series (not a band). A band's height is measured in PRICE,
  // so a thin pivot band collapses below 1px and the primitive skips it when the
  // chart is small (that's why it "disappeared when minimized"). A line's width
  // is measured in PIXELS — a constant, always-visible 3px line at the anchor.
  // Broken at each day boundary so consecutive days don't connect diagonally.
  const pivotLine = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const anchor = anchorForDay.get(dayKeys[i]);
    if (anchor == null) continue;
    const dayEnds = i + 1 < n && dayKeys[i + 1] !== dayKeys[i];
    pivotLine[i] = dayEnds ? null : anchor;
  }
  plots.push({
    id: 'PIVOT', title: 'Pivot', color: inp.pivotColor, type: 'line', pane: 'overlay',
    data: pivotLine, lineWidth: 3,
  });

  return { plots, signals };
}
