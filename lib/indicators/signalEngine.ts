import type { Side } from './signalTypes';

export type SlBufferMode = 'atr' | 'percent' | 'ticks';
export type ConfirmationMode = 'touch' | 'rejection_close' | 'reversal_candle';

export interface SignalEngineConfig {
  confirmation: ConfirmationMode;
  minTier: 'medium' | 'strong';
  confidenceFloor: number;
  minRR: number;
  slBufferMode: SlBufferMode;
  slBuffer: number;
  tickSize: number;
  maxBarsToTrigger: number;
  maxBarsInTrade: number;
  wZoneStrength: number;
  wConfluence: number;
  wRiskReward: number;
  wFreshness: number;
  wFormationVolume: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalEngineConfig = {
  confirmation: 'rejection_close',
  minTier: 'medium',
  confidenceFloor: 55,
  minRR: 1.5,
  slBufferMode: 'atr',
  slBuffer: 0.25,
  tickSize: 0.1,
  maxBarsToTrigger: 20,
  maxBarsInTrade: 150,
  wZoneStrength: 0.35,
  wConfluence: 0.20,
  wRiskReward: 0.20,
  wFreshness: 0.15,
  wFormationVolume: 0.10,
};

export function computeStopLoss(
  side: Side,
  zone: { upper: number; lower: number },
  entry: number,
  atr: number,
  cfg: Pick<SignalEngineConfig, 'slBufferMode' | 'slBuffer' | 'tickSize'>,
): number {
  const buffer =
    cfg.slBufferMode === 'atr'
      ? cfg.slBuffer * atr
      : cfg.slBufferMode === 'percent'
        ? (cfg.slBuffer / 100) * entry
        : cfg.slBuffer * cfg.tickSize; // 'ticks'
  return side === 'buy' ? zone.lower - buffer : zone.upper + buffer;
}
