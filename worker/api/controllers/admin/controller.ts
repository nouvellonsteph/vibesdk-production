/**
 * Admin Controller - Tier management, user management, and admin dashboard
 */

import { BaseController } from '../baseController';
import { TierService } from '../../../database/services/TierService';
import { createLogger } from '../../../logger';
import { RouteContext } from '../../types/route-context';
import type { ControllerResponse, ApiResponse } from '../types';
import type {
	TiersListData,
	TierData,
	TierDeleteData,
	AdminUsersListData,
	AdminUserDetailData,
	AdminUserTierUpdateData,
	AdminUserRoleUpdateData,
	AdminUserOverridesData,
	AdminUserSuspendData,
	AdminStatsData,
	CreateTierRequest,
	UpdateTierRequest,
	SetUserOverridesRequest,
	AdminUserData,
} from './types';
import * as schema from '../../../database/schema';
import { eq, like, or, and, isNull, count, desc, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createDatabaseService } from '../../../database/database';

export class AdminController extends BaseController {
	static logger = createLogger('AdminController');

	// ========================================
	// TIER MANAGEMENT
	// ========================================

	static async listTiers(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		_context: RouteContext
	): Promise<ControllerResponse<ApiResponse<TiersListData>>> {
		try {
			const tierService = new TierService(env);
			const tiers = await tierService.listTiers();
			return AdminController.createSuccessResponse<TiersListData>({ tiers });
		} catch (error) {
			return AdminController.handleError(error, 'list tiers') as ControllerResponse<ApiResponse<TiersListData>>;
		}
	}

	static async createTier(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		_context: RouteContext
	): Promise<ControllerResponse<ApiResponse<TierData>>> {
		try {
			const body = await request.json() as CreateTierRequest;

			if (!body.id || !body.name) {
				return AdminController.createErrorResponse<TierData>('Tier ID and name are required', 400);
			}

			const tierService = new TierService(env);

			// Check ID uniqueness
			const existing = await tierService.getTier(body.id);
			if (existing) {
				return AdminController.createErrorResponse<TierData>('A tier with this ID already exists', 409);
			}

			const tier = await tierService.createTier(body);
			return AdminController.createSuccessResponse<TierData>({ tier });
		} catch (error) {
			return AdminController.handleError(error, 'create tier') as ControllerResponse<ApiResponse<TierData>>;
		}
	}

