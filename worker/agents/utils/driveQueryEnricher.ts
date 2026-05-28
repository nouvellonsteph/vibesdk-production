/**
 * Drive Query Enricher
 * Detects Google Drive/Sheets/Docs URLs in user prompts and pre-fetches
 * the content so the blueprint generator understands the data structure.
 */

import { createLogger } from '../../logger';
import { IntegrationService } from '../../database/services/IntegrationService';
import { decryptDriveToken } from '../../services/integrations/GoogleDriveOAuth';
import { GoogleDriveService } from '../../services/integrations/GoogleDriveService';
import { env } from 'cloudflare:workers';

const logger = createLogger('DriveQueryEnricher');

/** Regex patterns for Google Drive/Docs/Sheets URLs */
const DRIVE_URL_PATTERNS = [
	// Google Sheets: https://docs.google.com/spreadsheets/d/{ID}/...
	/https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
	// Google Docs: https://docs.google.com/document/d/{ID}/...
	/https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
	// Google Drive file: https://drive.google.com/file/d/{ID}/...
	/https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
	// Google Drive open: https://drive.google.com/open?id={ID}
	/https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
];

interface DriveFileInfo {
	fileId: string;
	fileName: string;
	mimeType: string;
	contentPreview: string;
	format: string;
}

/**
 * Extract Google Drive file IDs from a query string.
 */
export function extractDriveFileIds(query: string): string[] {
	const ids: string[] = [];
	for (const pattern of DRIVE_URL_PATTERNS) {
		const matches = query.matchAll(new RegExp(pattern, 'g'));
		for (const match of matches) {
			if (match[1] && !ids.includes(match[1])) {
				ids.push(match[1]);
			}
		}
	}
	return ids;
}

/**
 * Enrich a user query with Drive file content.
 * Detects Google Drive URLs, fetches the data, and appends a structured
 * description of the data to the query so the LLM can plan accordingly.
 *
 * Returns the original query if no Drive URLs found or user isn't connected.
 */
export async function enrichQueryWithDriveData(
	query: string,
	userId: string,
): Promise<string> {
	const fileIds = extractDriveFileIds(query);
	if (fileIds.length === 0) return query;

	logger.info('Detected Google Drive URLs in query', { fileIds, userId });

	// Check if user has Drive connected
	const integrationService = new IntegrationService(env);
	const integration = await integrationService.getIntegration(userId, 'google_drive');
	if (!integration?.isActive || !integration.accessTokenEncrypted) {
		logger.info('User does not have Drive connected, skipping enrichment');
		return query;
	}

	// Decrypt the access token
	const accessToken = await decryptDriveToken(env, integration.accessTokenEncrypted);
	if (!accessToken) {
		logger.warn('Failed to decrypt Drive token');
		return query;
	}

	const driveService = new GoogleDriveService(accessToken);
	const fetchedFiles: DriveFileInfo[] = [];

	for (const fileId of fileIds) {
		try {
			const file = await driveService.getFile(fileId);
			const { content, format } = await driveService.getFileContent(fileId, file.mimeType);

			// Truncate large files but keep enough for structure analysis
			const maxPreview = 5000;
			const preview = content.length > maxPreview
				? content.substring(0, maxPreview) + '\n\n[... truncated, full data available at runtime via drive.api ...]'
				: content;

			fetchedFiles.push({
				fileId,
				fileName: file.name,
				mimeType: file.mimeType,
				contentPreview: preview,
				format,
			});

			logger.info('Fetched Drive file for query enrichment', {
				fileId,
				fileName: file.name,
				mimeType: file.mimeType,
				contentLength: content.length,
			});
		} catch (error) {
			logger.error('Failed to fetch Drive file', { fileId, error });
		}
	}

	if (fetchedFiles.length === 0) return query;

	// Build the enriched query with data context
	let enrichedQuery = query;
	enrichedQuery += '\n\n<GOOGLE_DRIVE_DATA_CONTEXT>';
	enrichedQuery += '\nThe user referenced the following Google Drive file(s). ';
	enrichedQuery += 'Use the data structure below to plan the application. ';
	enrichedQuery += 'At RUNTIME, the app should fetch fresh data from http://drive.api/ (authentication handled transparently by the platform). ';
	enrichedQuery += 'NEVER hardcode this data or embed any tokens.\n';

	for (const file of fetchedFiles) {
		enrichedQuery += `\n--- File: ${file.fileName} (${file.mimeType}) ---\n`;
		enrichedQuery += `File ID: ${file.fileId}\n`;
		enrichedQuery += `Format: ${file.format}\n`;
		enrichedQuery += `Runtime URL: http://drive.api/drive/v3/files/${file.fileId}/export?mimeType=${file.format === 'csv' ? 'text/csv' : 'text/plain'}\n`;
		enrichedQuery += `\nData preview:\n${file.contentPreview}\n`;
	}

	enrichedQuery += '\n</GOOGLE_DRIVE_DATA_CONTEXT>';

	return enrichedQuery;
}
