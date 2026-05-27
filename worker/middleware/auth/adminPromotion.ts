/**
 * Admin Auto-Promotion
 * Checks ADMIN_EMAILS env var and promotes matching users to admin role.
 * Runs once per auth check; updates D1 only when a promotion actually happens.
 */

import { eq } from 'drizzle-orm';
import { createDatabaseService } from '../../database/database';
import * as schema from '../../database/schema';
import { AuthUser } from '../../types/auth-types';
import { createLogger } from '../../logger';

const logger = createLogger('AdminPromotion');

// Per-invocation cache so we don't hit D1 repeatedly in the same request
const promotionChecked = new Set<string>();

/**
 * Parse the ADMIN_EMAILS env var into a normalized set of emails.
 */
function getAdminEmails(env: Env): Set<string> {
	const raw = (env as unknown as Record<string, string>).ADMIN_EMAILS;
	if (!raw) return new Set();
	return new Set(
		raw
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	);
}

/**
 * If the user's email is in ADMIN_EMAILS and they aren't already admin,
 * update D1 and return a patched AuthUser. Otherwise return user unchanged.
 */
export async function checkAndPromoteAdmin(env: Env, user: AuthUser): Promise<AuthUser> {
	// Skip if already checked this invocation
	if (promotionChecked.has(user.id)) return user;
	promotionChecked.add(user.id);

	// Already admin? Nothing to do.
	if (user.role === 'admin') return user;

	const adminEmails = getAdminEmails(env);
	if (adminEmails.size === 0) return user;

	if (!adminEmails.has(user.email.toLowerCase())) return user;

	// Promote in D1
	try {
		const db = createDatabaseService(env);
		await db.db
			.update(schema.users)
			.set({ role: 'admin', updatedAt: new Date() })
			.where(eq(schema.users.id, user.id));

		logger.info('Auto-promoted user to admin', { userId: user.id, email: user.email });
		return { ...user, role: 'admin' };
	} catch (error) {
		logger.error('Failed to auto-promote admin', error);
		return user;
	}
}
