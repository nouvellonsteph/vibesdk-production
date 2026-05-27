/**
 * Admin API Types
 */

import type { Tier, TierOverride } from '../../../database/schema';
import type { TierFeatures } from '../../../database/services/TierService';

// Tier management
export interface TiersListData {
	tiers: Tier[];
}

export interface TierData {
	tier: Tier;
}

export interface TierDeleteData {
	success: boolean;
}

// User management
export interface AdminUserData {
	id: string;
	email: string;
	displayName: string;
	username: string | null;
	avatarUrl: string | null;
	provider: string;
	role: string;
	tierId: string | null;
	tierName: string | null;
	appCount: number;
	isActive: boolean | null;
	isSuspended: boolean | null;
	createdAt: Date | null;
	lastActiveAt: Date | null;
	overrides: TierOverride | null;
}

export interface AdminUsersListData {
	users: AdminUserData[];
	total: number;
	page: number;
	limit: number;
}

export interface AdminUserDetailData {
	user: AdminUserData;
}

export interface AdminUserTierUpdateData {
	user: { id: string; tierId: string };
}

export interface AdminUserRoleUpdateData {
	user: { id: string; role: string };
}

export interface AdminUserOverridesData {
	overrides: TierOverride;
}

export interface AdminUserSuspendData {
	user: { id: string; isSuspended: boolean };
}

// Dashboard stats
export interface AdminStatsData {
	totalUsers: number;
	totalApps: number;
	usersByTier: Array<{ tierId: string; tierName: string; userCount: number }>;
	usersByRole: Array<{ role: string; count: number }>;
}

// Request bodies
export interface CreateTierRequest {
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
}

export interface UpdateTierRequest {
	name?: string;
	description?: string | null;
	maxApps?: number;
	dailyAppCreations?: number;
	dailyLlmCredits?: number;
	maxCustomProviders?: number;
	features?: TierFeatures;
	sortOrder?: number;
	isDefault?: boolean;
}

export interface SetUserOverridesRequest {
	maxApps?: number | null;
	dailyAppCreations?: number | null;
	dailyLlmCredits?: number | null;
	maxCustomProviders?: number | null;
	features?: TierFeatures | null;
	reason?: string;
}
