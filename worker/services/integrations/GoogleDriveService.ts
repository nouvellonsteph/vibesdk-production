/**
 * Google Drive Service
 * Provides access to a user's Google Drive via their OAuth tokens.
 * Used by the AI agent to read documents as data sources for generated apps.
 */

import { createLogger } from '../../logger';

const logger = createLogger('GoogleDriveService');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string;
	size?: string;
	webViewLink?: string;
	iconLink?: string;
}

export interface DriveFileList {
	files: DriveFile[];
	nextPageToken?: string;
}

export interface DocContent {
	title: string;
	body: string; // plain text extracted from the document
}

export class GoogleDriveService {
	private accessToken: string;

	constructor(accessToken: string) {
		this.accessToken = accessToken;
	}

	private async request<T>(url: string): Promise<T> {
		const response = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${this.accessToken}`,
				'Accept': 'application/json',
			},
			signal: AbortSignal.timeout(15000),
		});

		if (!response.ok) {
			const error = await response.text();
			logger.error('Google API request failed', { url, status: response.status, error });
			throw new Error(`Google API error ${response.status}: ${error}`);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * List files in the user's Drive.
	 * @param query Optional search query (Google Drive query syntax)
	 * @param pageToken Pagination token
	 * @param pageSize Number of files per page (max 100)
	 */
	async listFiles(query?: string, pageToken?: string, pageSize = 20): Promise<DriveFileList> {
		const params = new URLSearchParams({
			fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink),nextPageToken',
			pageSize: String(Math.min(pageSize, 100)),
			orderBy: 'modifiedTime desc',
		});

		if (query) {
			params.set('q', query);
		}
		if (pageToken) {
			params.set('pageToken', pageToken);
		}

		return this.request<DriveFileList>(`${DRIVE_API_BASE}/files?${params}`);
	}

	/**
	 * Search files by name or content.
	 */
	async searchFiles(searchTerm: string, pageSize = 10): Promise<DriveFileList> {
		// Escape single quotes in search term
		const escaped = searchTerm.replace(/'/g, "\\'");
		const query = `name contains '${escaped}' or fullText contains '${escaped}'`;
		return this.listFiles(query, undefined, pageSize);
	}

	/**
	 * Get file metadata.
	 */
	async getFile(fileId: string): Promise<DriveFile> {
		const params = new URLSearchParams({
			fields: 'id,name,mimeType,modifiedTime,size,webViewLink,iconLink',
		});
		return this.request<DriveFile>(`${DRIVE_API_BASE}/files/${fileId}?${params}`);
	}

	/**
	 * Download file content as text.
	 * Works for text-based files (not Google Docs native format).
	 */
	async downloadFileContent(fileId: string): Promise<string> {
		const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
			headers: {
				'Authorization': `Bearer ${this.accessToken}`,
			},
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Failed to download file: ${response.status}`);
		}

		return response.text();
	}

	/**
	 * Get Google Docs content as plain text.
	 * Uses the export endpoint to convert to plain text.
	 */
	async getDocAsText(fileId: string): Promise<string> {
		const response = await fetch(
			`${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/plain`,
			{
				headers: {
					'Authorization': `Bearer ${this.accessToken}`,
				},
				signal: AbortSignal.timeout(30000),
			}
		);

		if (!response.ok) {
			throw new Error(`Failed to export doc: ${response.status}`);
		}

		return response.text();
	}

	/**
	 * Get Google Sheets content as CSV.
	 */
	async getSheetAsCsv(fileId: string): Promise<string> {
		const response = await fetch(
			`${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/csv`,
			{
				headers: {
					'Authorization': `Bearer ${this.accessToken}`,
				},
				signal: AbortSignal.timeout(30000),
			}
		);

		if (!response.ok) {
			throw new Error(`Failed to export sheet: ${response.status}`);
		}

		return response.text();
	}

	/**
	 * Get file content in the best format based on MIME type.
	 * Google Docs -> plain text, Sheets -> CSV, others -> raw download.
	 */
	async getFileContent(fileId: string, mimeType: string): Promise<{ content: string; format: string }> {
		if (mimeType === 'application/vnd.google-apps.document') {
			return { content: await this.getDocAsText(fileId), format: 'text' };
		}
		if (mimeType === 'application/vnd.google-apps.spreadsheet') {
			return { content: await this.getSheetAsCsv(fileId), format: 'csv' };
		}
		// For other text-based files, download raw content
		return { content: await this.downloadFileContent(fileId), format: 'raw' };
	}
}
