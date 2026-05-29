/**
 * Egress Rule Service
 * Manages outbound traffic rules for sandboxes and deployed apps.
 * Rules control which external hosts can be reached.
 *
 * Supports two modes:
 * - AUDIT: internet enabled, all outbound requests logged for review
 * - ENFORCE: internet disabled, only system + admin-allowed hosts permitted
 */

import { eq, and, or } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';

export type RuleType = 'allow' | 'deny';
export type RuleScope = 'global' | 'tier' | 'app';
export type EgressMode = 'audit' | 'enforce';

const EGRESS_MODE_SETTING_KEY = 'egress_mode';

/** Resolved egress policy for a specific context (user + app) */
export interface EgressPolicy {
	allowedHosts: string[];
	deniedHosts: string[];
}

export class EgressRuleService extends BaseService {
	// ========================================
	// CRUD
	// ========================================

	async listRules(scope?: RuleScope): Promise<schema.EgressRule[]> {
		if (scope) {
			return this.getReadDb()
				.select()
				.from(schema.egressRules)
				.where(eq(schema.egressRules.scope, scope))
				.all();
		}
		return this.getReadDb()
			.select()
			.from(schema.egressRules)
			.all();
	}

	async getRule(ruleId: string): Promise<schema.EgressRule | null> {
		const rule = await this.getReadDb()
			.select()
			.from(schema.egressRules)
			.where(eq(schema.egressRules.id, ruleId))
			.get();
		return rule ?? null;
	}

	async createRule(data: {
		name: string;
		description?: string;
		ruleType: RuleType;
		scope: RuleScope;
		scopeId?: string;
		hostPattern: string;
		createdBy: string;
	}): Promise<schema.EgressRule> {
		const id = generateId();
		const now = new Date();

		await this.database.insert(schema.egressRules).values({
			id,
			name: data.name,
			description: data.description ?? null,
			ruleType: data.ruleType,
			scope: data.scope,
			scopeId: data.scopeId ?? null,
			hostPattern: data.hostPattern,
			createdBy: data.createdBy,
			createdAt: now,
			updatedAt: now,
		});

		return (await this.getRule(id))!;
	}

	async updateRule(
		ruleId: string,
		data: Partial<{
			name: string;
			description: string | null;
			ruleType: RuleType;
			scope: RuleScope;
			scopeId: string | null;
			hostPattern: string;
		}>
	): Promise<schema.EgressRule | null> {
		await this.database
			.update(schema.egressRules)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(schema.egressRules.id, ruleId));

