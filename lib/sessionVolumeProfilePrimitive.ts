// Session Volume Profile renderer.
//
// Draws one horizontal histogram per session, anchored to that session's
// x-range, plus its POC / VAH / VAL levels and (optionally) the classified
// shape label. Sits at 'bottom' z-order so candles always stay readable on top.
//
// Everything it draws is supplied by the compute layer — the primitive owns
// pixels, never math.

import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type {
  VolumeProfileRender,
  VolumeProfileStyle,
} from '@/lib/indicatorFramework';
import { buildHistoricalPocIndex, pocRecordKey, selectVisibleHistoricalPocs, type HistoricalPocIndex, type HistoricalPocRecord } from '@/lib/indicators/historicalPocStore';
import { analyticalDecay } from '@/lib/chartAnalyticalPresentation';

/** Rows thinner than this collapse to a hairline rather than vanishing. */
const MIN_ROW_PX = 1;
/** Below this box width a profile is unreadable, so we skip it entirely. */
const MIN_BOX_PX = 12;
/**
 * Gap between rows, so the histogram reads as discrete price buckets instead of
 * one solid mass. Taken out of the row, never added around it — the rows must
 * still tile the session's price range exactly.
 */
const ROW_GAP_PX = 1;
/** POC carries the most weight of any level, so it draws heavier than VAH/VAL. */
const POC_WIDTH_PX = 2;
const LEVEL_WIDTH_PX = 1;
/** Dark halo under a level line, so it stays legible over bars *and* candles. */
const LEVEL_OUTLINE = 'rgba(0, 0, 0, 0.55)';

class ProfileRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: SessionVolumeProfilePrimitive,
  ) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    const { style } = this._prim;
    if (!style || (this._prim.profiles.length === 0 && this._prim.historicalPocs.length === 0)) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const paneW = scope.bitmapSize.width;
      const series = this._api.series;
      const ts = this._api.chart.timeScale();
      const visibleRange = ts.getVisibleRange();
      const range = visibleRange && typeof visibleRange.from === 'number' && typeof visibleRange.to === 'number'
        ? { from: visibleRange.from, to: visibleRange.to }
        : null;
      const profiles = this._prim.visibleProfiles(range);

      const priceToY = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : y * vpr;
      };

      for (const profile of profiles) {
        // Resolve the session box. A session scrolled partly off-screen still
        // draws: a null edge means "beyond the data", so clamp to the pane.
        // (timeToCoordinate returns a branded Coordinate, hence the widening.)
        const rawX0 = ts.timeToCoordinate(profile.startTime as Time);
        const rawX1 = ts.timeToCoordinate(profile.endTime as Time);
        if (rawX0 == null && rawX1 == null) continue;
        const x0: number = rawX0 == null ? 0 : rawX0;
        const x1: number = rawX1 == null ? paneW / hpr : rawX1;

        // During a drag, lightweight-charts still gives coordinates for data
        // fully outside the viewport. Do not spend canvas time on off-screen
        // profiles, especially when several historical POC sets are enabled.
        const visibleW = paneW / hpr;
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        if (right < 0 || left > visibleW) continue;

        const bx0 = x0 * hpr;
        const bx1 = x1 * hpr;
        const boxW = bx1 - bx0;
        const canDrawBox = boxW >= MIN_BOX_PX;

        const maxBarW = boxW * (clamp(style.widthPct, 1, 100) / 100);
        const anchorLeft = style.placement === 'left';

        if (canDrawBox && style.showProfileBoxes && profile.showRows !== false) {
          this._drawRows(ctx, profile, style, {
            bx0, bx1, maxBarW, anchorLeft, priceToY, vpr, hpr,
          });
        }

        this._drawLevels(ctx, profile, style, {
          bx0, bx1, paneW, priceToY, hpr,
        });

        if (canDrawBox && style.showShapeLabel && profile.showShapeLabel !== false && profile.shapeLabel) {
          this._drawShapeLabel(ctx, profile, style, {
            bx0, bx1, priceToY, hpr, vpr, paneH: scope.bitmapSize.height,
          });
        }
      }
    });
  }

  private _drawRows(
    ctx: CanvasRenderingContext2D,
    profile: VolumeProfileRender,
    style: VolumeProfileStyle,
    g: {
      bx0: number; bx1: number; maxBarW: number; anchorLeft: boolean;
      priceToY: (p: number) => number | null; vpr: number; hpr: number;
    },
  ) {
    const { maxRowVolume } = profile;
    if (maxRowVolume <= 0) return;

    // Delta is signed, so its scale reference is the largest absolute delta —
    // using maxRowVolume would leave every delta bar a stub.
    const deltaMax =
      style.volumeMode === 'delta'
        ? Math.max(...profile.rows.map((r) => Math.abs(r.delta)), 1e-9)
        : maxRowVolume;

    for (const row of profile.rows) {
      const yTop = g.priceToY(row.high);
      const yBot = g.priceToY(row.low);
      if (yTop == null || yBot == null) continue;

      // Shave the gap off the bottom of each row. On a zoomed-out chart rows can
      // be ~1px tall, where a gap would erase the profile — so it yields to
      // MIN_ROW_PX and the histogram degrades to solid rather than to nothing.
      const h = Math.max(MIN_ROW_PX * g.vpr, yBot - yTop - ROW_GAP_PX * g.vpr);
      const inVa = row.inValueArea;

      if (style.volumeMode === 'updown') {
        // Down segment first, then up stacked beyond it — one bar, two parts.
        const downW = (row.down / maxRowVolume) * g.maxBarW;
        const upW = (row.up / maxRowVolume) * g.maxBarW;
        this._bar(ctx, g, yTop, h, 0, downW, inVa ? style.vaDownColor : style.downColor);
        this._bar(ctx, g, yTop, h, downW, upW, inVa ? style.vaUpColor : style.upColor);
      } else if (style.volumeMode === 'delta') {
        const w = (Math.abs(row.delta) / deltaMax) * g.maxBarW;
        const positive = row.delta >= 0;
        const color = positive
          ? inVa ? style.vaUpColor : style.upColor
          : inVa ? style.vaDownColor : style.downColor;
        this._bar(ctx, g, yTop, h, 0, w, color);
      } else {
        const w = (row.total / maxRowVolume) * g.maxBarW;
        this._bar(ctx, g, yTop, h, 0, w, inVa ? style.vaUpColor : style.upColor);
      }

      if (style.showValues && row.total > 0) {
        this._rowValue(ctx, g, row.total, yTop, h);
      }
    }
  }

  /** One horizontal segment, offset `from` px along the growth direction. */
  private _bar(
    ctx: CanvasRenderingContext2D,
    g: { bx0: number; bx1: number; anchorLeft: boolean },
    yTop: number,
    h: number,
    from: number,
    width: number,
    color: string,
  ) {
    if (width <= 0) return;
    ctx.fillStyle = color;
    const x = g.anchorLeft ? g.bx0 + from : g.bx1 - from - width;
    ctx.fillRect(x, yTop, width, h);
  }

  private _rowValue(
    ctx: CanvasRenderingContext2D,
    g: { bx0: number; bx1: number; anchorLeft: boolean; maxBarW: number; hpr: number },
    value: number,
    yTop: number,
    h: number,
  ) {
    if (h < 8 * g.hpr) return; // no room to read it
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.round(9 * g.hpr)}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = g.anchorLeft ? 'left' : 'right';
    const pad = 3 * g.hpr;
    const x = g.anchorLeft ? g.bx0 + g.maxBarW + pad : g.bx1 - g.maxBarW - pad;
    ctx.fillText(formatCompact(value), x, yTop + h / 2);
    ctx.restore();
  }

  private _drawLevels(
    ctx: CanvasRenderingContext2D,
    profile: VolumeProfileRender,
    style: VolumeProfileStyle,
    g: {
      bx0: number; bx1: number; paneW: number;
      priceToY: (p: number) => number | null; hpr: number;
    },
  ) {
    const levels: {
      on: boolean; price: number; color: string; extendTo: number | null | undefined;
      width: number; outline: boolean;
    }[] = [
      { on: style.showPoc && profile.showPoc !== false, price: profile.poc, color: profile.pocColor ?? style.pocColor, extendTo: style.extendPoc ? profile.pocExtendTo : undefined, width: POC_WIDTH_PX, outline: true },
      { on: style.showVah && profile.showVah !== false, price: profile.vah, color: style.vahColor, extendTo: style.extendVah ? profile.vahExtendTo : undefined, width: LEVEL_WIDTH_PX, outline: false },
      { on: style.showVal && profile.showVal !== false, price: profile.val, color: style.valColor, extendTo: style.extendVal ? profile.valExtendTo : undefined, width: LEVEL_WIDTH_PX, outline: false },
    ];

    const ts = this._api.chart.timeScale();

    for (const lv of levels) {
      if (!lv.on) continue;
      const y = g.priceToY(lv.price);
      if (y == null) continue;

      let endX = g.bx1;
      if (lv.extendTo !== undefined) {
        // extendTo === null means "never crossed" → run to the pane edge.
        if (lv.extendTo === null) {
          endX = g.paneW;
        } else {
          const cx = ts.timeToCoordinate(lv.extendTo as Time);
          endX = cx == null ? g.paneW : cx * g.hpr;
        }
      }

      const lw = Math.max(1, Math.round(lv.width * g.hpr));
      // Odd strokes straddle a pixel centre and need the half-pixel nudge; even
      // ones sit between pixels already, and nudging them would blur the line.
      const yLine = lw % 2 === 1 ? Math.round(y) + 0.5 : Math.round(y);
      const xEnd = Math.max(endX, g.bx1);

      const stroke = (color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(g.bx0, yLine);
        ctx.lineTo(xEnd, yLine);
        ctx.stroke();
      };

      ctx.save();
      // Halo first, then the level on top of it — the POC has to survive being
      // drawn over both saturated value-area bars and candle bodies.
      if (lv.outline) stroke(LEVEL_OUTLINE, lw + 2 * Math.max(1, Math.round(g.hpr)));
      stroke(lv.color, lw);
      ctx.restore();
    }
  }

  private _drawShapeLabel(
    ctx: CanvasRenderingContext2D,
    profile: VolumeProfileRender,
    style: VolumeProfileStyle,
    g: {
      bx0: number; bx1: number; paneH: number;
      priceToY: (p: number) => number | null; hpr: number; vpr: number;
    },
  ) {
    // Anchored to the session LOW, not the high. The top of the pane carries
    // app chrome (OHLC strip, indicator legend) that the canvas can't see, so
    // a top-anchored caption collides with it unpredictably; the area under a
    // profile is reliably free.
    const y = g.priceToY(profile.low);
    if (y == null) return;

    const text =
      profile.confidence != null
        ? `${profile.shapeLabel} · ${(profile.confidence * 100).toFixed(0)}%`
        : (profile.shapeLabel as string);

    ctx.save();
    ctx.font = `${Math.round(9 * g.hpr)}px ui-sans-serif, system-ui`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';

    const padX = 4 * g.hpr;
    const padY = 2 * g.vpr;
    const w = ctx.measureText(text).width;
    const boxW = w + padX * 2;
    const boxH = 12 * g.vpr;

    // A label wider than its own session would spill across the neighbouring
    // profile and read as if it belonged to that one. Drop it instead.
    if (boxW > g.bx1 - g.bx0) {
      ctx.restore();
      return;
    }

    const bx = g.bx0 + 2 * g.hpr;
    // Sit just under the session low, and never run off the pane bottom.
    const by = Math.min(y + 4 * g.vpr, g.paneH - boxH - 2 * g.vpr);

    ctx.fillStyle = style.shapeLabelBg;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = style.shapeLabelInk;
    ctx.fillText(text, bx + padX, by + boxH - padY);
    ctx.restore();
  }
}

