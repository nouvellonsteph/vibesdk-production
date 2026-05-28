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