		return this.getRule(ruleId);
	}

	async deleteRule(ruleId: string): Promise<boolean> {
		await this.database
			.delete(schema.egressRules)
			.where(eq(schema.egressRules.id, ruleId));
		return true;
	}

	// ========================================
	// RULE RESOLUTION
	// ========================================

	/**
	 * Resolve the effective egress policy for a given context.
	 * Merges global rules + tier rules + app-specific rules.
	 * Deny rules always take precedence over allow rules.
	 */
	async resolvePolicy(tierId?: string, appId?: string): Promise<EgressPolicy> {
		// Build conditions: global OR matching tier OR matching app
		const conditions = [eq(schema.egressRules.scope, 'global')];

		if (tierId) {
			conditions.push(
				and(
					eq(schema.egressRules.scope, 'tier'),
					eq(schema.egressRules.scopeId, tierId)
				)!
			);
		}

		if (appId) {
			conditions.push(
				and(
					eq(schema.egressRules.scope, 'app'),
					eq(schema.egressRules.scopeId, appId)
				)!
			);
		}

		const rules = await this.database
			.select()
			.from(schema.egressRules)
			.where(or(...conditions))
			.all();

		const allowedHosts: string[] = [];
		const deniedHosts: string[] = [];

		for (const rule of rules) {
			if (rule.ruleType === 'allow') {
				allowedHosts.push(rule.hostPattern);
			} else {
				deniedHosts.push(rule.hostPattern);
			}
		}

		return { allowedHosts, deniedHosts };
	}

	/**
	 * Get rules as flat arrays for the sandbox SDK.
	 * If there are any allow rules, the sandbox will deny-by-default
	 * and only allow the listed hosts. Deny rules are always applied.
	 */
	async getSandboxHostLists(tierId?: string, appId?: string): Promise<{
		enableInternet: boolean;
		allowedHosts: string[];
		deniedHosts: string[];
	}> {
		const policy = await this.resolvePolicy(tierId, appId);

		// If there are allow rules, switch to deny-by-default mode
		const enableInternet = policy.allowedHosts.length === 0;

		return {
			enableInternet,
			allowedHosts: policy.allowedHosts,
			deniedHosts: policy.deniedHosts,
		};
	}

	// ========================================
	// EGRESS MODE (audit / enforce)
	// ========================================

	/** Get current egress mode. Defaults to 'enforce'. */
	async getMode(): Promise<EgressMode> {
		const row = await this.getReadDb()
			.select()
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.key, EGRESS_MODE_SETTING_KEY))
			.get();

		if (!row?.value) return 'enforce';
		const value = row.value as string;
		return value === 'audit' ? 'audit' : 'enforce';
	}

	/** Set egress mode. */
	async setMode(mode: EgressMode): Promise<void> {
		const existing = await this.getReadDb()
			.select()
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.key, EGRESS_MODE_SETTING_KEY))
			.get();

		if (existing) {
			await this.database
				.update(schema.systemSettings)
				.set({ value: mode, updatedAt: new Date() })
				.where(eq(schema.systemSettings.key, EGRESS_MODE_SETTING_KEY));
		} else {
			await this.database.insert(schema.systemSettings).values({
				key: EGRESS_MODE_SETTING_KEY,
				value: mode,
				updatedAt: new Date(),
			});
		}
	}

	// ========================================
	// EGRESS LOGS (KV-backed, read via env)
	// ========================================

	/**
	 * Get aggregated egress traffic logs from KV.
	 * Groups by host with request count and last seen timestamp.
	 * Returns hosts sorted by count (most traffic first).
	 */
	static async getTrafficLogs(env: Env): Promise<EgressTrafficEntry[]> {
		// List all egress_log: keys from KV
		const logKeys = await env.VibecoderStore.list({ prefix: 'egress_log:' });
		const hostMap = new Map<string, { count: number; lastSeen: string; methods: Set<string>; paths: Set<string> }>();

		// Fetch all log entries in parallel (batch of 50)
		const keys = logKeys.keys.map((k) => k.name);
		const batchSize = 50;
		for (let i = 0; i < keys.length; i += batchSize) {
			const batch = keys.slice(i, i + batchSize);
			const values = await Promise.all(batch.map((k) => env.VibecoderStore.get(k)));

			for (const raw of values) {
				if (!raw) continue;
				let entry: { host?: string; method?: string; path?: string; timestamp?: string };
				try {
					entry = JSON.parse(raw) as typeof entry;
				} catch {
					continue;
				}
				if (!entry.host) continue;

				const existing = hostMap.get(entry.host);
				if (existing) {
					existing.count++;
					if (entry.timestamp && entry.timestamp > existing.lastSeen) {
						existing.lastSeen = entry.timestamp;
					}
					if (entry.method) existing.methods.add(entry.method);
					if (entry.path) existing.paths.add(entry.path);
				} else {
					hostMap.set(entry.host, {
						count: 1,
						lastSeen: entry.timestamp ?? new Date().toISOString(),
						methods: new Set(entry.method ? [entry.method] : []),
						paths: new Set(entry.path ? [entry.path] : []),
					});
				}
			}
		}

		// Convert to sorted array
		const entries: EgressTrafficEntry[] = [];
		for (const [host, data] of hostMap) {
			entries.push({
				host,
				requestCount: data.count,
				lastSeen: data.lastSeen,
				methods: Array.from(data.methods),
				samplePaths: Array.from(data.paths).slice(0, 5),
			});
		}

		entries.sort((a, b) => b.requestCount - a.requestCount);
		return entries;
	}

	/** Clear all egress logs from KV. */
	static async clearTrafficLogs(env: Env): Promise<number> {
		const logKeys = await env.VibecoderStore.list({ prefix: 'egress_log:' });
		const hostKeys = await env.VibecoderStore.list({ prefix: 'egress_host:' });

		const allKeys = [
			...logKeys.keys.map((k) => k.name),
			...hostKeys.keys.map((k) => k.name),
		];

		await Promise.all(allKeys.map((k) => env.VibecoderStore.delete(k)));
		return allKeys.length;
	}
}

/** A single host's aggregated traffic data from audit mode. */
export interface EgressTrafficEntry {
	host: string;
	requestCount: number;
	lastSeen: string;
	methods: string[];
	samplePaths: string[];
}
