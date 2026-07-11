// Premium / equilibrium / discount zones — faithful band geometry from
// drawPremiumDiscountZones (SDD.md:755-761), computed off the trailing swing
// extremes. Which zone price occupies is the intelligence classification:
// above the equilibrium band is premium side, below it discount side.

import type { SmcObject, ZoneName } from './types';
import type { TrailingExtremes } from './marketStructure';

export interface ZoneSnapshot {
  zone: ZoneName;
  premium: SmcObject;
  equilibrium: SmcObject;
  discount: SmcObject;
}

function zoneObject(
  name: ZoneName,
  direction: SmcObject['direction'],
  top: number,
  bottom: number,
  trailing: TrailingExtremes,
  barIndex: number,
  barTime: number,
): SmcObject {
  return {
    // Zone ids carry the zone name (three zones share bar + kind, so the
    // generic kind/scope/direction id would collide).
    id: `zone_${name}_${trailing.barIndex}`,
    kind: 'zone',
    direction,
    top,
    bottom,
    createdAtBar: trailing.barIndex,
    createdAtTime: trailing.barTime,
    updatedAtBar: barIndex,
    state: 'active',
    touches: 0,
    strength: 0,
    quality: 0,
    confidence: 0,
  };
}

export function computeZones(
  trailing: TrailingExtremes,
  close: number,
  barIndex: number,
  barTime: number,
): ZoneSnapshot {
  const { top, bottom } = trailing;

  // SDD.md:756-761 factors.
  const premium = zoneObject('premium', 'bearish', top, 0.95 * top + 0.05 * bottom, trailing, barIndex, barTime);
  const equilibrium = zoneObject(
    'equilibrium',
    'bearish',
    0.525 * top + 0.475 * bottom,
    0.525 * bottom + 0.475 * top,
    trailing,
    barIndex,
    barTime,
  );
  const discount = zoneObject('discount', 'bullish', 0.95 * bottom + 0.05 * top, bottom, trailing, barIndex, barTime);

  const zone: ZoneName =
    close > equilibrium.top ? 'premium' : close < equilibrium.bottom ? 'discount' : 'equilibrium';

  return { zone, premium, equilibrium, discount };
}
