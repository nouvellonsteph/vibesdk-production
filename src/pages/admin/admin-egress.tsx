import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
	EgressRule,
	EgressMode,
	EgressTrafficEntry,
	CreateEgressRuleRequest,
	UpdateEgressRuleRequest,
} from '@/api-types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
	Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
	Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
	Pencil, Trash2, Plus, ShieldCheck, Eye, RefreshCw, ShieldPlus, Eraser,
} from 'lucide-react';

type RuleType = 'allow' | 'deny';
type RuleScope = 'global' | 'tier' | 'app';

interface RuleFormState {
	name: string;
	description: string;
	ruleType: RuleType;
	scope: RuleScope;
	scopeId: string;
	hostPattern: string;
}

function emptyFormState(): RuleFormState {
	return {
		name: '', description: '', ruleType: 'allow',
		scope: 'global', scopeId: '', hostPattern: '',
	};
}

function ruleToFormState(rule: EgressRule): RuleFormState {
	return {
		name: rule.name,
		description: rule.description ?? '',
		ruleType: rule.ruleType as RuleType,
		scope: rule.scope as RuleScope,
		scopeId: rule.scopeId ?? '',
		hostPattern: rule.hostPattern,
	};
}

export default function AdminEgress() {
	// Egress mode
	const [mode, setMode] = useState<EgressMode>('enforce');
	const [modeLoading, setModeLoading] = useState(true);
	const [modeSwitching, setModeSwitching] = useState(false);

	// Traffic logs
	const [trafficEntries, setTrafficEntries] = useState<EgressTrafficEntry[]>([]);
	const [logsLoading, setLogsLoading] = useState(false);

	// Rules
	const [rules, setRules] = useState<EgressRule[]>([]);
	const [rulesLoading, setRulesLoading] = useState(true);

	// Dialog state for create/edit rules
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
	const [form, setForm] = useState<RuleFormState>(emptyFormState());
	const [saving, setSaving] = useState(false);

	// Delete confirmation state
	const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	// Clear logs confirmation
	const [clearingLogs, setClearingLogs] = useState(false);
	const [showClearConfirm, setShowClearConfirm] = useState(false);

	const fetchMode = useCallback(async () => {
		try {
			const response = await apiClient.adminGetEgressMode();
			if (response.data) {
				setMode(response.data.mode);
			}
		} catch (err) {
			console.error('Failed to fetch egress mode:', err);
		} finally {
			setModeLoading(false);
		}
	}, []);

	const fetchLogs = useCallback(async () => {
		setLogsLoading(true);
		try {
			const response = await apiClient.adminGetEgressLogs();
			if (response.data) {
				setTrafficEntries(response.data.entries);
			}
		} catch (err) {
			console.error('Failed to fetch egress logs:', err);
		} finally {
			setLogsLoading(false);
		}
	}, []);

	const fetchRules = useCallback(async () => {
		try {
			const response = await apiClient.adminListEgressRules();
			if (response.data) {
				setRules(response.data.rules);
			}
		} catch (err) {
			console.error('Failed to fetch egress rules:', err);
		} finally {
			setRulesLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchMode();
		fetchRules();
		fetchLogs();
	}, [fetchMode, fetchRules, fetchLogs]);

	async function handleModeToggle(checked: boolean) {
		const newMode: EgressMode = checked ? 'audit' : 'enforce';
		setModeSwitching(true);
		try {
			await apiClient.adminSetEgressMode({ mode: newMode });
			setMode(newMode);
			toast.success(
				newMode === 'audit'
					? 'Switched to Audit mode -- all traffic will be logged'
					: 'Switched to Enforce mode -- only allowed hosts permitted'
			);
			// Refresh logs when switching to audit
			if (newMode === 'audit') {
				await fetchLogs();
			}
		} catch {
			toast.error('Failed to change egress mode');
		} finally {
			setModeSwitching(false);
		}
	}

	async function handleClearLogs() {
		setClearingLogs(true);
		try {
			const response = await apiClient.adminClearEgressLogs();
			if (response.data) {
				toast.success(`Cleared ${response.data.deletedCount} log entries`);
			}
			setTrafficEntries([]);
			setShowClearConfirm(false);
		} catch {
			toast.error('Failed to clear logs');
		} finally {
			setClearingLogs(false);
		}
	}

	// Create a rule from a traffic log entry
	function createRuleFromTraffic(entry: EgressTrafficEntry, ruleType: RuleType) {
		setEditingRuleId(null);
		setForm({
			name: `${ruleType === 'allow' ? 'Allow' : 'Deny'} ${entry.host}`,
			description: `Created from traffic log (${entry.requestCount} requests observed)`,
			ruleType,
			scope: 'global',
			scopeId: '',
			hostPattern: entry.host,
		});
		setDialogOpen(true);
	}

	function openCreateDialog() {
		setEditingRuleId(null);
		setForm(emptyFormState());
		setDialogOpen(true);
	}

	function openEditDialog(rule: EgressRule) {
		setEditingRuleId(rule.id);
		setForm(ruleToFormState(rule));
		setDialogOpen(true);
	}

	function updateField<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) {
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	async function handleSave() {
		if (!form.name || !form.hostPattern) {
			toast.error('Name and host pattern are required');
			return;
		}

		setSaving(true);
		try {
			if (editingRuleId) {
				const payload: UpdateEgressRuleRequest = {
					name: form.name,
					description: form.description || null,
					ruleType: form.ruleType,
					scope: form.scope,
					scopeId: form.scope === 'global' ? null : form.scopeId || null,
					hostPattern: form.hostPattern,
				};
				await apiClient.adminUpdateEgressRule(editingRuleId, payload);
				toast.success('Egress rule updated');
			} else {
				const payload: CreateEgressRuleRequest = {
					name: form.name,
					description: form.description || undefined,
					ruleType: form.ruleType,
					scope: form.scope,
					scopeId: form.scope === 'global' ? undefined : form.scopeId || undefined,
					hostPattern: form.hostPattern,
				};
				await apiClient.adminCreateEgressRule(payload);
				toast.success('Egress rule created');
			}
			setDialogOpen(false);
			await fetchRules();
		} catch {
			toast.error(editingRuleId ? 'Failed to update rule' : 'Failed to create rule');
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!deletingRuleId) return;
		setDeleting(true);
		try {
			await apiClient.adminDeleteEgressRule(deletingRuleId);
			toast.success('Egress rule deleted');
			setDeletingRuleId(null);
			await fetchRules();
		} catch {
			toast.error('Failed to delete rule');
		} finally {
			setDeleting(false);
		}
	}

	// Check if a host already has a rule
	function hostHasRule(host: string): EgressRule | undefined {
		return rules.find((r) => r.hostPattern === host);
	}

	if (modeLoading || rulesLoading) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Network Egress</h1>
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Network Egress</h1>

			{/* Mode toggle card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="space-y-1">
							<CardTitle className="flex items-center gap-2">
								{mode === 'audit' ? (
									<Eye className="h-5 w-5 text-amber-500" />
								) : (
									<ShieldCheck className="h-5 w-5 text-green-500" />
								)}
								Egress Mode: {mode === 'audit' ? 'Audit' : 'Enforce'}
							</CardTitle>
							<CardDescription>
								{mode === 'audit'
									? 'All outbound traffic is allowed and logged. Review the traffic log below, then create rules before switching to enforce mode.'
									: 'Outbound traffic is restricted to system-required hosts and admin-configured rules. Allowed traffic is still logged below so you can refine rules.'}
							</CardDescription>
						</div>
						<div className="flex items-center gap-3">
							<Label htmlFor="egress-mode" className="text-sm text-muted-foreground">
								{mode === 'audit' ? 'Audit' : 'Enforce'}
							</Label>
							<Switch
								id="egress-mode"
								checked={mode === 'audit'}
								onCheckedChange={handleModeToggle}
								disabled={modeSwitching}
							/>
						</div>
					</div>
				</CardHeader>
			</Card>

			{/* Traffic log card (visible in both modes, most useful in audit) */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="space-y-1">
							<CardTitle>Traffic Log</CardTitle>
							<CardDescription>
								Outbound requests captured from sandbox containers. Grouped by host, sorted by frequency.
								{mode === 'enforce' && ' In enforce mode, only allowed hosts appear here.'}
							</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={fetchLogs}
								disabled={logsLoading}
							>
								<RefreshCw className={`h-4 w-4 mr-1 ${logsLoading ? 'animate-spin' : ''}`} />
								Refresh
							</Button>
							{trafficEntries.length > 0 && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setShowClearConfirm(true)}
								>
									<Eraser className="h-4 w-4 mr-1" />
									Clear
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{trafficEntries.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center">
							No traffic captured yet. Sandbox containers will log outbound requests here as they run.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Host</TableHead>
									<TableHead className="text-right">Requests</TableHead>
									<TableHead>Methods</TableHead>
									<TableHead>Sample Paths</TableHead>
									<TableHead>Last Seen</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{trafficEntries.map((entry) => {
									const existingRule = hostHasRule(entry.host);
									return (
										<TableRow key={entry.host}>
											<TableCell className="font-mono text-sm">
												{entry.host}
											</TableCell>
											<TableCell className="text-right font-medium">
												{entry.requestCount.toLocaleString()}
											</TableCell>
											<TableCell>
												<div className="flex gap-1 flex-wrap">
													{entry.methods.map((m) => (
														<Badge key={m} variant="outline" className="text-xs">
															{m}
														</Badge>
													))}
												</div>
											</TableCell>
											<TableCell className="max-w-48">
												<div className="text-xs text-muted-foreground truncate">
													{entry.samplePaths.join(', ')}
												</div>
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{new Date(entry.lastSeen).toLocaleTimeString()}
											</TableCell>
											<TableCell>
												{existingRule ? (
													<Badge
														variant={existingRule.ruleType === 'allow' ? 'default' : 'destructive'}
													>
														{existingRule.ruleType}ed
													</Badge>
												) : (
													<Badge variant="secondary">unmanaged</Badge>
												)}
											</TableCell>
											<TableCell className="text-right">
												{existingRule ? (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => openEditDialog(existingRule)}
													>
														<Pencil className="h-3 w-3 mr-1" />
														Edit
													</Button>
												) : (
													<div className="flex justify-end gap-1">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => createRuleFromTraffic(entry, 'allow')}
															title="Create allow rule"
														>
															<ShieldPlus className="h-3 w-3 mr-1" />
															Allow
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => createRuleFromTraffic(entry, 'deny')}
															className="text-destructive hover:text-destructive"
															title="Create deny rule"
														>
															<ShieldCheck className="h-3 w-3 mr-1" />
															Deny
														</Button>
													</div>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Rules card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="space-y-1">
							<CardTitle>Egress Rules</CardTitle>
							<CardDescription>
								Allow or deny specific hosts. Rules apply to all sandbox containers. Deny rules override allow rules.
							</CardDescription>
						</div>
						<Button onClick={openCreateDialog} size="sm">
							<Plus className="h-4 w-4 mr-1" /> Create Rule
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{rules.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center">
							No egress rules configured. Use the traffic log above to create rules from observed traffic, or create one manually.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Scope</TableHead>
									<TableHead>Host Pattern</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rules.map((rule) => (
									<TableRow key={rule.id}>
										<TableCell className="font-medium">
											{rule.name}
										</TableCell>
										<TableCell>
											<Badge
												variant={rule.ruleType === 'allow' ? 'default' : 'destructive'}
											>
												{rule.ruleType}
											</Badge>
										</TableCell>
										<TableCell>
											{rule.scope}
											{rule.scopeId && (
												<span className="text-muted-foreground ml-1">
													({rule.scopeId})
												</span>
											)}
										</TableCell>
										<TableCell>
											<code className="text-sm bg-muted px-1.5 py-0.5 rounded">
												{rule.hostPattern}
											</code>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => openEditDialog(rule)}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => setDeletingRuleId(rule.id)}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create / Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{editingRuleId ? 'Edit Egress Rule' : 'Create Egress Rule'}
						</DialogTitle>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="space-y-2">
							<Label>Name</Label>
							<Input
								value={form.name}
								onChange={(e) => updateField('name', e.target.value)}
								placeholder="Rule name"
							/>
						</div>

						<div className="space-y-2">
							<Label>Description</Label>
							<Input
								value={form.description}
								onChange={(e) => updateField('description', e.target.value)}
								placeholder="Optional description"
							/>
						</div>

						<div className="space-y-2">
							<Label>Rule Type</Label>
							<Select
								value={form.ruleType}
								onValueChange={(v) => updateField('ruleType', v as RuleType)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="allow">Allow</SelectItem>
									<SelectItem value="deny">Deny</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label>Scope</Label>
							<Select
								value={form.scope}
								onValueChange={(v) => {
									const scope = v as RuleScope;
									updateField('scope', scope);
									if (scope === 'global') {
										updateField('scopeId', '');
									}
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="global">Global</SelectItem>
									<SelectItem value="tier">Tier</SelectItem>
									<SelectItem value="app">App</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{form.scope !== 'global' && (
							<div className="space-y-2">
								<Label>Scope ID</Label>
								<Input
									value={form.scopeId}
									onChange={(e) => updateField('scopeId', e.target.value)}
									placeholder={form.scope === 'tier' ? 'Tier ID' : 'App ID'}
								/>
							</div>
						)}

						<div className="space-y-2">
							<Label>Host Pattern</Label>
							<Input
								value={form.hostPattern}
								onChange={(e) => updateField('hostPattern', e.target.value)}
								placeholder="e.g., *.google.com or api.example.com"
							/>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={saving}>
							{saving ? 'Saving...' : editingRuleId ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete rule confirmation */}
			<AlertDialog
				open={!!deletingRuleId}
				onOpenChange={(open) => { if (!open) setDeletingRuleId(null); }}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Egress Rule</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this egress rule. Network access controlled by this rule will no longer be enforced.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} disabled={deleting}>
							{deleting ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Clear logs confirmation */}
			<AlertDialog
				open={showClearConfirm}
				onOpenChange={(open) => { if (!open) setShowClearConfirm(false); }}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Clear Traffic Logs</AlertDialogTitle>
						<AlertDialogDescription>
							This will delete all captured traffic log entries. This is useful after creating rules from observed traffic. Logs are also auto-cleaned after 24 hours.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={clearingLogs}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleClearLogs} disabled={clearingLogs}>
							{clearingLogs ? 'Clearing...' : 'Clear All Logs'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
