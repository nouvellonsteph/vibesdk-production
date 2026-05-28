/**
 * Google Drive Agent Tools
 * Provides the AI coding agent with ability to search and read
 * files from the user's Google Drive when the integration is active.
 */

import { tool, t } from '../types';
import { GoogleDriveService } from '../../../services/integrations/GoogleDriveService';
import { StructuredLogger } from '../../../logger';

/**
 * Create the Google Drive search tool.
 * Searches the user's Drive for documents matching a query.
 */
export function createGoogleDriveSearchTool(
	accessToken: string,
	logger: StructuredLogger
) {
	const driveService = new GoogleDriveService(accessToken);

	return tool({
		name: 'google_drive_search',
		description:
			'Search the user\'s Google Drive for documents, spreadsheets, and files. ' +
			'Use this when the user references Google Docs, Sheets, or Drive files, ' +
			'or when you need to find data sources for the application being built. ' +
			'Returns a list of matching files with their IDs, names, and types.',
		args: {
			query: t.string('Search query to find files by name or content'),
		},
		run: async ({ query }) => {
			try {
				logger.info('Searching Google Drive', { query });
				const results = await driveService.searchFiles(query, 10);

				if (results.files.length === 0) {
					return { success: true, message: 'No files found matching the query.', files: [] };
				}

				const files = results.files.map((f) => ({
					id: f.id,
					name: f.name,
					type: formatMimeType(f.mimeType),
					modified: f.modifiedTime,
					link: f.webViewLink,
				}));

				return {
					success: true,
					message: `Found ${files.length} file(s) matching "${query}".`,
					files,
				};
			} catch (error) {
				logger.error('Google Drive search failed', error);
				return {
					success: false,
					message: `Failed to search Drive: ${error instanceof Error ? error.message : 'Unknown error'}`,
					files: [],
				};
			}
		},
	});
}

/**
 * Create the Google Drive read tool.
 * Reads the content of a specific file from the user's Drive.
 */
export function createGoogleDriveReadTool(
	accessToken: string,
	logger: StructuredLogger
) {
	const driveService = new GoogleDriveService(accessToken);

	return tool({
		name: 'google_drive_read',
		description:
			'Read the content of a Google Drive document, spreadsheet, or file. ' +
			'Google Docs are returned as plain text, Sheets as CSV, other files as raw text. ' +
			'Use the file ID from google_drive_search results.',
		args: {
			fileId: t.string('The Google Drive file ID (from search results)'),
		},
		run: async ({ fileId }) => {
			try {
				logger.info('Reading Google Drive file', { fileId });

				// Get file metadata first to determine type
				const file = await driveService.getFile(fileId);
				const { content, format } = await driveService.getFileContent(fileId, file.mimeType);

				// Truncate very large files
				const maxLength = 50000;
				const truncated = content.length > maxLength;
				const truncatedContent = truncated
					? content.substring(0, maxLength) + '\n\n[Content truncated -- file exceeds 50KB]'
					: content;

				return {
					success: true,
					fileName: file.name,
					mimeType: file.mimeType,
					format,
					content: truncatedContent,
					truncated,
					originalSize: content.length,
				};
			} catch (error) {
				logger.error('Google Drive read failed', error);
				return {
					success: false,
					message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				};
			}
		},
	});
}

/** Convert Google MIME types to human-readable labels */
function formatMimeType(mimeType: string): string {
	const map: Record<string, string> = {
		'application/vnd.google-apps.document': 'Google Doc',
		'application/vnd.google-apps.spreadsheet': 'Google Sheet',
		'application/vnd.google-apps.presentation': 'Google Slides',
		'application/vnd.google-apps.folder': 'Folder',
		'application/pdf': 'PDF',
		'text/plain': 'Text',
		'text/csv': 'CSV',
		'application/json': 'JSON',
		'text/html': 'HTML',
	};
	return map[mimeType] || mimeType;
}
