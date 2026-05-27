import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { apiClient } from '@/lib/api-client';
import type { AdminUserData, Tier, SetUserOverridesRequest } from '@/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';

function formatDate(date: Date | string | null): string {
	if (!date) return '-';
	return new Date(date).toLocaleString();
}

export default function AdminUserDetail() {
	const { userId } = useParams<{ userId: string }>();
	const navigate = useNavigate();

	const [user, setUser] = useState<AdminUserData | null>(null);
	const [tiers, setTiers] = useState<Tier[]>([]);
	const [loading, setLoading] = useState(true);

	// Tier assignment state
	const [selectedTierId, setSelectedTierId] = useState<string>('');
	const [tierSaving, setTierSaving] = useState(false);

	// Role state
	const [roleSaving, setRoleSaving] = useState(false);

	// Suspend state
	const [suspendSaving, setSuspendSaving] = useState(false);

	// Overrides form state
	const [overrideMaxApps, setOverrideMaxApps] = useState('');
	const [overrideDailyAppCreations, setOverrideDailyAppCreations] = useState('');
	const [overrideDailyLlmCredits, setOverrideDailyLlmCredits] = useState('');
	const [overrideReason, setOverrideReason] = useState('');
	const [overrideSaving, setOverrideSaving] = useState(false);

	useEffect(() => {
		if (!userId) return;
		let cancelled = false;

		async function load() {
			try {
				const [userRes, tiersRes] = await Promise.all([
					apiClient.adminGetUser(userId!),
					apiClient.adminListTiers(),
				]);

				if (cancelled) return;

				if (userRes.data) {
					const u = userRes.data.user;
					setUser(u);
					setSelectedTierId(u.tierId || '');

					// Pre-populate override fields if they exist
					if (u.overrides) {
						setOverrideMaxApps(u.overrides.maxApps?.toString() ?? '');
						setOverrideDailyAppCreations(u.overrides.dailyAppCreations?.toString() ?? '');
						setOverrideDailyLlmCredits(u.overrides.dailyLlmCredits?.toString() ?? '');
						setOverrideReason(u.overrides.reason ?? '');
					}
				}

				if (tiersRes.data) {
					setTiers(tiersRes.data.tiers);
				}
			} catch (err) {
				console.error('Failed to load user detail:', err);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => { cancelled = true; };
	}, [userId]);

	async function handleTierUpdate() {
		if (!userId || !selectedTierId) return;
		setTierSaving(true);
		try {
			await apiClient.adminUpdateUserTier(userId, selectedTierId);
			toast.success('Tier updated');
			// Refresh user data to reflect change
			const res = await apiClient.adminGetUser(userId);
			if (res.data) setUser(res.data.user);
		} catch (err) {
			toast.error('Failed to update tier');
		} finally {
			setTierSaving(false);
		}
	}

	async function handleRoleToggle() {
		if (!user || !userId) return;
		const newRole = user.role === 'admin' ? 'user' : 'admin';
		setRoleSaving(true);
		try {
			await apiClient.adminUpdateUserRole(userId, newRole as 'user' | 'admin');
			toast.success(`Role changed to ${newRole}`);
			setUser({ ...user, role: newRole });
		} catch (err) {
			toast.error('Failed to update role');
		} finally {
			setRoleSaving(false);
		}
	}

	async function handleSuspendToggle() {
		if (!user || !userId) return;
		const newSuspended = !user.isSuspended;
		setSuspendSaving(true);
		try {
			await apiClient.adminSuspendUser(userId, newSuspended);
			toast.success(newSuspended ? 'User suspended' : 'User unsuspended');
			setUser({ ...user, isSuspended: newSuspended });
		} catch (err) {
			toast.error('Failed to update suspension status');
		} finally {
			setSuspendSaving(false);
		}
	}

	async function handleSaveOverrides() {
		if (!userId) return;
		setOverrideSaving(true);
		try {
			const payload: SetUserOverridesRequest = {
				reason: overrideReason || undefined,
			};
			if (overrideMaxApps !== '') payload.maxApps = Number(overrideMaxApps);
			if (overrideDailyAppCreations !== '') payload.dailyAppCreations = Number(overrideDailyAppCreations);
			if (overrideDailyLlmCredits !== '') payload.dailyLlmCredits = Number(overrideDailyLlmCredits);

			await apiClient.adminSetUserOverrides(userId, payload);
			toast.success('Overrides saved');
			// Refresh user data
			const res = await apiClient.adminGetUser(userId);
			if (res.data) setUser(res.data.user);
		} catch (err) {
			toast.error('Failed to save overrides');
		} finally {
			setOverrideSaving(false);
		}
	}

	async function handleClearOverrides() {
		if (!userId) return;
		setOverrideSaving(true);
		try {
			await apiClient.adminRemoveUserOverrides(userId);
			toast.success('Overrides removed');
			setOverrideMaxApps('');
			setOverrideDailyAppCreations('');
			setOverrideDailyLlmCredits('');
			setOverrideReason('');
			// Refresh user data
			const res = await apiClient.adminGetUser(userId);
			if (res.data) setUser(res.data.user);
		} catch (err) {
			toast.error('Failed to remove overrides');
		} finally {
			setOverrideSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (!user) {
		return (
			<div className="space-y-4">
				<Button variant="ghost" size="sm" onClick={() => navigate('/admin/users')}>
					<ArrowLeft className="h-4 w-4 mr-1" /> Back
				</Button>
				<p className="text-muted-foreground">User not found.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6 max-w-3xl">
			<Button variant="ghost" size="sm" onClick={() => navigate('/admin/users')}>
				<ArrowLeft className="h-4 w-4 mr-1" /> Back to Users
			</Button>

			{/* User info card */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>{user.displayName || user.email}</span>
						<div className="flex gap-2">
							<Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
								{user.role}
							</Badge>
							{user.isSuspended && (
								<Badge variant="destructive">Suspended</Badge>
							)}
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent className="grid grid-cols-2 gap-4 text-sm">
					<div>
						<p className="text-muted-foreground">Email</p>
						<p>{user.email}</p>
					</div>
					<div>
						<p className="text-muted-foreground">Provider</p>
						<p className="capitalize">{user.provider}</p>
					</div>
					<div>
						<p className="text-muted-foreground">Created</p>
						<p>{formatDate(user.createdAt)}</p>
					</div>
					<div>
						<p className="text-muted-foreground">Last Active</p>
						<p>{formatDate(user.lastActiveAt)}</p>
					</div>
					<div>
						<p className="text-muted-foreground">Apps</p>
						<p>{user.appCount}</p>
					</div>
					<div>
						<p className="text-muted-foreground">Current Tier</p>
						<p>{user.tierName || 'None'}</p>
					</div>
				</CardContent>
			</Card>

			{/* Tier assignment */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Tier Assignment</CardTitle>
				</CardHeader>
				<CardContent className="flex items-end gap-4">
					<div className="flex-1 space-y-2">
						<Label>Tier</Label>
						<Select value={selectedTierId} onValueChange={setSelectedTierId}>
							<SelectTrigger>
								<SelectValue placeholder="Select a tier" />
							</SelectTrigger>
							<SelectContent>
								{tiers.map((tier) => (
									<SelectItem key={tier.id} value={tier.id}>
										{tier.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button
						onClick={handleTierUpdate}
						disabled={tierSaving || !selectedTierId || selectedTierId === user.tierId}
					>
						{tierSaving ? 'Saving...' : 'Update Tier'}
					</Button>
				</CardContent>
			</Card>

			{/* Role and suspension */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Role & Status</CardTitle>
				</CardHeader>
				<CardContent className="flex items-center gap-4">
					<Button
						variant={user.role === 'admin' ? 'destructive' : 'default'}
						onClick={handleRoleToggle}
						disabled={roleSaving}
					>
						{roleSaving
							? 'Saving...'
							: user.role === 'admin'
								? 'Demote to User'
								: 'Promote to Admin'}
					</Button>
					<Button
						variant={user.isSuspended ? 'outline' : 'destructive'}
						onClick={handleSuspendToggle}
						disabled={suspendSaving}
					>
						{suspendSaving
							? 'Saving...'
							: user.isSuspended
								? 'Unsuspend'
								: 'Suspend User'}
					</Button>
				</CardContent>
			</Card>

			{/* Overrides */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Limit Overrides</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm text-muted-foreground">
						Leave fields empty to use the tier defaults. Setting a value overrides the tier limit for this user.
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
						<div className="space-y-2">
							<Label>Max Apps</Label>
							<Input
								type="number"
								min={0}
								placeholder="Tier default"
								value={overrideMaxApps}
								onChange={(e) => setOverrideMaxApps(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label>Daily App Creations</Label>
							<Input
								type="number"
								min={0}
								placeholder="Tier default"
								value={overrideDailyAppCreations}
								onChange={(e) => setOverrideDailyAppCreations(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label>Daily LLM Credits</Label>
							<Input
								type="number"
								min={0}
								placeholder="Tier default"
								value={overrideDailyLlmCredits}
								onChange={(e) => setOverrideDailyLlmCredits(e.target.value)}
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label>Reason</Label>
						<Input
							placeholder="Why are these overrides being applied?"
							value={overrideReason}
							onChange={(e) => setOverrideReason(e.target.value)}
						/>
					</div>

					<Separator />

					<div className="flex gap-3">
						<Button onClick={handleSaveOverrides} disabled={overrideSaving}>
							{overrideSaving ? 'Saving...' : 'Save Overrides'}
						</Button>
						<Button
							variant="outline"
							onClick={handleClearOverrides}
							disabled={overrideSaving || !user.overrides}
						>
							Clear Overrides
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