	static async updateTier(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<TierData>>> {
		try {
			const tierId = context.pathParams.tierId;
			if (!tierId) {
				return AdminController.createErrorResponse<TierData>('Tier ID is required', 400);
			}

			const body = await request.json() as UpdateTierRequest;
			const tierService = new TierService(env);
			const tier = await tierService.updateTier(tierId, body);

			if (!tier) {
				return AdminController.createErrorResponse<TierData>('Tier not found', 404);
			}

			return AdminController.createSuccessResponse<TierData>({ tier });
		} catch (error) {
			return AdminController.handleError(error, 'update tier') as ControllerResponse<ApiResponse<TierData>>;
		}
	}

	static async deleteTier(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<TierDeleteData>>> {
		try {
			const tierId = context.pathParams.tierId;
			if (!tierId) {
				return AdminController.createErrorResponse<TierDeleteData>('Tier ID is required', 400);
			}

			const tierService = new TierService(env);
			const result = await tierService.deleteTier(tierId);

			if (!result.success) {
				return AdminController.createErrorResponse<TierDeleteData>(result.error || 'Cannot delete tier', 409);
			}

			return AdminController.createSuccessResponse<TierDeleteData>({ success: true });
		} catch (error) {
			return AdminController.handleError(error, 'delete tier') as ControllerResponse<ApiResponse<TierDeleteData>>;
		}
	}

	// ========================================
	// USER MANAGEMENT
	// ========================================

	static async listUsers(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUsersListData>>> {
		try {
			const params = context.queryParams;
			const page = Math.max(1, parseInt(params.get('page') || '1'));
			const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '20')));
			const search = params.get('search') || undefined;
			const tierId = params.get('tierId') || undefined;
			const role = params.get('role') || undefined;
			const offset = (page - 1) * limit;

			const db = createDatabaseService(env);
			const readDb = db.getReadDb();

			// Build conditions
			const conditions: SQL[] = [];
			conditions.push(isNull(schema.users.deletedAt));

			if (search) {
				// Escape SQL LIKE wildcards to prevent pattern injection
				const escaped = search.replace(/[%_]/g, '\\$&');
				const searchCondition = or(
					like(schema.users.email, `%${escaped}%`),
					like(schema.users.displayName, `%${escaped}%`),
					like(schema.users.username, `%${escaped}%`)
				);
				if (searchCondition) conditions.push(searchCondition);
			}
			if (tierId) {
				conditions.push(eq(schema.users.tierId, tierId));
			}
			if (role && (role === 'user' || role === 'admin')) {
				conditions.push(eq(schema.users.role, role));
			}

			const whereClause = and(...conditions);

			// Get total count
			const totalResult = await readDb
				.select({ count: count() })
				.from(schema.users)
				.where(whereClause)
				.get();

			// Get users with app count
			const users = await readDb
				.select({
					id: schema.users.id,
					email: schema.users.email,
					displayName: schema.users.displayName,
					username: schema.users.username,
					avatarUrl: schema.users.avatarUrl,
					provider: schema.users.provider,
					role: schema.users.role,
					tierId: schema.users.tierId,
					isActive: schema.users.isActive,
					isSuspended: schema.users.isSuspended,
					createdAt: schema.users.createdAt,
					lastActiveAt: schema.users.lastActiveAt,
				})
				.from(schema.users)
				.where(whereClause)
				.orderBy(desc(schema.users.createdAt))
				.limit(limit)
				.offset(offset)
				.all();

			// Get app counts for these users
			const userIds = users.map((u) => u.id);
			const appCounts = userIds.length > 0
				? await readDb
						.select({
							userId: schema.apps.userId,
							count: count(),
						})
						.from(schema.apps)
						.where(inArray(schema.apps.userId, userIds))
						.groupBy(schema.apps.userId)
						.all()
				: [];

			const appCountMap = new Map(appCounts.map((a) => [a.userId, a.count]));

			// Get tier names
			const tierService = new TierService(env);
			const allTiers = await tierService.listTiers();
			const tierMap = new Map(allTiers.map((t) => [t.id, t.name]));

			const adminUsers: AdminUserData[] = users.map((u) => ({
				id: u.id,
				email: u.email,
				displayName: u.displayName,
				username: u.username,
				avatarUrl: u.avatarUrl,
				provider: u.provider,
				role: u.role || 'user',
				tierId: u.tierId,
				tierName: tierMap.get(u.tierId || 'free') || 'Unknown',
				appCount: appCountMap.get(u.id) || 0,
				isActive: u.isActive,
				isSuspended: u.isSuspended,
				createdAt: u.createdAt,
				lastActiveAt: u.lastActiveAt,
				overrides: null, // Loaded on detail view
			}));

			return AdminController.createSuccessResponse<AdminUsersListData>({
				users: adminUsers,
				total: totalResult?.count ?? 0,
				page,
				limit,
			});
		} catch (error) {
			return AdminController.handleError(error, 'list users') as ControllerResponse<ApiResponse<AdminUsersListData>>;
		}
	}

	static async getUserDetail(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUserDetailData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<AdminUserDetailData>('User ID is required', 400);
			}

			const db = createDatabaseService(env);
			const readDb = db.getReadDb();

			const user = await readDb
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.get();

			if (!user) {
				return AdminController.createErrorResponse<AdminUserDetailData>('User not found', 404);
			}

			// Get app count
			const appCount = await readDb
				.select({ count: count() })
				.from(schema.apps)
				.where(eq(schema.apps.userId, userId))
				.get();

			// Get tier info and overrides
			const tierService = new TierService(env);
			const [tier, overrides] = await Promise.all([
				tierService.getTier(user.tierId || 'free'),
				tierService.getUserOverrides(userId),
			]);

			const adminUser: AdminUserData = {
				id: user.id,
				email: user.email,
				displayName: user.displayName,
				username: user.username,
				avatarUrl: user.avatarUrl,
				provider: user.provider,
				role: user.role || 'user',
				tierId: user.tierId,
				tierName: tier?.name || 'Unknown',
				appCount: appCount?.count ?? 0,
				isActive: user.isActive,
				isSuspended: user.isSuspended,
				createdAt: user.createdAt,
				lastActiveAt: user.lastActiveAt,
				overrides,
			};