class ProfilePaneView implements IPrimitivePaneView {
  constructor(
    private _api: SeriesAttachedParameter<Time>,
    private _prim: SessionVolumeProfilePrimitive,
  ) {}
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer() {
    return new ProfileRenderer(this._api, this._prim);
  }
}

export class SessionVolumeProfilePrimitive implements ISeriesPrimitive {
  public profiles: VolumeProfileRender[] = [];
  public historicalPocs: HistoricalPocRecord[] = [];
  public style: VolumeProfileStyle | null = null;
  private historicalIndex: HistoricalPocIndex = { records: [] };
  private _api: SeriesAttachedParameter<Time> | null = null;

  attached(api: SeriesAttachedParameter<Time>) {
    this._api = api;
  }
  detached() {
    this._api = null;
    this.profiles = [];
    this.historicalPocs = [];
    this.historicalIndex = { records: [] };
  }
  updateAllViews() {
    this._api?.requestUpdate();
  }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    return [new ProfilePaneView(this._api, this)];
  }

  setData(profiles: VolumeProfileRender[], style: VolumeProfileStyle, historicalPocs: HistoricalPocRecord[] = []) {
    this.profiles = profiles;
    this.historicalPocs = historicalPocs;
    this.historicalIndex = buildHistoricalPocIndex(historicalPocs);
    this.style = style;
    this.updateAllViews();
  }

  visibleProfiles(range: { from: number; to: number } | null): VolumeProfileRender[] {
    if (!this.style) return this.profiles;
    const current = new Set(this.profiles.flatMap((profile) => profileRecordKey(profile)));
    const historicalRecords = selectVisibleHistoricalPocs(this.historicalIndex, range)
      .filter((record) => !current.has(pocRecordKey(record)));
    const latestEnd = Math.max(
      ...this.profiles.map((profile) => profile.endTime),
      ...historicalRecords.map((record) => record.sessionEnd),
      0,
    );
    const historical = historicalRecords.map((record) => {
      const ageDays = Math.max(0, (latestEnd - record.sessionEnd) / 86_400);
      return historicalPocProfile(record, this.style!, analyticalDecay(ageDays));
    });
    return [...this.profiles, ...historical];
  }
}

