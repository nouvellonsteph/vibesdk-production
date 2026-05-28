/**
 * Cloudflare Access Managed OAuth Client
 *
 * Implements RFC 9728 resource metadata discovery, dynamic client registration,
 * and authorization code + PKCE flow for authenticating with Access-protected
 * preview subdomains from the browser.
 */

// ============================================================================
// Types
// ============================================================================

interface ResourceMetadata {
	resource: string;
	protected: boolean;
	team_domain: string;
	authorization_servers: string[];
}

interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	revocation_endpoint?: string;
	response_types_supported: string[];
	grant_types_supported: string[];
	token_endpoint_auth_methods_supported: string[];
	code_challenge_methods_supported: string[];
}

interface ClientRegistration {
	client_id: string;
	redirect_uris: string[];
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	resource?: string;
}

interface StoredToken {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	clientId: string;
	tokenEndpoint: string;
	resource: string;
}

// ============================================================================
// PKCE Helpers
// ============================================================================

function base64url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64url(array.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64url(digest);
}

/**
 * Generate PKCE pair where challenge starts with alphanumeric.
 * Access's OAuth server can fail if the challenge starts with - or _.
 */
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
	for (let i = 0; i < 20; i++) {
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);
		if (/^[a-zA-Z0-9]/.test(challenge)) {
			return { verifier, challenge };
		}
	}
	// Fallback -- very unlikely to need 20 attempts
	const verifier = generateCodeVerifier();
	const challenge = await generateCodeChallenge(verifier);
	return { verifier, challenge };
}

// ============================================================================
// Storage (sessionStorage per tab)
// ============================================================================

const TOKEN_STORAGE_KEY = 'access_oauth_tokens';
const CLIENT_STORAGE_KEY = 'access_oauth_clients';

