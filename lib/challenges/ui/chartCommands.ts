import type { ChartTradingCommands, PlaceChartOrder, TradingCommandResult } from '@/lib/chartTradingCommands';
import type { ProtectionUpdate } from '@/lib/paper';
import { challengeTrade, getActiveChallengeAttempt } from './store';

let pendingProtection: { stopLoss?: string | null; takeProfit?: string | null } = {};
const ok = <T = undefined>(value?: T): TradingCommandResult<T> => ({ status: 'accepted', mode: 'replay', value });
const fail = (reason: string): TradingCommandResult => ({ status: 'rejected', mode: 'replay', reason });
const resultOf = (result: ReturnType<typeof challengeTrade>): TradingCommandResult =>
  result.status === 'pending'
    ? { status: 'pending', mode: 'replay', reason: 'Saving Challenge action before publishing it.' }
    : fail(result.message);

function protection(input: ProtectionUpdate) {
  return {
    ...('sl' in input ? { stopLoss: input.sl == null ? null : String(input.sl) } : {}),
    ...('tp' in input ? { takeProfit: input.tp == null ? null : String(input.tp) } : {}),
    ...('trailingSl' in input ? { trailingEnabled: input.trailingSl } : {}),
  };
}
function submit(input: PlaceChartOrder): TradingCommandResult {
  const intent = input.type === 'market'
    ? { kind: 'market' as const, side: input.side, quantity: String(input.units), observedPrice: String(input.midPrice), leverage: String(input.leverage), protection: { stopLoss: input.sl == null ? null : String(input.sl), takeProfit: input.tp == null ? null : String(input.tp) } }
    : { kind: 'placeWorkingEntry' as const, side: input.side, orderType: input.type, quantity: String(input.units), triggerPrice: String(input.price ?? input.midPrice), leverage: String(input.leverage), protection: { stopLoss: input.sl == null ? null : String(input.sl), takeProfit: input.tp == null ? null : String(input.tp) }, ocoGroupId: input.ocoGroup };
  return resultOf(challengeTrade(intent));
}

export function createChallengeChartCommands(): ChartTradingCommands {
  return {
    activate() {}, dispose() {},
    openOrderTicket: () => ok(),
    submitOrder: submit,
    reverse: submit,
    close: (input) => resultOf(challengeTrade({ kind: 'closeFull', observedPrice: String(input.mark) })),
    setOverlay: (input) => resultOf(challengeTrade({ kind: 'updateProtection', update: protection({ [input.field]: input.value }) })),
    setProtection: (input) => resultOf(challengeTrade({ kind: 'updateProtection', update: protection(input.protection) })),
    partialClose: (input) => {
      const position = getActiveChallengeAttempt()?.coordinator.getSnapshot().readModel.position;
      if (!position) return fail('A partial close requires an active Challenge position.');
      const quantity = Number(position.quantity) * input.fraction;
      return resultOf(challengeTrade({ kind: 'closePartial', quantity: quantity.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''), observedPrice: String(input.mark) }));
    },
    toggleTrailing: (input) => resultOf(challengeTrade({ kind: 'updateProtection', update: { trailingEnabled: input.enabled } })),
    setReplayPendingLevels: (input) => {
      pendingProtection = { stopLoss: input.sl == null ? null : String(input.sl), takeProfit: input.tp == null ? null : String(input.tp) };
      return ok();
    },
    openReplayRisk: (input) => {
      const result = challengeTrade({ kind: 'market', side: input.side, quantity: '0.01', observedPrice: String(input.mark), leverage: '10', protection: pendingProtection });
      pendingProtection = {};
      return result.status === 'pending'
        ? { status: 'pending', mode: 'replay', reason: 'Saving Challenge action before publishing it.' }
        : { status: 'rejected', mode: 'replay', reason: result.message };
    },
  };
}
