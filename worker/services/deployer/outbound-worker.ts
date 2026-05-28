/**
 * WfP Outbound Worker
 * Intercepts outgoing fetch() requests from deployed user Workers.
 * Handles drive.api virtual host by injecting the user's Google Drive
 * OAuth token from KV/D1.
 *
 * This worker is configured as the outbound service on the dispatch namespace.
 * It receives parameters (app_name) from the dispatcher.get() call.
 */

export default {
	async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
		const url = new URL(request.url);

		// Only intercept requests to the drive.api virtual host
		if (url.hostname === 'drive.api') {
			// Get the app name from dispatcher parameters
			const appName = env.app_name as string | undefined;

			if (!appName) {
				return new Response(
					JSON.stringify({ error: 'Drive API proxy: missing app context' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Look up the user ID for this app from KV
			const kv = env.VibecoderStore as KVNamespace | undefined;
			if (!kv) {
				return new Response(
					JSON.stringify({ error: 'Drive API proxy: KV not available' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				);
			}

			const userId = await kv.get(`app_user:${appName}`);
			if (!userId) {
				return new Response(
					JSON.stringify({ error: 'Drive API proxy: no user mapping for this app' }),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Get the Drive access token from KV (cached by the platform)
			const tokenData = await kv.get(`drive_token:${userId}`);
			if (!tokenData) {
				return new Response(
					JSON.stringify({ error: 'Google Drive not connected for this user' }),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}

			// Build the real Google API request
			const googleUrl = `https://www.googleapis.com${url.pathname}${url.search}`;
			const proxyHeaders = new Headers(request.headers);
			proxyHeaders.set('Authorization', `Bearer ${tokenData}`);
			proxyHeaders.delete('Host');

			return fetch(new Request(googleUrl, {
				method: request.method,
				headers: proxyHeaders,
				body: request.body,
			}));
		}

		// Pass through all other requests
		return fetch(request);
	},
};