function getStoredTokens(): Record<string, StoredToken> {
	try {
		const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function storeToken(domain: string, token: StoredToken): void {
	try {
		const tokens = getStoredTokens();
		tokens[domain] = token;
		sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
	} catch {
		// sessionStorage full or unavailable
	}
}

function getStoredClients(): Record<string, ClientRegistration> {
	try {
		const raw = sessionStorage.getItem(CLIENT_STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function storeClient(domain: string, client: ClientRegistration): void {
	try {
		const clients = getStoredClients();
		clients[domain] = client;
		sessionStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(clients));
	} catch {
		// sessionStorage full or unavailable
	}
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Check if a URL is protected by Cloudflare Access with Managed OAuth.
 * Returns the resource metadata URL if protected, null otherwise.
 */
export async function detectAccessProtection(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			mode: 'cors',
			cache: 'no-cache',
			credentials: 'include',
			signal: AbortSignal.timeout(8000),
		});

		if (response.status === 401 || response.status === 302) {
			const wwwAuth = response.headers.get('www-authenticate');
			if (wwwAuth) {
				const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
				if (match) return match[1];
			}
		}

		// Also check for redirect to cloudflareaccess.com (302 case)
		if (response.redirected && response.url.includes('cloudflareaccess.com')) {
			// Try fetching the well-known endpoint directly
			const origin = new URL(url).origin;
			const metadataUrl = `${origin}/.well-known/cloudflare-access-protected-resource/`;
			const metaRes = await fetch(metadataUrl, {
				signal: AbortSignal.timeout(5000),
			}).catch(() => null);
			if (metaRes?.ok) return metadataUrl;
		}

		return null;
	} catch {
		return null;
	}
}

async function fetchResourceMetadata(metadataUrl: string): Promise<ResourceMetadata> {
	const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error(`Failed to fetch resource metadata: ${response.status}`);
	return response.json();
}

async function fetchOAuthServerMetadata(authServer: string): Promise<OAuthServerMetadata> {
	const url = `${authServer}/.well-known/oauth-authorization-server`;
	const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
	if (!response.ok) throw new Error(`Failed to fetch OAuth server metadata: ${response.status}`);
	return response.json();
}

// ============================================================================
// Client Registration
// ============================================================================

async function registerClient(
	registrationEndpoint: string,
	redirectUri: string,
	resource: string,
): Promise<ClientRegistration> {
	const response = await fetch(registrationEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			resource,
		}),
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Client registration failed: ${response.status} ${body}`);
	}
	return response.json();
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Get a valid Access token for a preview domain.
 * Returns the token if cached and not expired, null if auth is needed.
 */
export function getAccessToken(previewUrl: string): string | null {
	const domain = new URL(previewUrl).hostname;
	const tokens = getStoredTokens();
	const stored = tokens[domain];
	if (!stored) return null;

	// Check expiry with 60s buffer
	if (Date.now() > stored.expiresAt - 60_000) {
		return null; // Expired or about to expire
	}

	return stored.accessToken;
}

/**
 * Try to refresh an expired token.
 * Returns the new access token or null if refresh fails.
 */
export async function refreshAccessToken(previewUrl: string): Promise<string | null> {
	const domain = new URL(previewUrl).hostname;
	const tokens = getStoredTokens();
	const stored = tokens[domain];
	if (!stored?.refreshToken) return null;

	try {
		const response = await fetch(stored.tokenEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: stored.refreshToken,
				client_id: stored.clientId,
			}),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) return null;

		const tokenData: TokenResponse = await response.json();
		const newStored: StoredToken = {
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token ?? stored.refreshToken,
			expiresAt: Date.now() + tokenData.expires_in * 1000,
			clientId: stored.clientId,
			tokenEndpoint: stored.tokenEndpoint,
			resource: stored.resource,
		};
		storeToken(domain, newStored);
		return newStored.accessToken;
	} catch {
		return null;
	}
}

// ============================================================================
// Authorization Flow (popup-based)
// ============================================================================

const CALLBACK_PATH = '/access-oauth-callback';

/**
 * Get the redirect URI for the OAuth callback.
 * Uses a path on the main domain that serves a simple HTML page to capture the code.
 */
function getRedirectUri(): string {
	return `${window.location.origin}${CALLBACK_PATH}`;
}

/**
 * Initiate the full OAuth flow for a preview URL.
 * Opens a popup for the user to authenticate with their IdP.
 * Returns the access token on success.
 */
export async function authenticatePreview(previewUrl: string): Promise<string> {
	const previewOrigin = new URL(previewUrl).origin;
	const domain = new URL(previewUrl).hostname;

	// Step 1: Fetch resource metadata
	const metadataUrl = `${previewOrigin}/.well-known/cloudflare-access-protected-resource/`;
	const resourceMeta = await fetchResourceMetadata(metadataUrl);

	if (!resourceMeta.authorization_servers?.length) {
		throw new Error('No authorization servers found in resource metadata');
	}

	// Step 2: Fetch OAuth server metadata
	const authServer = resourceMeta.authorization_servers[0];
	const serverMeta = await fetchOAuthServerMetadata(authServer);

	if (!serverMeta.registration_endpoint) {
		throw new Error('Dynamic client registration not enabled on Access application');
	}

	// Step 3: Register client (or use cached)
	const redirectUri = getRedirectUri();
	let client = getStoredClients()[domain];
	if (!client) {
		client = await registerClient(
			serverMeta.registration_endpoint,
			redirectUri,
			resourceMeta.resource,
		);
		storeClient(domain, client);
	}

	// Step 4: Generate PKCE
	const pkce = await generatePkce();

	// Step 5: Open popup for authorization
	const state = base64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
	const authUrl = new URL(serverMeta.authorization_endpoint);
	authUrl.searchParams.set('client_id', client.client_id);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('code_challenge', pkce.challenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');
	authUrl.searchParams.set('resource', resourceMeta.resource);
	authUrl.searchParams.set('state', state);

	const code = await openAuthPopup(authUrl.toString(), state);

	// Step 6: Exchange code for token
	const tokenResponse = await fetch(serverMeta.token_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: client.client_id,
			redirect_uri: redirectUri,
			code_verifier: pkce.verifier,
		}),
		signal: AbortSignal.timeout(15000),
	});

	if (!tokenResponse.ok) {
		const body = await tokenResponse.text();
		throw new Error(`Token exchange failed: ${tokenResponse.status} ${body}`);
	}

	const tokenData: TokenResponse = await tokenResponse.json();

	// Step 7: Store token
	const stored: StoredToken = {
		accessToken: tokenData.access_token,
		refreshToken: tokenData.refresh_token,
		expiresAt: Date.now() + tokenData.expires_in * 1000,
		clientId: client.client_id,
		tokenEndpoint: serverMeta.token_endpoint,
		resource: resourceMeta.resource,
	};
	storeToken(domain, stored);

	return tokenData.access_token;
}

/**
 * Open a popup window for OAuth authorization and wait for the callback.
 * Returns the authorization code.
 */
function openAuthPopup(authUrl: string, expectedState: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const width = 600;
		const height = 700;
		const left = window.screenX + (window.outerWidth - width) / 2;
		const top = window.screenY + (window.outerHeight - height) / 2;

		const popup = window.open(
			authUrl,
			'access_oauth_popup',
			`width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
		);

		if (!popup) {
			reject(new Error('Popup blocked. Please allow popups for this site.'));
			return;
		}

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Authentication timed out'));
		}, 120_000);

		const interval = setInterval(() => {
			if (popup.closed) {
				cleanup();
				reject(new Error('Authentication popup was closed'));
			}
		}, 500);

		function cleanup() {
			clearTimeout(timeout);
			clearInterval(interval);
			window.removeEventListener('message', onMessage);
		}

		function onMessage(event: MessageEvent) {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== 'access-oauth-callback') return;

			const { code, state, error } = event.data;

			if (error) {
				cleanup();
				popup.close();
				reject(new Error(`OAuth error: ${error}`));
				return;
			}

			if (state !== expectedState) {
				cleanup();
				popup.close();
				reject(new Error('OAuth state mismatch'));
				return;
			}

			if (code) {
				cleanup();
				popup.close();
				resolve(code);
			}
		}

		window.addEventListener('message', onMessage);
	});
}

/**
 * Call this from the OAuth callback page to send the code back to the opener.
 */
export function handleOAuthCallback(): void {
	const params = new URLSearchParams(window.location.search);
	const code = params.get('code');
	const state = params.get('state');
	const error = params.get('error');
	const errorDescription = params.get('error_description');

	if (window.opener) {
		window.opener.postMessage(
			{
				type: 'access-oauth-callback',
				code,
				state,
				error: error ? `${error}: ${errorDescription || ''}` : undefined,
			},
			window.location.origin,
		);
	}
}
