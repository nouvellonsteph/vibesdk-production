/**
 * Integration API Types
 */

export interface IntegrationAvailability {
	configured: boolean; // admin has set client_id/secret
	enabled: boolean;    // admin has toggled it on
	tierAllowed: boolean; // user's tier has canUseGoogleDrive
}

export interface IntegrationsListData {
	available: {
		googleDrive: IntegrationAvailability;
	};
	integrations: Array<{
		provider: string;
		isActive: boolean;
		scopes: string[];
		connectedAt: Date | null;
	}>;
}

export interface IntegrationConnectData {
	authUrl: string;
}

export interface IntegrationCallbackData {
	success: boolean;
	provider: string;
}

export interface IntegrationDisconnectData {
	success: boolean;
}

export interface DriveFilesListData {
	files: Array<{
		id: string;
		name: string;
		mimeType: string;
		modifiedTime: string;
		webViewLink?: string;
	}>;
	nextPageToken?: string;
}

export interface DriveFileContentData {
	fileName: string;
	content: string;
	format: string;
}
