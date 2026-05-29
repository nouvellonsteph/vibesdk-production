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

import { Sandbox, ContainerProxy } from '@cloudflare/sandbox';
import { createLogger } from '../../logger';
import { IntegrationService } from '../../database/services/IntegrationService';
import {
	decryptDriveToken,
	refreshDriveAccessToken,
	encryptDriveTokens,
} from '../integrations/GoogleDriveOAuth';

// ContainerProxy must be re-exported from the Worker entrypoint
// for outbound request interception to work.
export { ContainerProxy };

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
 * Two modes controlled by admin:
 * 1. AUDIT mode (enableInternet=true): All traffic allowed, every request logged
 *    to KV for admin review. Admin can then create rules from real traffic.
 * 2. ENFORCE mode (enableInternet=false): Only system-required hosts and
 *    admin-configured allow rules permitted. Deny rules block specific hosts.
 *
 * Mode is set at runtime via the egress configuration in system_settings.
 */
export class UserAppSandboxService extends Sandbox {
	// Default to enforce mode. Audit mode is set at runtime.
	enableInternet = false;
	allowedHosts = SYSTEM_REQUIRED_HOSTS;
}

/**
 * Outbound handler: logs all outbound HTTP/HTTPS traffic.
 * In audit mode (enableInternet=true), captures ALL traffic for admin review.
 * In enforce mode (enableInternet=false), captures only allowed-host traffic.
 * Must be assigned outside the class body per Sandbox SDK convention.
 */
UserAppSandboxService.outbound = async function outboundLogger(
	request: Request,
	env: unknown,
	ctx: { containerId: string }
): Promise<Response> {
	const url = new URL(request.url);
	const envTyped = env as { VibecoderStore: KVNamespace };

	// Log the outbound request to KV for admin audit
	try {
		const logEntry = {
			host: url.hostname,
			method: request.method,
			path: url.pathname,
			containerId: ctx.containerId,
			timestamp: new Date().toISOString(),
		};

		// Append to a rolling log list in KV (fire-and-forget)
		const logKey = `egress_log:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
		envTyped.VibecoderStore.put(logKey, JSON.stringify(logEntry), {
			expirationTtl: 86400,
		}).catch(() => {});

		// Also maintain a host frequency counter for the admin dashboard
		const counterKey = `egress_host:${url.hostname}`;
		const current = await envTyped.VibecoderStore.get(counterKey);
		const count = current ? parseInt(current, 10) + 1 : 1;
		envTyped.VibecoderStore.put(counterKey, String(count), {
			expirationTtl: 86400,
		}).catch(() => {});
	} catch {
		// Logging failure should never block traffic
	}

	// Forward the request to the internet
	return fetch(request);
};

/**
 * Outbound handler for drive.api virtual host.
 * Intercepts requests to `drive.api`, looks up the user's Google Drive
 * OAuth token from D1, injects it as an Authorization header, and
 * forwards the request to the real Google APIs endpoint.
 *
 * The user's token is never exposed to the sandbox -- the generated app
 * simply calls `http://drive.api/drive/v3/files` and this handler adds auth.
 */
async function driveProxyHandler(
	request: Request,
	env: Env,
	ctx: { containerId: string }
): Promise<Response> {
	const url = new URL(request.url);
	logger.info('Drive API proxy request', {
		containerId: ctx.containerId,
		path: url.pathname,
		method: request.method,
	});

	const userId = await env.VibecoderStore.get(`sandbox_user:${ctx.containerId}`);
	if (!userId) {
		logger.warn('No user mapping for container', { containerId: ctx.containerId });
		return new Response(JSON.stringify({ error: 'Drive integration not configured' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
	}

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
				encryptDriveTokens(env, refreshed.accessToken).then(({ accessEncrypted }) => {
					integrationService.upsertIntegration({
						userId,
						provider: 'google_drive',
						accessTokenEncrypted: accessEncrypted,
						tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
						scopes: (integration.scopes as string[]) ?? [],
					});
				}).catch((err: unknown) => logger.error('Failed to update refreshed Drive token', err));
			} catch (err) {
				logger.error('Drive token refresh failed', err);
			}
		}
	}

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
}

/**
 * Named outbound handlers for runtime assignment via setOutboundByHost().
 * The 'driveProxy' handler is assigned to 'drive.api' at sandbox creation
 * when the user has Google Drive connected.
 */
UserAppSandboxService.outboundHandlers = {
	driveProxy: driveProxyHandler,
};

export { driveProxyHandler };
