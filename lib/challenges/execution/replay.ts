import { normalizeDecimalText, parseScaledDecimal } from "../domain/money";
import type { ExecutionPolicy } from "../domain/types";
import { commandId } from "./policy";
import type {
  ObservePriceCommand,
  ReplayCandleInput,
  ReplayObservationSeed,
} from "./types";

export function replayCandleObservations(
  seed: ReplayObservationSeed,
  candle: ReplayCandleInput,
  executionPolicy: ExecutionPolicy,
): readonly ObservePriceCommand[] {
  const values = {
    open: normalizeDecimalText(candle.open),
    high: normalizeDecimalText(candle.high),
    low: normalizeDecimalText(candle.low),
    close: normalizeDecimalText(candle.close),
  };
  const up = parseScaledDecimal(values.close, 18) >= parseScaledDecimal(values.open, 18);
  const path = up
    ? executionPolicy.replayIntrabarPath.upCandle
    : executionPolicy.replayIntrabarPath.downCandle;
  return path.map((point, pathIndex) => ({
    kind: "observePrice" as const,
    commandId: commandId(seed.commandIdPrefix + ":" + pathIndex),
    scope: seed.scope,
    symbol: seed.symbol,
    occurredAt: seed.occurredAt,
    price: values[point],
    transition: pathIndex === 0 ? "gap" as const : "segment" as const,
    pathIndex,
  }));
}