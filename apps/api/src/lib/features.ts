/** Feature switches. Mutable so tests can exercise a switched-off feature both ways. */
import { CUSTOM_PACKS_ENABLED } from '@choreapp/shared';
import { ApiError } from './http.js';

export const features = { customPacks: CUSTOM_PACKS_ENABLED };

/** Refusal for a switched-off feature; older apps show the Polish message as is. */
export function featureDisabled(message: string): ApiError {
  return new ApiError(403, 'feature_disabled', message);
}

export function requireCustomPacks(): void {
  if (!features.customPacks)
    throw featureDisabled('Własne paczki naklejek są wyłączone w darmowej wersji. Paczki dodane wcześniej działają dalej.');
}
