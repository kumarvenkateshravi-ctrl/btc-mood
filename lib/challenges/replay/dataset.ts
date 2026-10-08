import { canonicalHash, deepFreeze } from "../domain/versions";
import type { SymbolId } from "../domain/types";
import { validateReplayData } from "../../replay/validate";
import type { Candle, Timeframe } from "../../types";
import type { ChallengeReplayDataset } from "./types";

function datasetBasis(input: {
  datasetId: string;
  symbol: SymbolId;
  executionTimeframe: Timeframe;
  candles: readonly Readonly<Candle>[];
}) {
  return {
    contract: "mcs.challenge.replay-dataset/1",
    datasetId: input.datasetId,
    symbol: input.symbol,
    executionTimeframe: input.executionTimeframe,
    candles: input.candles.map((candle) => ({ ...candle })),
  };
}

export function challengeReplayDatasetHash(input: {
  datasetId: string;
  symbol: SymbolId;
  executionTimeframe: Timeframe;
  candles: readonly Readonly<Candle>[];
}): string {
  return canonicalHash(datasetBasis(input));
}

export function freezeChallengeReplayDataset(input: {
  datasetId: string;
  symbol: SymbolId;
  executionTimeframe: Timeframe;
  candles: readonly Candle[];
}): ChallengeReplayDataset {
  const validation = validateReplayData(
    input.candles.map((candle) => ({ ...candle })),
    input.executionTimeframe,
  );
  if (!validation.ok) {
    throw new RangeError(`Invalid replay dataset: ${validation.problems.join(" ")}`);
  }
  const candles = input.candles.map((candle) => ({ ...candle }));
  return deepFreeze({
    ...input,
    candles,
    datasetHash: challengeReplayDatasetHash({ ...input, candles }),
  });
}

export function verifyChallengeReplayDataset(
  dataset: ChallengeReplayDataset,
): ChallengeReplayDataset {
  if (dataset.symbol !== "BTCUSDT") {
    throw new RangeError("Challenge Replay v1 supports BTCUSDT only.");
  }
  const validation = validateReplayData(
    dataset.candles.map((candle) => ({ ...candle })),
    dataset.executionTimeframe,
  );
  if (!validation.ok) {
    throw new RangeError(`Invalid replay dataset: ${validation.problems.join(" ")}`);
  }
  const expected = challengeReplayDatasetHash(dataset);
  if (dataset.datasetHash !== expected) {
    throw new RangeError("Replay dataset content hash mismatch.");
  }
  return deepFreeze({
    ...dataset,
    candles: dataset.candles.map((candle) => ({ ...candle })),
  });
}

export function candleInstantMs(candle: Readonly<Candle>): number {
  return candle.time < 1_000_000_000_000 ? candle.time * 1000 : candle.time;
}
