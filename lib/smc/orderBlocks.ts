// Order block engine — creation faithful to LuxAlgo storeOrdeBlock
// (SDD.md:507-525): on a structure break, the block anchors to the bar with
// the extreme parsed low (bullish) / parsed high (bearish) in
// [pivot.barIndex .. breakBar]. Mitigation faithful to deleteOrderBlocks
// (SDD.md:481-500). Lifecycle (tested/partial/archived + touches) is the
// intelligence layer on top (spec §5) and never affects detection.

import type { Candle } from '@/lib/types';
import {
  type SmcConfig,
  type SmcEvent,
  type SmcObject,
  smcObjectId,
} from './types';
import type { VolatilityContext } from './volatility';
import type { StructureBreak } from './marketStructure';

export interface OrderBlockEngine {
  /** Newest first (Pine unshift order). */
  blocks: SmcObject[];
  /** Call AFTER structure.onBar(i); pass the breaks it returned. */
  onBar(i: number, breaks: StructureBreak[]): void;
}

/** Pine caps stored blocks per scope at 100 (SDD.md:523). */
const MAX_STORED_PER_SCOPE = 100;

export function createOrderBlockEngine(
  candles: Candle[],
  cfg: SmcConfig,
  vol: VolatilityContext,
  events: SmcEvent[],
): OrderBlockEngine {
  const blocks: SmcObject[] = [];

  function pushEvent(type: SmcEvent['type'], i: number, block: SmcObject): void {
    events.push({
      id: `${type}_${i}_${block.id}`,
      type,
      barIndex: i,
      time: candles[i].time,
      direction: block.direction,
      scope: block.scope,
      objectId: block.id,
      price: block.direction === 'bullish' ? block.bottom : block.top,
    });
  }

  function createFromBreak(i: number, brk: StructureBreak): void {
    const from = Math.max(0, Math.min(brk.pivot.barIndex, i));
    // Scan parsed extremes over [pivot.barIndex .. i] (SDD.md:513-518).
    let anchor = from;
    if (brk.direction === 'bearish') {
      let max = -Infinity;
      for (let j = from; j <= i; j++) {
        if (vol.parsedHighs[j] > max) {
          max = vol.parsedHighs[j];
          anchor = j;
        }
      }
    } else {
      let min = Infinity;
      for (let j = from; j <= i; j++) {
        if (vol.parsedLows[j] < min) {
          min = vol.parsedLows[j];
          anchor = j;
        }
      }
    }

    const top = vol.parsedHighs[anchor];
    const bottom = vol.parsedLows[anchor];
    const block: SmcObject = {
      id: smcObjectId('orderBlock', brk.scope, brk.direction, anchor),
      kind: 'orderBlock',
      scope: brk.scope,
      direction: brk.direction,
      top: Math.max(top, bottom),
      bottom: Math.min(top, bottom),
      createdAtBar: anchor,
      createdAtTime: candles[anchor].time,
      updatedAtBar: i,
      state: 'active',
      touches: 0,
      strength: 0,
      quality: 0,
      confidence: 0,
    };

    // A re-break can anchor to the same bar — keep ids unique per pass.
    if (blocks.some((b) => b.id === block.id)) return;

    const scopeCount = blocks.filter((b) => b.scope === brk.scope).length;
    if (scopeCount >= MAX_STORED_PER_SCOPE) {
      // Drop the oldest block of this scope (Pine pop from the back).
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].scope === brk.scope) {
          blocks.splice(j, 1);
          break;
        }
      }
    }
    blocks.unshift(block);
    pushEvent('OB_CREATED', i, block);
  }

  function updateLifecycles(i: number): void {
    const c = candles[i];
    for (const block of blocks) {
      if (block.state === 'mitigated' || block.state === 'invalidated' || block.state === 'archived') continue;

      // Faithful mitigation (SDD.md:487-493): bearish mitigates when the
      // source exceeds the top; bullish when it falls below the bottom.
      const bearSource = cfg.obMitigation === 'close' ? c.close : c.high;
      const bullSource = cfg.obMitigation === 'close' ? c.close : c.low;
      if (block.direction === 'bearish' && bearSource > block.top) {
        block.state = 'mitigated';
        block.updatedAtBar = i;
        pushEvent('OB_MITIGATED', i, block);
        continue;
      }
      if (block.direction === 'bullish' && bullSource < block.bottom) {
        block.state = 'mitigated';
        block.updatedAtBar = i;
        pushEvent('OB_MITIGATED', i, block);
        continue;
      }

      // Intelligence: age, touches, partial fills. Skip the creation bar.
      if (i <= block.updatedAtBar && block.touches === 0 && i === block.createdAtBar) continue;
      if (i - block.createdAtBar > cfg.maxAgeBars) {
        block.state = 'archived';
        block.updatedAtBar = i;
        continue;
      }
      const tradedInto = c.low <= block.top && c.high >= block.bottom;
      if (tradedInto && i > block.createdAtBar) {
        block.touches += 1;
        block.updatedAtBar = i;
        const closedInside = c.close <= block.top && c.close >= block.bottom;
        if (block.state === 'active') {
          block.state = 'tested';
          pushEvent('OB_TESTED', i, block);
        }
        if (closedInside && block.state === 'tested') {
          block.state = 'partial';
        }
      }
    }
  }

  function onBar(i: number, breaks: StructureBreak[]): void {
    for (const brk of breaks) createFromBreak(i, brk);
    updateLifecycles(i);
  }

  return { blocks, onBar };
}
