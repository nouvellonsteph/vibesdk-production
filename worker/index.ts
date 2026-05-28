import { createLogger } from './logger';
import { isDispatcherAvailable } from './utils/dispatcherUtils';
import { createApp } from './app';
// import * as Sentry from '@sentry/cloudflare';
// import { sentryOptions } from './observability/sentry';
import { DORateLimitStore as BaseDORateLimitStore } from './services/rate-limit/DORateLimitStore';
import { getPreviewDomain } from './utils/urls';
import { proxyToAiGateway } from './services/aigateway-proxy/controller';
import { isOriginAllowed } from './config/security';
import { proxyToSandbox } from './services/sandbox/request-handler';
import { handleGitProtocolRequest, isGitProtocolRequest } from './api/handlers/git-protocol';
import { getAgentStub } from './agents';
import { authMiddleware } from './middleware/auth/auth';

// Durable Object and Service exports
export { UserAppSandboxService } from './services/sandbox/sandboxSdkClient';
export { CodeGeneratorAgent } from './agents/core/codingAgent';
export { UserSecretsStore } from './services/secrets/UserSecretsStore';

// export const CodeGeneratorAgent = Sentry.instrumentDurableObjectWithSentry(sentryOptions, CodeGeneratorAgent);
// export const DORateLimitStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, BaseDORateLimitStore);
export const DORateLimitStore = BaseDORateLimitStore;

// Logger for the main application and handlers
const logger = createLogger('App');

function setOriginControl(env: Env, request: Request, currentHeaders: Headers): Headers {
    const origin = request.headers.get('Origin');
    
    if (origin && isOriginAllowed(env, origin)) {
        currentHeaders.set('Access-Control-Allow-Origin', origin);
        currentHeaders.set('Access-Control-Allow-Credentials', 'true');
    }
    return currentHeaders;
}

/**
 * Handles requests for user-deployed applications on subdomains.
 * It first attempts to proxy to a live development sandbox. If that fails,
 * it dispatches the request to a permanently deployed worker via namespaces.
 * This function will NOT fall back to the main worker.
 *
 * @param request The incoming Request object.
 * @param env The environment bindings.
 * @returns A Response object from the sandbox, the dispatched worker, or an error.
 */
async function handleUserAppRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const { hostname } = url;
	logger.info(`Handling user app request for: ${hostname}`, { url: url.href, method: request.method });

	// Check if this is an agent browser file serving request
	// Pattern: b-{agentid}-{token}.{previewDomain}
	const subdomain = hostname.split('.')[0];
	if (subdomain.startsWith('b-')) {
		// Extract agentId and token from subdomain
		const withoutPrefix = subdomain.substring(2); // Remove 'b-'
		const lastHyphenIndex = withoutPrefix.lastIndexOf('-');

		if (lastHyphenIndex !== -1) {
			const agentId = withoutPrefix.substring(0, lastHyphenIndex);
			logger.info(`Agent browser file serving request for agent: ${agentId}`);

			try {
				const agentStub = await getAgentStub(env, agentId);
				return await agentStub.handleBrowserFileServing(request);
			} catch (error: any) {
				logger.error(`Error forwarding to agent: ${error.message}`);
				return new Response('Agent not found', { status: 404 });
			}
		}
	}

	// 1. Attempt to proxy to a live development sandbox.
	// proxyToSandbox doesn't consume the request body on a miss, so no clone is needed here.
	const sandboxResponse = await proxyToSandbox(request, env);
	if (sandboxResponse) {
		logger.info(`Serving response from sandbox for: ${hostname}`);
        // If it was a websocket upgrade, we need to return the response as is
        if (sandboxResponse.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
            logger.info(`Serving websocket response from sandbox for: ${hostname}`);
            return sandboxResponse;
        }
		
		// Add headers to identify this as a sandbox response
		let headers = new Headers(sandboxResponse.headers);
		
        if (sandboxResponse.status === 500) {
            headers.set('X-Preview-Type', 'sandbox-error');
        } else {
            headers.set('X-Preview-Type', 'sandbox');
        }
        // Remove iframe-blocking headers so the preview loads in the main app's iframe
        headers.delete('X-Frame-Options');
        headers.delete('Content-Security-Policy');
        headers = setOriginControl(env, request, headers);
        headers.append('Vary', 'Origin');
		headers.set('Access-Control-Expose-Headers', 'X-Preview-Type');
		
		return new Response(sandboxResponse.body, {
			status: sandboxResponse.status,
			statusText: sandboxResponse.statusText,
			headers,
		});
	}

	// 2. If sandbox misses, attempt to dispatch to a deployed worker.
	logger.info(`Sandbox miss for ${hostname}, attempting dispatch to permanent worker.`);
	if (!isDispatcherAvailable(env)) {
		logger.warn(`Dispatcher not available, cannot serve: ${hostname}`);
		return new Response('This application is not currently available.', { status: 404 });
	}

	// Extract the app name (e.g., "xyz" from "xyz.build.cloudflare.dev").
	const appName = subdomain;
	const dispatcher = env['DISPATCHER'];

	try {
		const worker = dispatcher.get(appName);
		const dispatcherResponse = await worker.fetch(request);

		// Add headers to identify this as a dispatcher response
		let headers = new Headers(dispatcherResponse.headers);

		headers.set('X-Preview-Type', 'dispatcher');
        headers = setOriginControl(env, request, headers);
        headers.append('Vary', 'Origin');
		headers.set('Access-Control-Expose-Headers', 'X-Preview-Type');

		return new Response(dispatcherResponse.body, {
			status: dispatcherResponse.status,
			statusText: dispatcherResponse.statusText,
			headers,
		});
	} catch (error: any) {
		// This block catches errors if the binding doesn't exist or if worker.fetch() fails.
		logger.warn(`Error dispatching to worker '${appName}': ${error.message}`);

		return new Response('An error occurred while loading this application.', { status: 500 });
	}
}

