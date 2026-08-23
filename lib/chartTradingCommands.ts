import type { ProtectionUpdate, Side } from './paper';

/** The only two account owners a chart-originated command may target. */
export type ChartTradingMode = 'live' | 'replay';

export interface ChartTradingCommandContext {
  mode: ChartTradingMode;
  /** The symbol currently rendered by the chart. */
  symbol: string;
}

export interface ReplayCommandContext {
  /** The execution-timeframe bar that is already consumed by replay. */
  barIndex: number;
  /** Unix timestamp of that bar. */
  cutTime: number;
}

/** Structural copy of paperStore's input, kept pure so this boundary is easy to test. */
export interface PlaceChartOrder {
  symbol: string;
  side: Side;
  type: 'market' | 'limit' | 'stop';
  units: number;
  price: number | null;
  tp: number | null;
  sl: number | null;
  reduceOnly: boolean;
  postOnly: boolean;
  leverage: number;
  midPrice: number;
  ocoGroup?: string | null;
}

export type TradingCommandResult<T = undefined> =
  | { status: 'accepted'; mode: ChartTradingMode; value?: T }
  | { status: 'rejected'; mode: ChartTradingMode | null; reason: string }
  | { status: 'unsupported'; mode: ChartTradingMode; reason: string };

export interface LiveChartTradingOwner {
  placeOrder(input: PlaceChartOrder): { ok: boolean; error?: string };
  closePosition(mark: number, symbol: string): { ok: boolean; error?: string };
  updateProtection(symbol: string, input: ProtectionUpdate): { ok: boolean; error?: string };
  partialClose(symbol: string, fraction: number, mark: number): { ok: boolean; error?: string };
}

export interface ReplayRiskResult {
  ok: boolean;
  reason?: string;
  blocked?: string;
}

export interface ReplayChartTradingOwner {
  setActionContext(barIndex: number, cutTime: number): void;
  setPendingLevels(sl: number | null, tp: number | null): void;
  openWithRisk(side: Side, mark: number, ts: number): ReplayRiskResult;
  updateProtection(input: ProtectionUpdate): { ok: boolean; error?: string };
  close(mark: number, ts: number): { ok: boolean; error?: string };
  partialClose(fraction: number, mark: number, ts: number): { ok: boolean; error?: string };
}

export interface ChartTradingCommandOwners {
  /** Must return the current mode/symbol when a command is dispatched. */
  getContext(): ChartTradingCommandContext;
  live: LiveChartTradingOwner;
  replay: ReplayChartTradingOwner;
  /** Injectable clock keeps submission de-duplication deterministic in tests. */
  now?: () => number;
  /** Short guard window for one physical gesture / key repeat. */
  idempotencyWindowMs?: number;
}

export interface ChartTradingCommands {
  dispose(): void;
  activate(): void;
  openOrderTicket(symbol: string): TradingCommandResult;
  submitOrder(input: PlaceChartOrder): TradingCommandResult;
  reverse(input: PlaceChartOrder): TradingCommandResult;
  close(input: { symbol: string; mark: number; ts?: number; replayContext?: ReplayCommandContext }): TradingCommandResult;
  setOverlay(input: { symbol: string; field: 'tp' | 'sl'; value: number | null; replayContext?: ReplayCommandContext }): TradingCommandResult;
  setProtection(input: { symbol: string; protection: ProtectionUpdate; replayContext?: ReplayCommandContext }): TradingCommandResult;
  partialClose(input: { symbol: string; fraction: number; mark: number; ts?: number; replayContext?: ReplayCommandContext }): TradingCommandResult;
  toggleTrailing(input: { symbol: string; enabled: boolean; replayContext?: ReplayCommandContext }): TradingCommandResult;
  setReplayPendingLevels(input: { symbol: string; sl: number | null; tp: number | null; replayContext: ReplayCommandContext }): TradingCommandResult;
  openReplayRisk(input: { symbol: string; side: Side; mark: number; ts: number; replayContext: ReplayCommandContext }): TradingCommandResult<ReplayRiskResult>;
}

