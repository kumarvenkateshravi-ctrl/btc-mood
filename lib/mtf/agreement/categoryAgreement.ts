// M3 — Category layer agreement. Thin wrapper: CategoryResult is a Voter without
// a `weight` (→ defaults to 1), so categories vote by confidence alone. No
// category-specific logic. Spec §Layer engines.

import type { CategoryResult } from '../categoryTypes';
import type { LayerAgreement } from './agreementTypes';
import { layerAgreementOf } from './vote';

export function categoryAgreement(categories: CategoryResult[]): LayerAgreement {
  return layerAgreementOf(categories, 'category');
}
