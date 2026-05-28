/**
 * Egress Rule Service
 * Manages outbound traffic rules for sandboxes and deployed apps.
 * Rules control which external hosts can be reached.
 */

import { eq, and, or } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';

export type RuleType = 'allow' | 'deny';
export type RuleScope = 'global' | 'tier' | 'app';

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
}
