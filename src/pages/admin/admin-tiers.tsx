import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Tier, TierFeatures, CreateTierRequest, UpdateTierRequest } from '@/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus } from 'lucide-react';

const DEFAULT_FEATURES: TierFeatures = {
	canDeploy: false,
	canExportGithub: false,
	canUseCustomModels: false,
	canMakePublic: false,
};

const FEATURE_LABELS: Record<keyof TierFeatures, string> = {
	canDeploy: 'Deploy',
	canExportGithub: 'GitHub Export',
	canUseCustomModels: 'Custom Models',
	canMakePublic: 'Make Public',
};

interface TierFormState {
	id: string;
	name: string;
	description: string;
	maxApps: string;
	dailyAppCreations: string;
	dailyLlmCredits: string;
	maxCustomProviders: string;
	sortOrder: string;
	isDefault: boolean;
	features: TierFeatures;
}

function emptyFormState(): TierFormState {
	return {
		id: '',
		name: '',
		description: '',
		maxApps: '3',
		dailyAppCreations: '2',
		dailyLlmCredits: '100',
		maxCustomProviders: '0',
		sortOrder: '0',
		isDefault: false,
		features: { ...DEFAULT_FEATURES },
	};
}

function tierToFormState(tier: Tier): TierFormState {
	const features = (tier.features as TierFeatures) || { ...DEFAULT_FEATURES };
	return {
		id: tier.id,
		name: tier.name,
		description: tier.description || '',
		maxApps: String(tier.maxApps),
		dailyAppCreations: String(tier.dailyAppCreations),
		dailyLlmCredits: String(tier.dailyLlmCredits),
		maxCustomProviders: String(tier.maxCustomProviders),
		sortOrder: String(tier.sortOrder),
		isDefault: tier.isDefault ?? false,
		features,
	};
}

