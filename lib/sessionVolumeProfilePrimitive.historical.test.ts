import { describe, expect, it } from 'vitest';
import type { VolumeProfileStyle } from './indicatorFramework';
import type { HistoricalPocRecord } from './indicators/historicalPocStore';
import { SessionVolumeProfilePrimitive } from './sessionVolumeProfilePrimitive';

const style: VolumeProfileStyle = {
  volumeMode: 'total', placement: 'left', showProfileBoxes: false, widthPct: 30, showValues: false,
  upColor: '#0f0', downColor: '#f00', vaUpColor: '#0f0', vaDownColor: '#f00',
  pocColor: '#f0b90b', weeklyPocColor: '#a855f7', dailyPocColor: '#f0b90b', fourHourPocColor: '#00bcd4',
  vahColor: '#888', valColor: '#888', showPoc: true, showVah: false, showVal: false,
  extendPoc: false, extendVah: false, extendVal: false, showShapeLabel: false,
  shapeLabelBg: '#000', shapeLabelInk: '#fff',
};

function record(start: number): HistoricalPocRecord {
  return {
    symbol: 'BTCUSDT', sessionType: '4h', sessionStart: start, sessionEnd: start + 14_400, poc: 100,
    source: {
      symbol: 'BTCUSDT', sessionTimeframe: '4h', sourceTimeframe: '5m', tier: 'fast', quality: 'estimated',
      completeness: 'complete', mode: 'live', sourceRevision: 'raw-r1',
    },
    finalized: true,
  };
}

describe('historical POC primitive rendering index', () => {
  it('returns only the visible compact POCs and keeps their lines session-contained', () => {
    const primitive = new SessionVolumeProfilePrimitive();
    const records = Array.from({ length: 2_190 }, (_, index) => record(index * 14_400));
    primitive.setData([], style, records);
    const visible = primitive.visibleProfiles({ from: 365 * 14_400, to: 367 * 14_400 });
    // Session-contained lines touching either viewport edge remain visible.
    expect(visible).toHaveLength(4);
    expect(visible.every((profile) => profile.rows.length === 0 && profile.showRows === false)).toBe(true);
    expect(visible.every((profile) => profile.pocExtendTo === undefined)).toBe(true);
    expect(visible.every((profile) => profile.endTime - profile.startTime === 14_400)).toBe(true);
  });
});