			return AdminController.createSuccessResponse<AdminUserDetailData>({ user: adminUser });
		} catch (error) {
			return AdminController.handleError(error, 'get user detail') as ControllerResponse<ApiResponse<AdminUserDetailData>>;
		}
	}

	static async updateUserTier(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUserTierUpdateData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<AdminUserTierUpdateData>('User ID is required', 400);
			}

			const body = await request.json() as { tierId: string };
			if (!body.tierId) {
				return AdminController.createErrorResponse<AdminUserTierUpdateData>('Tier ID is required', 400);
			}

			const tierService = new TierService(env);
			const success = await tierService.assignUserTier(userId, body.tierId);

			if (!success) {
				return AdminController.createErrorResponse<AdminUserTierUpdateData>('Tier not found', 404);
			}

			return AdminController.createSuccessResponse<AdminUserTierUpdateData>({
				user: { id: userId, tierId: body.tierId },
			});
		} catch (error) {
			return AdminController.handleError(error, 'update user tier') as ControllerResponse<ApiResponse<AdminUserTierUpdateData>>;
		}
	}

	static async updateUserRole(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUserRoleUpdateData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<AdminUserRoleUpdateData>('User ID is required', 400);
			}

			const body = await request.json() as { role: string };
			if (!body.role || !['user', 'admin'].includes(body.role)) {
				return AdminController.createErrorResponse<AdminUserRoleUpdateData>('Role must be "user" or "admin"', 400);
			}
			const validRole = body.role as 'user' | 'admin'; // validated above

			const db = createDatabaseService(env);
			await db.db
				.update(schema.users)
				.set({ role: validRole, updatedAt: new Date() })
				.where(eq(schema.users.id, userId));

			return AdminController.createSuccessResponse<AdminUserRoleUpdateData>({
				user: { id: userId, role: validRole },
			});
		} catch (error) {
			return AdminController.handleError(error, 'update user role') as ControllerResponse<ApiResponse<AdminUserRoleUpdateData>>;
		}
	}

	static async setUserOverrides(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUserOverridesData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<AdminUserOverridesData>('User ID is required', 400);
			}

			const body = await request.json() as SetUserOverridesRequest;
			const adminUserId = context.user!.id;

			const tierService = new TierService(env);
			const overrides = await tierService.setUserOverrides(userId, body, adminUserId);

			return AdminController.createSuccessResponse<AdminUserOverridesData>({ overrides });
		} catch (error) {
			return AdminController.handleError(error, 'set user overrides') as ControllerResponse<ApiResponse<AdminUserOverridesData>>;
		}
	}

	static async removeUserOverrides(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<TierDeleteData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<TierDeleteData>('User ID is required', 400);
			}

			const tierService = new TierService(env);
			await tierService.removeUserOverrides(userId);

			return AdminController.createSuccessResponse<TierDeleteData>({ success: true });
		} catch (error) {
			return AdminController.handleError(error, 'remove user overrides') as ControllerResponse<ApiResponse<TierDeleteData>>;
		}
	}

	static async suspendUser(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminUserSuspendData>>> {
		try {
			const userId = context.pathParams.userId;
			if (!userId) {
				return AdminController.createErrorResponse<AdminUserSuspendData>('User ID is required', 400);
			}

			const body = await request.json() as { suspended: boolean };

			const db = createDatabaseService(env);
			await db.db
				.update(schema.users)
				.set({ isSuspended: body.suspended, updatedAt: new Date() })
				.where(eq(schema.users.id, userId));

			return AdminController.createSuccessResponse<AdminUserSuspendData>({
				user: { id: userId, isSuspended: body.suspended },
			});
		} catch (error) {
			return AdminController.handleError(error, 'suspend user') as ControllerResponse<ApiResponse<AdminUserSuspendData>>;
		}
	}

	// ========================================
	// DASHBOARD STATS
	// ========================================

	static async getStats(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		_context: RouteContext
	): Promise<ControllerResponse<ApiResponse<AdminStatsData>>> {
		try {
			const tierService = new TierService(env);
			const stats = await tierService.getAdminStats();

			return AdminController.createSuccessResponse<AdminStatsData>(stats);
		} catch (error) {
			return AdminController.handleError(error, 'get admin stats') as ControllerResponse<ApiResponse<AdminStatsData>>;
		}
	}
}
