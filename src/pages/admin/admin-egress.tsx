import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
	EgressRule,
	CreateEgressRuleRequest,
	UpdateEgressRuleRequest,
} from '@/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus } from 'lucide-react';

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
		name: '',
		description: '',
		ruleType: 'allow',
		scope: 'global',
		scopeId: '',
		hostPattern: '',
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
	const [rules, setRules] = useState<EgressRule[]>([]);
	const [loading, setLoading] = useState(true);

	// Dialog state for create/edit
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
	const [form, setForm] = useState<RuleFormState>(emptyFormState());
	const [saving, setSaving] = useState(false);

	// Delete confirmation state
	const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	async function fetchRules() {
		try {
			const response = await apiClient.adminListEgressRules();
			if (response.data) {
				setRules(response.data.rules);
			}
		} catch (err) {
			console.error('Failed to fetch egress rules:', err);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		fetchRules();
	}, []);

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
		} catch (err) {
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
		} catch (err) {
			toast.error('Failed to delete rule');
		} finally {
			setDeleting(false);
		}
	}

	if (loading) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Egress Rules</h1>
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">Egress Rules</h1>
				<Button onClick={openCreateDialog}>
					<Plus className="h-4 w-4 mr-1" /> Create Rule
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Network Egress Rules</CardTitle>
				</CardHeader>
				<CardContent>
					{rules.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center">
							No egress rules configured. Create one to get started.
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
									// Clear scope ID when switching to global
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
									placeholder={
										form.scope === 'tier'
											? 'Tier ID'
											: 'App ID'
									}
								/>
							</div>
						)}

						<div className="space-y-2">
							<Label>Host Pattern</Label>
							<Input
								value={form.hostPattern}
								onChange={(e) => updateField('hostPattern', e.target.value)}
								placeholder="e.g., *.google.com"
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

			{/* Delete confirmation */}
			<AlertDialog
				open={!!deletingRuleId}
				onOpenChange={(open) => { if (!open) setDeletingRuleId(null); }}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Egress Rule</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this egress rule. Network access controlled by this rule will no longer be enforced. This action cannot be undone.
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
		</div>
	);
}
