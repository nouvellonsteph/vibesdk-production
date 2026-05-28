/**
 * Google Drive OAuth Provider
 * Handles incremental consent for Google Drive/Docs access.
 * Separate from the login OAuth flow -- requests additional scopes.
 */

import { createLogger } from '../../logger';
import { createDatabaseService } from '../../database/database';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

const logger = createLogger('GoogleDriveOAuth');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface DriveOAuthCredentials {
	clientId: string;
	clientSecret: string;
	enabled: boolean;
}

/**
 * Load Google Drive OAuth credentials from system settings (D1).
 * Falls back to env vars for backward compatibility.
 */
async function getDriveCredentials(env: Env): Promise<DriveOAuthCredentials> {
	try {
		const db = createDatabaseService(env);
		const settings = await db.db
			.select()
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.key, 'integration_config'))
			.get();

		const config = settings?.value as Record<string, unknown> | undefined;
		const drive = config?.googleDrive as Record<string, unknown> | undefined;

		if (drive?.clientId && drive?.clientSecret) {
			return {
				clientId: drive.clientId as string,
				clientSecret: drive.clientSecret as string,
				enabled: drive.enabled === true,
			};
		}
	} catch {
		// Fall through to env vars
	}

	// Fallback to env vars
	return {
		clientId: env.GOOGLE_CLIENT_ID || '',
		clientSecret: env.GOOGLE_CLIENT_SECRET || '',
		enabled: true,
	};
}

/** Scopes for Google Drive read access */
const DRIVE_SCOPES = [
	'https://www.googleapis.com/auth/drive.readonly',
	'https://www.googleapis.com/auth/documents.readonly',
	'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export interface DriveTokens {
	accessToken: string;
	refreshToken?: string;
	expiresIn: number;
	scope: string;
}

/**
 * Get the Drive integration status for a user:
 * - configured: admin has set client_id/secret
 * - enabled: admin has toggled it on
 * - tierAllowed: user's tier has canUseGoogleDrive
 */
export async function getDriveConfigStatus(
	env: Env,
	userId: string
): Promise<{ configured: boolean; enabled: boolean; tierAllowed: boolean }> {
	const creds = await getDriveCredentials(env);
	const configured = !!(creds.clientId && creds.clientSecret);
	const enabled = creds.enabled && configured;

	// Check tier -- admins always have access
	let tierAllowed = false;
	try {
		// Check if user is admin (bypass tier check)
		const { createDatabaseService } = await import('../../database/database');
		const db = createDatabaseService(env);
		const { eq } = await import('drizzle-orm');
		const { users } = await import('../../database/schema');
		const user = await db.db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
		if (user?.role === 'admin') {
			tierAllowed = true;
		} else {
			const { TierService } = await import('../../database/services/TierService');
			const tierService = new TierService(env);
			const limits = await tierService.getUserEffectiveLimits(userId);
			tierAllowed = limits.features.canUseGoogleDrive;
		}
	} catch {
		// Tier check failed, default to false
	}

	return { configured, enabled, tierAllowed };
}

/**
 * Build the OAuth authorization URL for Google Drive consent.
 * Reads credentials from admin-configured system settings.
 */
export async function buildDriveAuthUrl(env: Env, redirectUri: string, state: string): Promise<string> {
	const creds = await getDriveCredentials(env);
	if (!creds.enabled) {
		throw new Error('Google Drive integration is not enabled by the administrator');
	}
	if (!creds.clientId) {
		throw new Error('Google Drive OAuth client ID is not configured. Contact your administrator.');
	}

	const params = new URLSearchParams({
		client_id: creds.clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: DRIVE_SCOPES.join(' '),
		access_type: 'offline',
		prompt: 'consent',
		state,
		include_granted_scopes: 'true',
	});

	return `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForDriveTokens(
	env: Env,
	code: string,
	redirectUri: string
): Promise<DriveTokens> {
	const creds = await getDriveCredentials(env);
	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: creds.clientId,
			client_secret: creds.clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
		}),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error('Token exchange failed', { status: response.status, error });
		throw new Error(`Google token exchange failed: ${error}`);
	}

	const data = await response.json() as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
		scope: string;
		token_type: string;
	};

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
		scope: data.scope,
	};
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshDriveAccessToken(
	env: Env,
	refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
	const creds = await getDriveCredentials(env);
	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: creds.clientId,
			client_secret: creds.clientSecret,
			grant_type: 'refresh_token',
		}),
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error('Token refresh failed', { status: response.status, error });
		throw new Error(`Google token refresh failed: ${error}`);
	}

	const data = await response.json() as {
		access_token: string;
		expires_in: number;
	};

	return {
		accessToken: data.access_token,
		expiresIn: data.expires_in,
	};
}

/**
 * Derive an AES-GCM key from the ENTROPY_KEY env var for Drive token encryption.
 */
async function getDriveEncryptionKey(env: Env): Promise<CryptoKey> {
	const keyMaterial = new TextEncoder().encode(env.ENTROPY_KEY || env.JWT_SECRET || 'fallback-key');
	const hash = await crypto.subtle.digest('SHA-256', keyMaterial);
	return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a token string for storage in the database.
 */
async function encryptString(env: Env, plaintext: string): Promise<string> {
	const key = await getDriveEncryptionKey(env);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
	// Combine IV + ciphertext and base64 encode
	const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.length);
	return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a stored token string.
 */
async function decryptString(env: Env, encrypted: string): Promise<string | null> {
	try {
		const key = await getDriveEncryptionKey(env);
		const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
		const iv = combined.slice(0, 12);
		const ciphertext = combined.slice(12);
		const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
		return new TextDecoder().decode(plaintext);
	} catch {
		return null;
	}
}

/**
 * Encrypt tokens for storage in the database.
 */
export async function encryptDriveTokens(
	env: Env,
	accessToken: string,
	refreshToken?: string
): Promise<{ accessEncrypted: string; refreshEncrypted?: string }> {
	const accessEncrypted = await encryptString(env, accessToken);
	let refreshEncrypted: string | undefined;
	if (refreshToken) {
		refreshEncrypted = await encryptString(env, refreshToken);
	}
	return { accessEncrypted, refreshEncrypted };
}

/**
 * Decrypt a stored token.
 */
export async function decryptDriveToken(
	env: Env,
	encrypted: string
): Promise<string | null> {
	return decryptString(env, encrypted);
}
