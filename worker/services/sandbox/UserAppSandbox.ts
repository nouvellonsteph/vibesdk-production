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

// ContainerProxy must be exported from the Worker entry point
export { ContainerProxy };

const logger = createLogger('UserAppSandbox');

/**
 * Sandbox with egress filtering for user-generated apps.
 * Internet is disabled by default. Allowed hosts are set at runtime
 * via setAllowedHosts() after loading admin-configured egress rules.
 */
export class UserAppSandboxService extends Sandbox {
	// Deny all outbound traffic by default.
	// Allowed hosts are set at runtime via setAllowedHosts().
	enableInternet = false;
}

/**
 * Outbound handler: intercepts all HTTP/HTTPS traffic leaving the sandbox.
 * Runs in the Workers runtime (outside the sandbox) so it has access to
 * env bindings and can log/audit without the sandbox seeing the code.
 *
 * This handler is invoked for traffic to hosts in the allowedHosts list.
 * Traffic to hosts NOT in allowedHosts is blocked before reaching this handler.
 */
UserAppSandboxService.outbound = async (
	request: Request,
	_env: Env,
	ctx: { containerId: string }
) => {
	const url = new URL(request.url);
	logger.info('Sandbox outbound request', {
		containerId: ctx.containerId,
		host: url.hostname,
		method: request.method,
		path: url.pathname,
	});

	// Forward the request to the actual destination
	return fetch(request);
};