/**
 * Main Worker fetch handler with robust, secure routing.
 */
const worker = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // logger.info(`Received request: ${request.method} ${request.url}`);
		// --- Pre-flight Checks ---

		// 1. Critical configuration check: Ensure custom domain is set.
        const previewDomain = getPreviewDomain(env);
		if (!previewDomain || previewDomain.trim() === '') {
			logger.error('FATAL: env.CUSTOM_DOMAIN is not configured in wrangler.toml or the Cloudflare dashboard.');
			return new Response('Server configuration error: Application domain is not set.', { status: 500 });
		}

		const url = new URL(request.url);
		const { hostname, pathname } = url;

		// 2. Security: Immediately reject any requests made via an IP address.
		const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
		if (ipRegex.test(hostname)) {
			return new Response('Access denied. Please use the assigned domain name.', { status: 403 });
		}

		// --- Domain-based Routing ---

		// Normalize hostnames for both local development (localhost) and production.
		const isMainDomainRequest =
			hostname === env.CUSTOM_DOMAIN || hostname === 'localhost';
		const isSubdomainRequest =
			hostname.endsWith(`.${previewDomain}`) ||
			(hostname.endsWith('.localhost') && hostname !== 'localhost');

		// Route 1: Main Platform Request (e.g., build.cloudflare.dev or localhost)
		if (isMainDomainRequest) {
			// Handle Git protocol endpoints directly
			// Route: /apps/:id.git/info/refs or /apps/:id.git/git-upload-pack
			if (isGitProtocolRequest(pathname)) {
				return handleGitProtocolRequest(request, env, ctx);
			}
			
			// Cloudflare OAuth connect routes: handle via Hono app even though they are not under /api
			if (pathname.startsWith('/oauth/') || pathname === '/auth/callback') {
				// Do not log the full URL: /auth/callback carries sensitive
				// query params (code, state) that must not end up in logs.
				logger.info(`Handling Cloudflare OAuth request for: ${pathname}`);
				const app = createApp(env);
				return app.fetch(request, env, ctx);
			}
			
			// Preview proxy: serves sandbox content through the main domain to bypass Cloudflare Access.
			// The iframe loads /api/sandbox-preview/{port-sessionId-token}/* instead of the subdomain directly.
			if (pathname.startsWith('/api/sandbox-preview/')) {
				// Require authentication before proxying to prevent open-proxy abuse
				const userSession = await authMiddleware(request, env);
				if (!userSession) {
					return new Response('Authentication required', { status: 401 });
				}

				const proxyPath = pathname.replace('/api/sandbox-preview/', '');
				const slashIdx = proxyPath.indexOf('/');
				const subdomain = slashIdx === -1 ? proxyPath : proxyPath.substring(0, slashIdx);
				const resourcePath = slashIdx === -1 ? '/' : proxyPath.substring(slashIdx);

				if (!subdomain) {
					return new Response('Missing preview subdomain', { status: 400 });
				}

				// Build a fake request with the subdomain hostname so proxyToSandbox can parse it.
				// Forward any Authorization header (Access OAuth token) from the client.
				const previewDomain = getPreviewDomain(env);
				const fakeUrl = new URL(request.url);
				fakeUrl.hostname = `${subdomain}.${previewDomain}`;
				fakeUrl.pathname = resourcePath;
				const fakeHeaders = new Headers(request.headers);
				// Pass through the Access token from query param if present (for iframe src)
				const accessToken = url.searchParams.get('cf_access_token');
				if (accessToken) {
					fakeHeaders.set('Authorization', `Bearer ${accessToken}`);
				}
				const fakeRequest = new Request(fakeUrl.toString(), {
					method: request.method,
					headers: fakeHeaders,
					body: request.body,
					// @ts-expect-error - duplex needed for body streaming
					duplex: 'half',
				});

				const sandboxResponse = await proxyToSandbox(fakeRequest, env);
				if (sandboxResponse) {
					const headers = new Headers(sandboxResponse.headers);
					headers.delete('X-Frame-Options');
					headers.delete('Content-Security-Policy');

					return new Response(sandboxResponse.body, {
						status: sandboxResponse.status,
						statusText: sandboxResponse.statusText,
						headers,
					});
				}
				return new Response('Preview not available', { status: 502 });
			}
			
			// Serve static assets for all other non-API routes from the ASSETS binding.
			if (!pathname.startsWith('/api/')) {
				return env.ASSETS.fetch(request);
			}
			// AI Gateway proxy for generated apps
			if (pathname.startsWith('/api/proxy/openai')) {
                // Only handle requests from valid origins of the preview domain
                const origin = request.headers.get('Origin');
                const previewDomain = getPreviewDomain(env);

                logger.info(`Origin: ${origin}, Preview Domain: ${previewDomain}`);

                return proxyToAiGateway(request, env, ctx);
				// if (origin && origin.endsWith(`.${previewDomain}`)) {
                //     return proxyToAiGateway(request, env, ctx);
                // }
                // logger.warn(`Access denied. Invalid origin: ${origin}, preview domain: ${previewDomain}`);
                // return new Response('Access denied. Invalid origin.', { status: 403 });
			}

			// Handle all API requests with the main Hono application.
			// Log pathname only: some API routes (e.g. /api/auth/callback/:provider)
			// carry sensitive query params like `code`/`state`.
			logger.info(`Handling API request for: ${pathname}`);
			const app = createApp(env);
			return app.fetch(request, env, ctx);
		}

		// Route 2: User App Request (e.g., xyz.build.cloudflare.dev or test.localhost)
		if (isSubdomainRequest) {
			// Handle CORS preflight for preview subdomains (Access bypasses OPTIONS to origin)
			if (request.method === 'OPTIONS') {
				const origin = request.headers.get('Origin');
				if (origin && isOriginAllowed(env, origin)) {
					return new Response(null, {
						status: 204,
						headers: {
							'Access-Control-Allow-Origin': origin,
							'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
							'Access-Control-Allow-Headers': 'Authorization, Content-Type',
							'Access-Control-Allow-Credentials': 'true',
							'Access-Control-Max-Age': '86400',
						},
					});
				}
			}
			return handleUserAppRequest(request, env);
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

export default worker;

// Wrap the entire worker with Sentry for comprehensive error monitoring.
// export default Sentry.withSentry(sentryOptions, worker);
