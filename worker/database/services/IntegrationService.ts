/**
 * Integration Service
 * Manages user integrations with external services (Google Drive, etc.).
 * Handles OAuth token storage (encrypted) and lifecycle.
 */

import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';

export type IntegrationProvider = 'google_drive';

export class IntegrationService extends BaseService {
	/**
	 * Get a user's integration for a specific provider.
	 */
	async getIntegration(
		userId: string,
		provider: IntegrationProvider
	): Promise<schema.UserIntegration | null> {
		const result = await this.database
			.select()
			.from(schema.userIntegrations)
			.where(
				and(
					eq(schema.userIntegrations.userId, userId),
					eq(schema.userIntegrations.provider, provider)
				)
			)
			.get();
		return result ?? null;
	}

	/**
	 * List all integrations for a user.
	 */
	async listUserIntegrations(userId: string): Promise<schema.UserIntegration[]> {
		return this.database
			.select()
			.from(schema.userIntegrations)
			.where(eq(schema.userIntegrations.userId, userId))
			.all();
	}

	/**
	 * Create or update an integration with OAuth tokens.
	 */
	async upsertIntegration(data: {
		userId: string;
		provider: IntegrationProvider;
		accessTokenEncrypted: string;
		refreshTokenEncrypted?: string;
		tokenExpiresAt?: Date;
		scopes: string[];
	}): Promise<schema.UserIntegration> {
		const now = new Date();
		const existing = await this.getIntegration(data.userId, data.provider);

		if (existing) {
			await this.database
				.update(schema.userIntegrations)
				.set({
					accessTokenEncrypted: data.accessTokenEncrypted,
					refreshTokenEncrypted: data.refreshTokenEncrypted ?? existing.refreshTokenEncrypted,
					tokenExpiresAt: data.tokenExpiresAt ?? existing.tokenExpiresAt,
					scopes: data.scopes,
					isActive: true,
					updatedAt: now,
				})
				.where(eq(schema.userIntegrations.id, existing.id));

			return (await this.getIntegration(data.userId, data.provider))!;
		}

		const id = generateId();
		await this.database.insert(schema.userIntegrations).values({
			id,
			userId: data.userId,
			provider: data.provider,
			accessTokenEncrypted: data.accessTokenEncrypted,
			refreshTokenEncrypted: data.refreshTokenEncrypted ?? null,
			tokenExpiresAt: data.tokenExpiresAt ?? null,
			scopes: data.scopes,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});

		return (await this.getIntegration(data.userId, data.provider))!;
	}

	/**
	 * Disconnect an integration (soft delete -- keeps the record but deactivates).
	 */
	async disconnectIntegration(
		userId: string,
		provider: IntegrationProvider
	): Promise<boolean> {
		await this.database
			.update(schema.userIntegrations)
			.set({
				isActive: false,
				accessTokenEncrypted: null,
				refreshTokenEncrypted: null,
				tokenExpiresAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.userIntegrations.userId, userId),
					eq(schema.userIntegrations.provider, provider)
				)
			);
		return true;
	}

	/**
	 * Hard delete an integration.
	 */
	async deleteIntegration(
		userId: string,
		provider: IntegrationProvider
	): Promise<boolean> {
		await this.database
			.delete(schema.userIntegrations)
			.where(
				and(
					eq(schema.userIntegrations.userId, userId),
					eq(schema.userIntegrations.provider, provider)
				)
			);
		return true;
	}

	/**
	 * Check if a user has an active integration for a provider.
	 */
	async hasActiveIntegration(
		userId: string,
		provider: IntegrationProvider
	): Promise<boolean> {
		const integration = await this.getIntegration(userId, provider);
		return !!(integration?.isActive && integration.accessTokenEncrypted);
	}
}
