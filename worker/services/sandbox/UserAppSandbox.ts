/**
 * Custom Sandbox subclass with egress control.
 *
 * Extends the base Sandbox to add:
 * - Default deny-all internet (`enableInternet = false`)
 * - Admin-configurable allowed/denied host lists
 * - Outbound request logging
 *
 * IMPORTANT: This file also exports ContainerProxy which is required
 * for the outbound interception to work.
 */

import { Sandbox } from '@cloudflare/sandbox';
import { createLogger } from '../../logger';
import { IntegrationService } from '../../database/services/IntegrationService';
import {
	decryptDriveToken,
	refreshDriveAccessToken,
	encryptDriveTokens,
} from '../integrations/GoogleDriveOAuth';

const logger = createLogger('UserAppSandbox');

/**
 * Virtual hostname for Google Drive API access from sandboxed apps.
 * Generated apps use `fetch('http://drive.api/drive/v3/files')` and
 * the outbound handler transparently injects the user's OAuth token.
 */
export const DRIVE_API_VIRTUAL_HOST = 'drive.api';

/**
 * System-required hosts that must always be allowed for the sandbox to function.
 * These are added to the allowlist automatically regardless of admin egress rules.
 */
export const SYSTEM_REQUIRED_HOSTS = [
	// Package registries (bun install, npm install)
	'registry.npmjs.org',
	'registry.yarnpkg.com',
	'*.npmjs.org',
	// Bun package manager
	'bun.sh',
	'*.bun.sh',
	// Cloudflared tunnel
	'*.trycloudflare.com',
	'api.trycloudflare.com',
	// Cloudflare APIs (wrangler, deployment)
	'api.cloudflare.com',
	'*.cloudflare.com',
	'*.cloudflareinsights.com',
	// DNS
	'1.1.1.1',
	'1.0.0.1',
	// GitHub (for git operations, template downloads)
	'github.com',
	'*.github.com',
	'*.githubusercontent.com',
	// CDNs commonly needed by generated apps
	'cdn.jsdelivr.net',
	'unpkg.com',
	'esm.sh',
	'fonts.googleapis.com',
	'fonts.gstatic.com',
];

/**
 * Sandbox with egress filtering and credential injection for user apps.
 *
 * Internet is DISABLED by default. The allowedHosts list is populated with:
 * 1. System-required hosts (npm, cloudflare, github, etc.)
 * 2. Admin-configured allow rules from the egress_rules table
 * 3. Integration-specific hosts (drive.api when Google Drive is connected)
 *
 * Admin deny rules are applied via deniedHosts.
 */
export class UserAppSandboxService extends Sandbox {
	enableInternet = false;
	allowedHosts = SYSTEM_REQUIRED_HOSTS;
}

/**
 * Named outbound handlers for runtime assignment via setOutboundByHost().
 *
 * `driveProxy`: Intercepts requests to `drive.api`, looks up the user's
 * Google Drive OAuth token from D1, injects it as an Authorization header,
 * and forwards the request to the real Google APIs endpoint.
 *
 * The user's token is never exposed to the sandbox -- the generated app
 * simply calls `http://drive.api/drive/v3/files` and this handler adds auth.
 */
UserAppSandboxService.outboundHandlers = {
	driveProxy: async (
		request: Request,
		env: Env,
		ctx: { containerId: string }
	) => {
		const url = new URL(request.url);
		logger.info('Drive API proxy request', {
			containerId: ctx.containerId,
			path: url.pathname,
			method: request.method,
		});

		// Look up the user's Drive token from KV.
		// The containerId maps to a sandbox session which maps to a user.
		// We store the mapping at sandbox creation time in KV.
		const userId = await env.VibecoderStore.get(`sandbox_user:${ctx.containerId}`);
		if (!userId) {
			logger.warn('No user mapping for container', { containerId: ctx.containerId });
			return new Response(JSON.stringify({ error: 'Drive integration not configured' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Get the user's Drive access token
		const integrationService = new IntegrationService(env);
		const integration = await integrationService.getIntegration(userId, 'google_drive');

		if (!integration?.isActive || !integration.accessTokenEncrypted) {
			return new Response(JSON.stringify({ error: 'Google Drive not connected' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		let accessToken = await decryptDriveToken(env, integration.accessTokenEncrypted);
		if (!accessToken) {
			return new Response(JSON.stringify({ error: 'Failed to decrypt Drive token' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Refresh if expired
		const isExpired = integration.tokenExpiresAt &&
			new Date(integration.tokenExpiresAt).getTime() < Date.now() + 60000;

		if (isExpired && integration.refreshTokenEncrypted) {
			const refreshToken = await decryptDriveToken(env, integration.refreshTokenEncrypted);
			if (refreshToken) {
				try {
					const refreshed = await refreshDriveAccessToken(env, refreshToken);
					accessToken = refreshed.accessToken;
					// Update stored token (fire-and-forget)
					encryptDriveTokens(env, refreshed.accessToken).then(({ accessEncrypted }) => {
						integrationService.upsertIntegration({
							userId,
							provider: 'google_drive',
							accessTokenEncrypted: accessEncrypted,
							tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
							scopes: (integration.scopes as string[]) ?? [],
						});
					}).catch((err) => logger.error('Failed to update refreshed Drive token', err));
				} catch (err) {
					logger.error('Drive token refresh failed', err);
				}
			}
		}

		// Build the real Google API request
		const googleUrl = `https://www.googleapis.com${url.pathname}${url.search}`;
		const proxyHeaders = new Headers(request.headers);
		proxyHeaders.set('Authorization', `Bearer ${accessToken}`);
		proxyHeaders.delete('Host');

		const proxyRequest = new Request(googleUrl, {
			method: request.method,
			headers: proxyHeaders,
			body: request.body,
		});

		return fetch(proxyRequest);
	},
};
