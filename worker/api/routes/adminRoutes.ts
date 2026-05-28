/**
 * Admin Routes - Tier management, user management, and dashboard
 * All routes require admin auth level.
 */

import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { setAuthLevel, AuthConfig } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';
import { AdminController } from '../controllers/admin/controller';

export function setupAdminRoutes(app: Hono<AppEnv>): void {
	// All admin routes require admin role
	const adminAuth = setAuthLevel(AuthConfig.admin);

	// ---- Tier management ----
	app.get('/api/admin/tiers', adminAuth, adaptController(AdminController, AdminController.listTiers));
	app.post('/api/admin/tiers', adminAuth, adaptController(AdminController, AdminController.createTier));
	app.put('/api/admin/tiers/:tierId', adminAuth, adaptController(AdminController, AdminController.updateTier));
	app.delete('/api/admin/tiers/:tierId', adminAuth, adaptController(AdminController, AdminController.deleteTier));

	// ---- User management ----
	app.get('/api/admin/users', adminAuth, adaptController(AdminController, AdminController.listUsers));
	app.get('/api/admin/users/:userId', adminAuth, adaptController(AdminController, AdminController.getUserDetail));
	app.put('/api/admin/users/:userId/tier', adminAuth, adaptController(AdminController, AdminController.updateUserTier));
	app.put('/api/admin/users/:userId/role', adminAuth, adaptController(AdminController, AdminController.updateUserRole));
	app.put('/api/admin/users/:userId/overrides', adminAuth, adaptController(AdminController, AdminController.setUserOverrides));
	app.delete('/api/admin/users/:userId/overrides', adminAuth, adaptController(AdminController, AdminController.removeUserOverrides));
	app.put('/api/admin/users/:userId/suspend', adminAuth, adaptController(AdminController, AdminController.suspendUser));

	// ---- Dashboard stats ----
	app.get('/api/admin/stats', adminAuth, adaptController(AdminController, AdminController.getStats));

	// ---- Egress rules ----
	app.get('/api/admin/egress-rules', adminAuth, adaptController(AdminController, AdminController.listEgressRules));
	app.post('/api/admin/egress-rules', adminAuth, adaptController(AdminController, AdminController.createEgressRule));
	app.put('/api/admin/egress-rules/:ruleId', adminAuth, adaptController(AdminController, AdminController.updateEgressRule));
	app.delete('/api/admin/egress-rules/:ruleId', adminAuth, adaptController(AdminController, AdminController.deleteEgressRule));
}
