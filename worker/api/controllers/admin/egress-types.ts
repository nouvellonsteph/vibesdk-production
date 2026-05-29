/**
 * Admin Egress Rule API Types
 */

import type { EgressRule } from '../../../database/schema';
import type { EgressTrafficEntry, EgressMode } from '../../../database/services/EgressRuleService';

// Rule CRUD
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

// Egress mode (audit / enforce)
export interface EgressModeData {
	mode: EgressMode;
}

export interface SetEgressModeRequest {
	mode: EgressMode;
}

// Traffic logs (audit mode)
export interface EgressTrafficLogsData {
	entries: EgressTrafficEntry[];
	mode: EgressMode;
}

export interface EgressClearLogsData {
	deletedCount: number;
}

export type { EgressTrafficEntry, EgressMode };
