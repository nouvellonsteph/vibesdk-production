/**
 * Admin Egress Rule API Types
 */

import type { EgressRule } from '../../../database/schema';

export interface EgressRulesListData {
	rules: EgressRule[];
}

export interface EgressRuleData {
	rule: EgressRule;
}

export interface EgressRuleDeleteData {
	success: boolean;
}

export interface CreateEgressRuleRequest {
	name: string;
	description?: string;
	ruleType: 'allow' | 'deny';
	scope: 'global' | 'tier' | 'app';
	scopeId?: string;
	hostPattern: string;
}

export interface UpdateEgressRuleRequest {
	name?: string;
	description?: string | null;
	ruleType?: 'allow' | 'deny';
	scope?: 'global' | 'tier' | 'app';
	scopeId?: string | null;
	hostPattern?: string;
}
