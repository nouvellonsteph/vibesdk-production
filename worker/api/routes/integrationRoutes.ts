/**
 * Integration Routes
 * Handles Google Drive OAuth flow and file access.
 */

import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { setAuthLevel, AuthConfig } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';
import { IntegrationController } from '../controllers/integrations/controller';

export function setupIntegrationRoutes(app: Hono<AppEnv>): void {
	// List user's integrations
	app.get('/api/integrations',
		setAuthLevel(AuthConfig.authenticated),
		adaptController(IntegrationController, IntegrationController.listIntegrations));

	// Google Drive OAuth flow
	app.post('/api/integrations/google-drive/connect',
		setAuthLevel(AuthConfig.authenticated),
		adaptController(IntegrationController, IntegrationController.connectGoogleDrive));

	// OAuth callback (public -- state validates the user)
	app.get('/api/integrations/google-drive/callback',
		setAuthLevel(AuthConfig.public),
		adaptController(IntegrationController, IntegrationController.googleDriveCallback));

	// Disconnect Google Drive
	app.delete('/api/integrations/google-drive',
		setAuthLevel(AuthConfig.authenticated),
		adaptController(IntegrationController, IntegrationController.disconnectGoogleDrive));

	// List Drive files
	app.get('/api/integrations/google-drive/files',
		setAuthLevel(AuthConfig.authenticated),
		adaptController(IntegrationController, IntegrationController.listDriveFiles));

	// Read file content
	app.get('/api/integrations/google-drive/files/:fileId',
		setAuthLevel(AuthConfig.authenticated),
		adaptController(IntegrationController, IntegrationController.getDriveFileContent));
}
