/**
 * Integration Controller
 * Handles Google Drive OAuth flow and file access.
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { IntegrationService } from '../../../database/services/IntegrationService';
import { GoogleDriveService } from '../../../services/integrations/GoogleDriveService';
import {
	buildDriveAuthUrl,
	exchangeCodeForDriveTokens,
	encryptDriveTokens,
	decryptDriveToken,
	refreshDriveAccessToken,
} from '../../../services/integrations/GoogleDriveOAuth';
import { createLogger } from '../../../logger';
import { generateSecureToken } from '../../../utils/cryptoUtils';
import type { ControllerResponse, ApiResponse } from '../types';
import type {
	IntegrationsListData,
	IntegrationConnectData,
	IntegrationDisconnectData,
	DriveFilesListData,
	DriveFileContentData,
} from './types';

const logger = createLogger('IntegrationController');

export class IntegrationController extends BaseController {
	/**
	 * GET /api/integrations -- list user's integrations
	 */
	static async listIntegrations(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<IntegrationsListData>>> {
		try {
			const user = context.user;
			if (!user) return IntegrationController.createErrorResponse('Auth required', 401);

			const service = new IntegrationService(env);
			const integrations = await service.listUserIntegrations(user.id);

			// Check which integrations are configured by admin and available to this user
			const { getDriveConfigStatus } = await import('../../../services/integrations/GoogleDriveOAuth');
			const driveStatus = await getDriveConfigStatus(env, user.id);

			return IntegrationController.createSuccessResponse<IntegrationsListData>({
				available: {
					googleDrive: driveStatus,
				},
				integrations: integrations.map((i) => ({
					provider: i.provider,
					isActive: i.isActive ?? false,
					scopes: (i.scopes as string[]) ?? [],
					connectedAt: i.createdAt,
				})),
			});
		} catch (error) {
			return IntegrationController.handleError(error, 'list integrations') as ControllerResponse<ApiResponse<IntegrationsListData>>;
		}
	}

	/**
	 * POST /api/integrations/google-drive/connect -- initiate Drive OAuth
	 */
	static async connectGoogleDrive(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<IntegrationConnectData>>> {
		try {
			const user = context.user;
			if (!user) return IntegrationController.createErrorResponse('Auth required', 401);

			// Tier gate: check if user's tier allows Google Drive
			const { checkTierFeature } = await import('../../../utils/tierGating');
			const blocked = await checkTierFeature(env, user.id, 'canUseGoogleDrive', 'Google Drive integration');
			if (blocked) return blocked as ControllerResponse<ApiResponse<IntegrationConnectData>>;

			const url = new URL(request.url);
			const redirectUri = `${url.origin}/api/integrations/google-drive/callback`;

			// Generate state token with user ID
			const state = `${user.id}:${generateSecureToken(16)}`;
			// Store state in KV with 10min TTL
			await env.VibecoderStore.put(
				`drive_oauth_state:${state}`,
				JSON.stringify({ userId: user.id }),
				{ expirationTtl: 600 }
			);

			const authUrl = await buildDriveAuthUrl(env, redirectUri, state);

			return IntegrationController.createSuccessResponse<IntegrationConnectData>({ authUrl });
		} catch (error) {
			return IntegrationController.handleError(error, 'connect google drive') as ControllerResponse<ApiResponse<IntegrationConnectData>>;
		}
	}

	/**
	 * GET /api/integrations/google-drive/callback -- OAuth callback
	 */
	static async googleDriveCallback(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		_context: RouteContext
	): Promise<Response> {
		try {
			const url = new URL(request.url);
			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state');
			const error = url.searchParams.get('error');

			if (error) {
				logger.warn('Drive OAuth error', { error });
				return new Response(driveCallbackHtml(false, error), {
					headers: { 'Content-Type': 'text/html' },
				});
			}

			if (!code || !state) {
				return new Response(driveCallbackHtml(false, 'Missing code or state'), {
					headers: { 'Content-Type': 'text/html' },
				});
			}

			// Validate state
			const storedState = await env.VibecoderStore.get(`drive_oauth_state:${state}`);
			if (!storedState) {
				return new Response(driveCallbackHtml(false, 'Invalid or expired state'), {
					headers: { 'Content-Type': 'text/html' },
				});
			}
			await env.VibecoderStore.delete(`drive_oauth_state:${state}`);

			const { userId } = JSON.parse(storedState) as { userId: string };
			const redirectUri = `${url.origin}/api/integrations/google-drive/callback`;

			// Exchange code for tokens
			const tokens = await exchangeCodeForDriveTokens(env, code, redirectUri);

			// Encrypt tokens
			const { accessEncrypted, refreshEncrypted } = await encryptDriveTokens(
				env,
				tokens.accessToken,
				tokens.refreshToken
			);

			// Store integration
			const service = new IntegrationService(env);
			await service.upsertIntegration({
				userId,
				provider: 'google_drive',
				accessTokenEncrypted: accessEncrypted,
				refreshTokenEncrypted: refreshEncrypted,
				tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
				scopes: tokens.scope.split(' '),
			});

			logger.info('Google Drive integration connected', { userId });

			return new Response(driveCallbackHtml(true), {
				headers: { 'Content-Type': 'text/html' },
			});
		} catch (error) {
			logger.error('Drive OAuth callback failed', error);
			return new Response(
				driveCallbackHtml(false, error instanceof Error ? error.message : 'Unknown error'),
				{ headers: { 'Content-Type': 'text/html' } }
			);
		}
	}

	/**
	 * DELETE /api/integrations/google-drive -- disconnect
	 */
	static async disconnectGoogleDrive(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<IntegrationDisconnectData>>> {
		try {
			const user = context.user;
			if (!user) return IntegrationController.createErrorResponse('Auth required', 401);

			const service = new IntegrationService(env);
			await service.disconnectIntegration(user.id, 'google_drive');

			return IntegrationController.createSuccessResponse<IntegrationDisconnectData>({ success: true });
		} catch (error) {
			return IntegrationController.handleError(error, 'disconnect google drive') as ControllerResponse<ApiResponse<IntegrationDisconnectData>>;
		}
	}

	/**
	 * GET /api/integrations/google-drive/files -- list Drive files
	 */
	static async listDriveFiles(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<DriveFilesListData>>> {
		try {
			const user = context.user;
			if (!user) return IntegrationController.createErrorResponse('Auth required', 401);

			const accessToken = await getActiveDriveToken(env, user.id);
			if (!accessToken) {
				return IntegrationController.createErrorResponse('Google Drive not connected', 403);
			}

			const url = new URL(request.url);
			const query = url.searchParams.get('q') || undefined;
			const pageToken = url.searchParams.get('pageToken') || undefined;

			const driveService = new GoogleDriveService(accessToken);
			const result = await driveService.listFiles(query, pageToken);

			return IntegrationController.createSuccessResponse<DriveFilesListData>({
				files: result.files.map((f) => ({
					id: f.id,
					name: f.name,
					mimeType: f.mimeType,
					modifiedTime: f.modifiedTime,
					webViewLink: f.webViewLink,
				})),
				nextPageToken: result.nextPageToken,
			});
		} catch (error) {
			return IntegrationController.handleError(error, 'list drive files') as ControllerResponse<ApiResponse<DriveFilesListData>>;
		}
	}

	/**
	 * GET /api/integrations/google-drive/files/:fileId -- read file content
	 */
	static async getDriveFileContent(
		_request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext
	): Promise<ControllerResponse<ApiResponse<DriveFileContentData>>> {
		try {
			const user = context.user;
			if (!user) return IntegrationController.createErrorResponse('Auth required', 401);

			const fileId = context.pathParams.fileId;
			if (!fileId) return IntegrationController.createErrorResponse('File ID required', 400);

			const accessToken = await getActiveDriveToken(env, user.id);
			if (!accessToken) {
				return IntegrationController.createErrorResponse('Google Drive not connected', 403);
			}

			const driveService = new GoogleDriveService(accessToken);
			const file = await driveService.getFile(fileId);
			const { content, format } = await driveService.getFileContent(fileId, file.mimeType);

			return IntegrationController.createSuccessResponse<DriveFileContentData>({
				fileName: file.name,
				content,
				format,
			});
		} catch (error) {
			return IntegrationController.handleError(error, 'get drive file content') as ControllerResponse<ApiResponse<DriveFileContentData>>;
		}
	}
}

/**
 * Get a valid Drive access token for a user, refreshing if expired.
 */
async function getActiveDriveToken(env: Env, userId: string): Promise<string | null> {
	const service = new IntegrationService(env);
	const integration = await service.getIntegration(userId, 'google_drive');

	if (!integration?.isActive || !integration.accessTokenEncrypted) {
		return null;
	}

	// Decrypt access token
	let accessToken = await decryptDriveToken(env, integration.accessTokenEncrypted);
	if (!accessToken) return null;

	// Check if expired (with 60s buffer)
	const isExpired = integration.tokenExpiresAt &&
		new Date(integration.tokenExpiresAt).getTime() < Date.now() + 60000;

	if (isExpired && integration.refreshTokenEncrypted) {
		// Refresh the token
		const refreshToken = await decryptDriveToken(env, integration.refreshTokenEncrypted);
		if (!refreshToken) return null;

		try {
			const refreshed = await refreshDriveAccessToken(env, refreshToken);
			const { accessEncrypted } = await encryptDriveTokens(env, refreshed.accessToken);

			await service.upsertIntegration({
				userId,
				provider: 'google_drive',
				accessTokenEncrypted: accessEncrypted,
				tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
				scopes: (integration.scopes as string[]) ?? [],
			});

			accessToken = refreshed.accessToken;
		} catch {
			return null;
		}
	}

	return accessToken;
}

/** Simple HTML page for the OAuth callback popup/redirect */
function driveCallbackHtml(success: boolean, error?: string): string {
	return `<!DOCTYPE html>
<html><head><title>Google Drive</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a1a;color:#fff">
<div style="text-align:center">
<h2>${success ? 'Google Drive Connected' : 'Connection Failed'}</h2>
<p>${success ? 'You can close this window.' : (error || 'An error occurred.')}</p>
<script>
${success ? 'setTimeout(()=>window.close(),1500);' : ''}
${success ? 'window.opener?.postMessage({type:"drive-connected"},window.location.origin);' : ''}
</script>
</div></body></html>`;
}
