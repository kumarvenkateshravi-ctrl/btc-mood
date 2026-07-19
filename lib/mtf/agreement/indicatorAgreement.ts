// M3 — Indicator layer agreement. Thin wrapper: IndicatorResult is already a
// Voter ({ id, verdict, confidence, weight }), so it delegates to the generic
// primitive. No indicator-specific logic. Spec §Layer engines.

import type { IndicatorResult } from '../intelligence';
import type { LayerAgreement } from './agreementTypes';
import { layerAgreementOf } from './vote';

export function indicatorAgreement(indicators: IndicatorResult[]): LayerAgreement {
  return layerAgreementOf(indicators, 'indicator');
}