function profileRecordKey(profile: VolumeProfileRender): string[] {
  const sessionType = profile.source?.sessionTimeframe;
  if (!profile.source || (sessionType !== '4h' && sessionType !== 'daily' && sessionType !== 'weekly')) return [];
  return [pocRecordKey({
    symbol: profile.source.symbol,
    sessionType,
    sessionStart: profile.startTime,
    sessionEnd: profile.endTime,
    poc: profile.poc,
    source: profile.source,
    finalized: true,
  })];
}

function historicalPocProfile(record: HistoricalPocRecord, style: VolumeProfileStyle, presentationAlpha = 1): VolumeProfileRender {
  const pocColor = record.sessionType === 'weekly'
    ? style.weeklyPocColor
    : record.sessionType === 'daily'
      ? style.dailyPocColor
      : style.fourHourPocColor;
  return {
    startTime: record.sessionStart,
    endTime: record.sessionEnd,
    low: record.poc,
    high: record.poc,
    rows: [],
    poc: record.poc,
    vah: record.poc,
    val: record.poc,
    totalVolume: 0,
    maxRowVolume: 0,
    source: record.source,
    pocColor: withAlpha(pocColor, presentationAlpha),
    showRows: false,
    showPoc: true,
    showVah: false,
    showVal: false,
    showShapeLabel: false,
  };
}

function withAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgba) return 'rgba(' + rgba[1] + ',' + rgba[2] + ',' + rgba[3] + ',' + clamped + ')';
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamped + ')';
  }
  return color;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 12_345 → "12.3K". Keeps row labels narrow enough to sit beside the bars. */
function formatCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(a < 10 ? 2 : 0);
}