export default function AdminTiers() {
	const [tiers, setTiers] = useState<Tier[]>([]);
	const [loading, setLoading] = useState(true);

	// Dialog state
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingTierId, setEditingTierId] = useState<string | null>(null);
	const [form, setForm] = useState<TierFormState>(emptyFormState());
	const [saving, setSaving] = useState(false);

	// Delete confirmation state
	const [deletingTierId, setDeletingTierId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	async function fetchTiers() {
		try {
			const response = await apiClient.adminListTiers();
			if (response.data) {
				setTiers(response.data.tiers);
			}
		} catch (err) {
			console.error('Failed to fetch tiers:', err);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		fetchTiers();
	}, []);

	function openCreateDialog() {
		setEditingTierId(null);
		setForm(emptyFormState());
		setDialogOpen(true);
	}

	function openEditDialog(tier: Tier) {
		setEditingTierId(tier.id);
		setForm(tierToFormState(tier));
		setDialogOpen(true);
	}

	function updateFormField<K extends keyof TierFormState>(key: K, value: TierFormState[K]) {
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	function updateFeature(key: keyof TierFeatures, value: boolean) {
		setForm((prev) => ({
			...prev,
			features: { ...prev.features, [key]: value },
		}));
	}

	async function handleSave() {
		setSaving(true);
		try {
			if (editingTierId) {
				// Update existing tier
				const payload: UpdateTierRequest = {
					name: form.name,
					description: form.description || null,
					maxApps: Number(form.maxApps),
					dailyAppCreations: Number(form.dailyAppCreations),
					dailyLlmCredits: Number(form.dailyLlmCredits),
					maxCustomProviders: Number(form.maxCustomProviders),
					sortOrder: Number(form.sortOrder),
					isDefault: form.isDefault,
					features: form.features,
				};
				await apiClient.adminUpdateTier(editingTierId, payload);
				toast.success('Tier updated');
			} else {
				// Create new tier
				if (!form.id || !form.name) {
					toast.error('ID and name are required');
					setSaving(false);
					return;
				}
				const payload: CreateTierRequest = {
					id: form.id,
					name: form.name,
					description: form.description || undefined,
					maxApps: Number(form.maxApps),
					dailyAppCreations: Number(form.dailyAppCreations),
					dailyLlmCredits: Number(form.dailyLlmCredits),
					maxCustomProviders: Number(form.maxCustomProviders),
					sortOrder: Number(form.sortOrder),
					isDefault: form.isDefault,
					features: form.features,
				};
				await apiClient.adminCreateTier(payload);
				toast.success('Tier created');
			}
			setDialogOpen(false);
			await fetchTiers();
		} catch (err) {
			toast.error(editingTierId ? 'Failed to update tier' : 'Failed to create tier');
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!deletingTierId) return;
		setDeleting(true);
		try {
			await apiClient.adminDeleteTier(deletingTierId);
			toast.success('Tier deleted');
			setDeletingTierId(null);
			await fetchTiers();
		} catch (err) {
			toast.error('Failed to delete tier');
		} finally {
			setDeleting(false);
		}
	}

	if (loading) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Tiers</h1>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Skeleton key={i} className="h-48 w-full" />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">Tiers</h1>
				<Button onClick={openCreateDialog}>
					<Plus className="h-4 w-4 mr-1" /> Create Tier
				</Button>
			</div>

			{tiers.length === 0 ? (
				<p className="text-muted-foreground py-8 text-center">
					No tiers configured. Create one to get started.
				</p>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{tiers.map((tier) => {
						const features = (tier.features as TierFeatures) || DEFAULT_FEATURES;
						return (
							<Card key={tier.id}>
								<CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
									<div>
										<CardTitle className="flex items-center gap-2">
											{tier.name}
											{tier.isDefault && (
												<Badge variant="secondary">Default</Badge>
											)}
										</CardTitle>
										{tier.description && (
											<p className="text-sm text-muted-foreground mt-1">
												{tier.description}
											</p>
										)}
									</div>
									<div className="flex gap-1">
										<Button
											variant="ghost"
											size="icon"
											onClick={() => openEditDialog(tier)}
										>
											<Pencil className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => setDeletingTierId(tier.id)}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div>
											<span className="text-muted-foreground">Max Apps:</span>{' '}
											<span className="font-medium">{tier.maxApps}</span>
										</div>
										<div>
											<span className="text-muted-foreground">Daily Creates:</span>{' '}
											<span className="font-medium">{tier.dailyAppCreations}</span>
										</div>
										<div>
											<span className="text-muted-foreground">Daily Credits:</span>{' '}
											<span className="font-medium">{tier.dailyLlmCredits}</span>
										</div>
										<div>
											<span className="text-muted-foreground">Max Providers:</span>{' '}
											<span className="font-medium">{tier.maxCustomProviders}</span>
										</div>
									</div>
									<Separator />
									<div className="flex flex-wrap gap-2">
										{(Object.keys(FEATURE_LABELS) as (keyof TierFeatures)[]).map((key) => (
											<Badge
												key={key}
												variant={features[key] ? 'default' : 'outline'}
											>
												{FEATURE_LABELS[key]}
											</Badge>
										))}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Create / Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{editingTierId ? 'Edit Tier' : 'Create Tier'}
						</DialogTitle>
					</DialogHeader>

					<div className="space-y-4 py-2">
						{/* ID field only shown for creation */}
						{!editingTierId && (
							<div className="space-y-2">
								<Label>ID (slug)</Label>
								<Input
									placeholder="e.g. free, pro, enterprise"
									value={form.id}
									onChange={(e) => updateFormField('id', e.target.value)}
								/>
							</div>
						)}

						<div className="space-y-2">
							<Label>Name</Label>
							<Input
								value={form.name}
								onChange={(e) => updateFormField('name', e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label>Description</Label>
							<Input
								value={form.description}
								onChange={(e) => updateFormField('description', e.target.value)}
							/>
						</div>

						<Separator />

						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label>Max Apps</Label>
								<Input
									type="number"
									min={0}
									value={form.maxApps}
									onChange={(e) => updateFormField('maxApps', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Daily App Creations</Label>
								<Input
									type="number"
									min={0}
									value={form.dailyAppCreations}
									onChange={(e) => updateFormField('dailyAppCreations', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Daily LLM Credits</Label>
								<Input
									type="number"
									min={0}
									value={form.dailyLlmCredits}
									onChange={(e) => updateFormField('dailyLlmCredits', e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Max Custom Providers</Label>
								<Input
									type="number"
									min={0}
									value={form.maxCustomProviders}
									onChange={(e) => updateFormField('maxCustomProviders', e.target.value)}
								/>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label>Sort Order</Label>
								<Input
									type="number"
									value={form.sortOrder}
									onChange={(e) => updateFormField('sortOrder', e.target.value)}
								/>
							</div>
							<div className="flex items-center gap-3 pt-6">
								<Switch
									checked={form.isDefault}
									onCheckedChange={(checked) => updateFormField('isDefault', checked)}
								/>
								<Label>Default tier</Label>
							</div>
						</div>

						<Separator />

						<div className="space-y-3">
							<Label>Features</Label>
							{(Object.keys(FEATURE_LABELS) as (keyof TierFeatures)[]).map((key) => (
								<div key={key} className="flex items-center justify-between">
									<Label className="font-normal">{FEATURE_LABELS[key]}</Label>
									<Switch
										checked={form.features[key]}
										onCheckedChange={(checked) => updateFeature(key, checked)}
									/>
								</div>
							))}
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={saving}>
							{saving ? 'Saving...' : editingTierId ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete confirmation */}
			<AlertDialog
				open={!!deletingTierId}
				onOpenChange={(open) => { if (!open) setDeletingTierId(null); }}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Tier</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this tier. Users assigned to it will need to be reassigned. This action cannot be undone.
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