const unsupported = (mode: ChartTradingMode, reason: string): TradingCommandResult => ({ status: 'unsupported', mode, reason });
const accepted = <T = undefined>(mode: ChartTradingMode, value?: T): TradingCommandResult<T> => ({ status: 'accepted', mode, value });

/**
 * Single command boundary for chart trading controls.
 *
 * The context is deliberately read at dispatch time rather than captured when
 * a component renders. A queued callback from a prior live/replay render is
 * therefore either routed to the current owner or rejected for its stale
 * symbol; it can never silently target the other account.
 */
export function createChartTradingCommands(owners: ChartTradingCommandOwners): ChartTradingCommands {
  let disposed = false;
  const now = owners.now ?? Date.now;
  const idempotencyWindowMs = owners.idempotencyWindowMs ?? 500;
  const recentAccepted = new Map<string, number>();
  let lastContextIdentity: string | null = null;

  const resolve = (symbol: string): TradingCommandResult | ChartTradingCommandContext => {
    if (disposed) return { status: 'rejected', mode: null, reason: 'Trading command boundary is disposed' };
    const context = owners.getContext();
    const identity = `${context.mode}:${context.symbol}`;
    if (lastContextIdentity != null && lastContextIdentity !== identity) recentAccepted.clear();
    lastContextIdentity = identity;
    if (context.symbol !== symbol) {
      return { status: 'rejected', mode: context.mode, reason: 'Trading command targets a stale chart symbol' };
    }
    return context;
  };
  const isResult = (value: TradingCommandResult | ChartTradingCommandContext): value is TradingCommandResult => 'status' in value;
  const setReplayContext = (context: ReplayCommandContext | undefined) => {
    if (context) owners.replay.setActionContext(context.barIndex, context.cutTime);
  };
  const guard = <T = undefined>(
    context: ChartTradingCommandContext,
    command: string,
    payload: unknown,
    run: () => TradingCommandResult<T>,
  ): TradingCommandResult<T> => {
    const at = now();
    const key = `${context.mode}:${context.symbol}:${command}:${JSON.stringify(payload)}`;
    const previous = recentAccepted.get(key);
    if (previous != null && at - previous >= 0 && at - previous < idempotencyWindowMs) {
      return { status: 'rejected', mode: context.mode, reason: 'Duplicate or in-flight trading command was ignored' };
    }
    const result = run();
    if (result.status === 'accepted') recentAccepted.set(key, at);
    return result;
  };

  const executeProtection = (input: { symbol: string; protection: ProtectionUpdate; replayContext?: ReplayCommandContext }): TradingCommandResult => {
    const context = resolve(input.symbol);
    if (isResult(context)) return context;
    if (context.mode === 'live') {
      return guard(context, 'protection', input.protection, () => {
        const result = owners.live.updateProtection(input.symbol, input.protection);
        return result.ok
          ? accepted('live')
          : { status: 'rejected', mode: 'live', reason: result.error ?? 'Live protection update was rejected' };
      });
    }
    if (!input.replayContext) {
      return { status: 'rejected', mode: 'replay', reason: 'Replay protection changes require the current replay execution context' };
    }
    return guard(context, 'protection', input.protection, () => {
      setReplayContext(input.replayContext);
      const result = owners.replay.updateProtection(input.protection);
      return result.ok
        ? accepted('replay')
        : { status: 'rejected', mode: 'replay', reason: result.error ?? 'Replay protection update was rejected' };
    });
  };

  return {
    dispose() {
      disposed = true;
      recentAccepted.clear();
      lastContextIdentity = null;
    },
    activate() {
      disposed = false;
      recentAccepted.clear();
      lastContextIdentity = null;
    },
    openOrderTicket(symbol) {
      const context = resolve(symbol);
      if (isResult(context)) return context;
      return context.mode === 'live'
        ? accepted('live')
        : unsupported('replay', 'Order ticket is unavailable during replay. Use the replay session controls.');
    },
    submitOrder(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'replay') {
        return unsupported('replay', 'Limit, stop, and ticket orders are not available during replay.');
      }
      return guard(context, 'submit-order', input, () => {
        const result = owners.live.placeOrder(input);
        return result.ok
          ? accepted('live')
          : { status: 'rejected', mode: 'live', reason: result.error ?? 'Live paper order was rejected' };
      });
    },
    reverse(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'replay') {
        return unsupported('replay', 'Position reversal is not available during replay.');
      }
      return guard(context, 'reverse', input, () => {
        const result = owners.live.placeOrder(input);
        return result.ok
          ? accepted('live')
          : { status: 'rejected', mode: 'live', reason: result.error ?? 'Live paper reversal was rejected' };
      });
    },
    close(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'live') {
        return guard(context, 'close', input, () => {
          const result = owners.live.closePosition(input.mark, input.symbol);
          return result.ok
            ? accepted('live')
            : { status: 'rejected', mode: 'live', reason: result.error ?? 'No active position to close' };
        });
      }
      if (input.ts == null || !input.replayContext) {
        return { status: 'rejected', mode: 'replay', reason: 'Replay close requires the current replay execution context' };
      }
      return guard(context, 'close', input, () => {
        setReplayContext(input.replayContext);
        const result = owners.replay.close(input.mark, input.ts as number);
        return result.ok
          ? accepted('replay')
          : { status: 'rejected', mode: 'replay', reason: result.error ?? 'No active replay position to close' };
      });
    },
    setProtection(input) {
      return executeProtection(input);
    },
    setOverlay(input) {
      return executeProtection({ symbol: input.symbol, protection: { [input.field]: input.value }, replayContext: input.replayContext });
    },
    partialClose(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'live') {
        return guard(context, 'partial-close', input, () => {
          const result = owners.live.partialClose(input.symbol, input.fraction, input.mark);
          return result.ok
            ? accepted('live')
            : { status: 'rejected', mode: 'live', reason: result.error ?? 'Live partial close was rejected' };
        });
      }
      if (input.ts == null || !input.replayContext) {
        return { status: 'rejected', mode: 'replay', reason: 'Replay partial close requires the current replay execution context' };
      }
      return guard(context, 'partial-close', input, () => {
        setReplayContext(input.replayContext);
        const result = owners.replay.partialClose(input.fraction, input.mark, input.ts as number);
        return result.ok
          ? accepted('replay')
          : { status: 'rejected', mode: 'replay', reason: result.error ?? 'Replay partial close was rejected' };
      });
    },
    toggleTrailing(input) {
      return executeProtection({ symbol: input.symbol, protection: { trailingSl: input.enabled }, replayContext: input.replayContext });
    },
    setReplayPendingLevels(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'live') return unsupported('live', 'Replay pending levels are available only during replay.');
      return guard(context, 'replay-pending-levels', { sl: input.sl, tp: input.tp, replayContext: input.replayContext }, () => {
        setReplayContext(input.replayContext);
        owners.replay.setPendingLevels(input.sl, input.tp);
        return accepted('replay');
      });
    },
    openReplayRisk(input) {
      const context = resolve(input.symbol);
      if (isResult(context)) return context;
      if (context.mode === 'live') return unsupported('live', 'Replay risk entry is available only during replay.');
      return guard(context, 'replay-risk-entry', input, () => {
        setReplayContext(input.replayContext);
        const result = owners.replay.openWithRisk(input.side, input.mark, input.ts);
        if (result.ok) return accepted('replay', result);
        const reason = result.blocked === 'position-open'
          ? 'Finish the current replay position first.'
          : result.blocked === 'no-session'
            ? 'Configure the replay session before placing a practice trade.'
            : result.reason ?? 'Replay order was rejected';
        return { status: 'rejected', mode: 'replay', reason };
      });
    },
  };
}
