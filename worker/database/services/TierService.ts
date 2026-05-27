/**
 * Tier Service - Manages tiers, per-user overrides, and effective limit resolution
 */

import { eq, and, count, isNull } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';

/** Feature flags stored as JSON in tiers.features */
export interface TierFeatures {
	canDeploy: boolean;
	canExportGithub: boolean;
	canUseCustomModels: boolean;
	canMakePublic: boolean;
}

const DEFAULT_FEATURES: TierFeatures = {
	canDeploy: false,
	canExportGithub: false,
	canUseCustomModels: false,
	canMakePublic: false,
};

/** Resolved effective limits for a user (tier + overrides merged) */
export interface EffectiveLimits {
	tierId: string;
	tierName: string;
	maxApps: number;
	dailyAppCreations: number;
	dailyLlmCredits: number;
	maxCustomProviders: number;
	features: TierFeatures;
	hasOverrides: boolean;
}

export class TierService extends BaseService {
	// ========================================
	// TIER CRUD
	// ========================================

	async listTiers(): Promise<schema.Tier[]> {
		return this.getReadDb()
			.select()
			.from(schema.tiers)
			.orderBy(schema.tiers.sortOrder)
			.all();
	}

	async getTier(tierId: string): Promise<schema.Tier | null> {
		const tier = await this.database
			.select()
			.from(schema.tiers)
			.where(eq(schema.tiers.id, tierId))
			.get();
		return tier ?? null;
	}

	async createTier(data: {
		id: string;
		name: string;
		description?: string;
		maxApps: number;
		dailyAppCreations: number;
		dailyLlmCredits: number;
		maxCustomProviders?: number;
		features?: TierFeatures;
		sortOrder?: number;
		isDefault?: boolean;
	}): Promise<schema.Tier> {
		const now = new Date();

		// If setting as default, unset other defaults first
		if (data.isDefault) {
			await this.database
				.update(schema.tiers)
				.set({ isDefault: false, updatedAt: now });
		}

		await this.database.insert(schema.tiers).values({
			id: data.id,
			name: data.name,
			description: data.description ?? null,
			maxApps: data.maxApps,
			dailyAppCreations: data.dailyAppCreations,
			dailyLlmCredits: data.dailyLlmCredits,
			maxCustomProviders: data.maxCustomProviders ?? 0,
			features: data.features ?? DEFAULT_FEATURES,
			sortOrder: data.sortOrder ?? 0,
			isDefault: data.isDefault ?? false,
			createdAt: now,
			updatedAt: now,
		});

		return (await this.getTier(data.id))!;
	}

	async updateTier(
		tierId: string,
		data: Partial<{
			name: string;
			description: string | null;
			maxApps: number;
			dailyAppCreations: number;
			dailyLlmCredits: number;
			maxCustomProviders: number;
			features: TierFeatures;
			sortOrder: number;
			isDefault: boolean;
		}>
	): Promise<schema.Tier | null> {
		const now = new Date();

		// If setting as default, unset other defaults
		if (data.isDefault) {
			await this.database
				.update(schema.tiers)
				.set({ isDefault: false, updatedAt: now });
		}

		await this.database
			.update(schema.tiers)
			.set({ ...data, updatedAt: now })
			.where(eq(schema.tiers.id, tierId));

		return this.getTier(tierId);
	}

	async deleteTier(tierId: string): Promise<{ success: boolean; error?: string }> {
		// Check if any users are assigned to this tier
		const usersOnTier = await this.getReadDb()
			.select({ count: count() })
			.from(schema.users)
			.where(eq(schema.users.tierId, tierId))
			.get();

		if (usersOnTier && usersOnTier.count > 0) {
			return {
				success: false,
				error: `Cannot delete tier: ${usersOnTier.count} user(s) are still assigned to it`,
			};
		}

		await this.database
			.delete(schema.tiers)
			.where(eq(schema.tiers.id, tierId));

		return { success: true };
	}

