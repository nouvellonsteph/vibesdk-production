/**
 * Google Drive OAuth Provider
 * Handles incremental consent for Google Drive/Docs access.
 * Separate from the login OAuth flow -- requests additional scopes.
 */

import { createLogger } from '../../logger';
import { encryptTokens, decryptTokens, type EncryptedTokenData } from '../../utils/tokenEncryption';
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
 * Encrypt tokens for storage in the database.
 */
export async function encryptDriveTokens(
	env: Env,
	accessToken: string,
	refreshToken?: string
): Promise<{ accessEncrypted: string; refreshEncrypted?: string }> {
	const accessData: EncryptedTokenData = {
		accessToken,
		userId: '', // not used for this encryption, just the token
		expiresAt: Date.now() + 3600 * 1000,
	};
	const accessEncrypted = await encryptTokens(accessData, env);

	let refreshEncrypted: string | undefined;
	if (refreshToken) {
		const refreshData: EncryptedTokenData = {
			accessToken: refreshToken,
			userId: '',
			expiresAt: 0, // refresh tokens don't expire from our perspective
		};
		refreshEncrypted = await encryptTokens(refreshData, env);
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
	const data = await decryptTokens(encrypted, env);
	return data?.accessToken ?? null;
}
