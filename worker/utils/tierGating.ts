/**
 * Tier Feature Gating Utilities
 * Reusable checks for tier-gated features in controllers.
 */

import { TierService, type TierFeatures } from '../database/services/TierService';
import { errorResponse } from '../api/responses';

export type TierFeatureKey = keyof TierFeatures;

/**
 * Check if a user has access to a specific tier feature.
 * Returns null if allowed, or an error Response if blocked.
 */
export async function checkTierFeature(
	env: Env,
	userId: string,
	feature: TierFeatureKey,
	featureLabel: string
): Promise<Response | null> {
	const tierService = new TierService(env);
	const limits = await tierService.getUserEffectiveLimits(userId);

	if (!limits.features[feature]) {
		return errorResponse(
			`Your ${limits.tierName} tier does not include ${featureLabel}. Contact an admin to upgrade your tier.`,
			403
		);
	}

	return null;
}
