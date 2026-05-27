import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { AdminStatsData } from '@/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminDashboard() {
	const [stats, setStats] = useState<AdminStatsData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		async function fetchStats() {
			try {
				const response = await apiClient.adminGetStats();
				if (!cancelled && response.data) {
					setStats(response.data);
				}
			} catch (err) {
				console.error('Failed to fetch admin stats:', err);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		fetchStats();
		return () => { cancelled = true; };
	}, []);

	if (loading) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Dashboard</h1>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Card key={i}>
							<CardHeader>
								<Skeleton className="h-4 w-24" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		);
	}

	if (!stats) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Dashboard</h1>
				<p className="text-muted-foreground">Failed to load stats.</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Dashboard</h1>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Total Users
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold">{stats.totalUsers}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Total Apps
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold">{stats.totalApps}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Users by Tier
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="space-y-1 text-sm">
							{stats.usersByTier.map((entry) => (
								<li key={entry.tierId} className="flex justify-between">
									<span className="text-muted-foreground">{entry.tierName}</span>
									<span className="font-medium">{entry.userCount}</span>
								</li>
							))}
							{stats.usersByTier.length === 0 && (
								<li className="text-muted-foreground">No tiers configured</li>
							)}
						</ul>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Users by Role
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="space-y-1 text-sm">
							{stats.usersByRole.map((entry) => (
								<li key={entry.role} className="flex justify-between">
									<span className="text-muted-foreground capitalize">{entry.role}</span>
									<span className="font-medium">{entry.count}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