	// ========================================
	// USER TIER MANAGEMENT
	// ========================================

	async assignUserTier(userId: string, tierId: string): Promise<boolean> {
		// Verify tier exists
		const tier = await this.getTier(tierId);
		if (!tier) return false;

		await this.database
			.update(schema.users)
			.set({ tierId, updatedAt: new Date() })
			.where(eq(schema.users.id, userId));

		return true;
	}

	async setUserOverrides(
		userId: string,
		overrides: {
			maxApps?: number | null;
			dailyAppCreations?: number | null;
			dailyLlmCredits?: number | null;
			maxCustomProviders?: number | null;
			features?: TierFeatures | null;
			reason?: string;
		},
		setByUserId: string
	): Promise<schema.TierOverride> {
		const now = new Date();

		await this.database
			.insert(schema.tierOverrides)
			.values({
				userId,
				maxApps: overrides.maxApps ?? null,
				dailyAppCreations: overrides.dailyAppCreations ?? null,
				dailyLlmCredits: overrides.dailyLlmCredits ?? null,
				maxCustomProviders: overrides.maxCustomProviders ?? null,
				features: overrides.features ?? null,
				reason: overrides.reason ?? null,
				setBy: setByUserId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: schema.tierOverrides.userId,
				set: {
					maxApps: overrides.maxApps ?? null,
					dailyAppCreations: overrides.dailyAppCreations ?? null,
					dailyLlmCredits: overrides.dailyLlmCredits ?? null,
					maxCustomProviders: overrides.maxCustomProviders ?? null,
					features: overrides.features ?? null,
					reason: overrides.reason ?? null,
					setBy: setByUserId,
					updatedAt: now,
				},
			});

		return (await this.getUserOverrides(userId))!;
	}

	async removeUserOverrides(userId: string): Promise<boolean> {
		await this.database
			.delete(schema.tierOverrides)
			.where(eq(schema.tierOverrides.userId, userId));
		return true;
	}

	async getUserOverrides(userId: string): Promise<schema.TierOverride | null> {
		const override = await this.database
			.select()
			.from(schema.tierOverrides)
			.where(eq(schema.tierOverrides.userId, userId))
			.get();
		return override ?? null;
	}

	// ========================================
	// EFFECTIVE LIMITS RESOLUTION
	// ========================================

	/**
	 * Get the effective limits for a user by merging tier defaults + per-user overrides.
	 * This is the primary method used by rate limiting and feature gating.
	 */
	async getUserEffectiveLimits(userId: string): Promise<EffectiveLimits> {
		// Use primary DB (not read replica) to ensure we get the latest tier assignment
		const [user, overrides] = await Promise.all([
			this.database
				.select({
					tierId: schema.users.tierId,
				})
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.get(),
			this.getUserOverrides(userId),
		]);

		const tierId = user?.tierId || 'free';
		const tier = await this.getTier(tierId);

		if (!tier) {
			// Fallback to hardcoded free tier defaults if tier record is missing
			return {
				tierId: 'free',
				tierName: 'Free',
				maxApps: 3,
				dailyAppCreations: 2,
				dailyLlmCredits: 100,
				maxCustomProviders: 0,
				features: DEFAULT_FEATURES,
				hasOverrides: false,
			};
		}

		const tierFeatures = parseTierFeatures(tier.features);
		const hasOverrides = overrides !== null;

		// Merge: override values take precedence over tier defaults when non-null
		return {
			tierId: tier.id,
			tierName: tier.name,
			maxApps: overrides?.maxApps ?? tier.maxApps,
			dailyAppCreations: overrides?.dailyAppCreations ?? tier.dailyAppCreations,
			dailyLlmCredits: overrides?.dailyLlmCredits ?? tier.dailyLlmCredits,
			maxCustomProviders: overrides?.maxCustomProviders ?? tier.maxCustomProviders,
			features: mergeFeatures(tierFeatures, overrides?.features),
			hasOverrides,
		};
	}

	/**
	 * Check if user can create a new app based on total app count vs tier limit
	 */
	async canUserCreateApp(userId: string): Promise<{
		allowed: boolean;
		current: number;
		max: number;
		tierName: string;
	}> {
		const [limits, appCount] = await Promise.all([
			this.getUserEffectiveLimits(userId),
			this.getReadDb()
				.select({ count: count() })
				.from(schema.apps)
				.where(
					and(
						eq(schema.apps.userId, userId),
						eq(schema.apps.isArchived, false)
					)
				)
				.get(),
		]);

		const current = appCount?.count ?? 0;
		return {
			allowed: current < limits.maxApps,
			current,
			max: limits.maxApps,
			tierName: limits.tierName,
		};
	}

	// ========================================
	// ADMIN STATISTICS
	// ========================================

	async getUsersByTier(): Promise<Array<{ tierId: string; tierName: string; userCount: number }>> {
		const results = await this.getReadDb()
			.select({
				tierId: schema.users.tierId,
				userCount: count(),
			})
			.from(schema.users)
			.where(isNull(schema.users.deletedAt))
			.groupBy(schema.users.tierId)
			.all();

		// Enrich with tier names
		const allTiers = await this.listTiers();
		const tierMap = new Map(allTiers.map((t) => [t.id, t.name]));

		return results.map((r) => ({
			tierId: r.tierId || 'free',
			tierName: tierMap.get(r.tierId || 'free') || 'Unknown',
			userCount: r.userCount,
		}));
	}

	async getAdminStats(): Promise<{
		totalUsers: number;
		totalApps: number;
		usersByTier: Array<{ tierId: string; tierName: string; userCount: number }>;
		usersByRole: Array<{ role: string; count: number }>;
	}> {
		const [totalUsers, totalApps, usersByTier, usersByRole] = await Promise.all([
			this.getReadDb()
				.select({ count: count() })
				.from(schema.users)
				.where(isNull(schema.users.deletedAt))
				.get(),
			this.getReadDb()
				.select({ count: count() })
				.from(schema.apps)
				.get(),
			this.getUsersByTier(),
			this.getReadDb()
				.select({
					role: schema.users.role,
					count: count(),
				})
				.from(schema.users)
				.where(isNull(schema.users.deletedAt))
				.groupBy(schema.users.role)
				.all(),
		]);

		return {
			totalUsers: totalUsers?.count ?? 0,
			totalApps: totalApps?.count ?? 0,
			usersByTier,
			usersByRole: usersByRole.map((r) => ({
				role: r.role || 'user',
				count: r.count,
			})),
		};
	}
}

// ========================================
// HELPERS
// ========================================

function parseTierFeatures(features: unknown): TierFeatures {
	if (!features || typeof features !== 'object') return { ...DEFAULT_FEATURES };
	const f = features as Record<string, unknown>;
	return {
		canDeploy: f.canDeploy === true,
		canExportGithub: f.canExportGithub === true,
		canUseCustomModels: f.canUseCustomModels === true,
		canMakePublic: f.canMakePublic === true,
	};
}

function mergeFeatures(
	tierFeatures: TierFeatures,
	overrideFeatures: unknown
): TierFeatures {
	if (!overrideFeatures || typeof overrideFeatures !== 'object') return tierFeatures;
	const o = overrideFeatures as Record<string, unknown>;
	return {
		canDeploy: typeof o.canDeploy === 'boolean' ? o.canDeploy : tierFeatures.canDeploy,
		canExportGithub: typeof o.canExportGithub === 'boolean' ? o.canExportGithub : tierFeatures.canExportGithub,
		canUseCustomModels: typeof o.canUseCustomModels === 'boolean' ? o.canUseCustomModels : tierFeatures.canUseCustomModels,
		canMakePublic: typeof o.canMakePublic === 'boolean' ? o.canMakePublic : tierFeatures.canMakePublic,
	};
}
