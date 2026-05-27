import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { apiClient } from '@/lib/api-client';
import type { AdminUserData, AdminUsersListData, Tier } from '@/api-types';
import {
	Table,
	TableHeader,
	TableBody,
	TableRow,
	TableHead,
	TableCell,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 20;

function formatDate(date: Date | string | null): string {
	if (!date) return '-';
	return new Date(date).toLocaleDateString();
}

function userInitials(name: string): string {
	return name
		.split(' ')
		.map((p) => p[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
}

export default function AdminUsers() {
	const navigate = useNavigate();
	const [data, setData] = useState<AdminUsersListData | null>(null);
	const [tiers, setTiers] = useState<Tier[]>([]);
	const [loading, setLoading] = useState(true);

	// Filter/pagination state
	const [search, setSearch] = useState('');
	const [tierFilter, setTierFilter] = useState<string>('all');
	const [page, setPage] = useState(1);

	// Debounced search to avoid excessive API calls
	const [debouncedSearch, setDebouncedSearch] = useState('');
	useEffect(() => {
		const timeout = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(1);
		}, 300);
		return () => clearTimeout(timeout);
	}, [search]);

	const fetchUsers = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiClient.adminListUsers({
				page,
				limit: PAGE_SIZE,
				search: debouncedSearch || undefined,
				tierId: tierFilter !== 'all' ? tierFilter : undefined,
			});
			if (response.data) {
				setData(response.data);
			}
		} catch (err) {
			console.error('Failed to fetch users:', err);
		} finally {
			setLoading(false);
		}
	}, [page, debouncedSearch, tierFilter]);

	// Fetch tiers for filter dropdown
	useEffect(() => {
		async function fetchTiers() {
			try {
				const response = await apiClient.adminListTiers();
				if (response.data) {
					setTiers(response.data.tiers);
				}
			} catch (err) {
				console.error('Failed to fetch tiers:', err);
			}
		}
		fetchTiers();
	}, []);

	useEffect(() => {
		fetchUsers();
	}, [fetchUsers]);

	const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Users</h1>

			{/* Filters */}
			<div className="flex items-center gap-4">
				<Input
					placeholder="Search by email or name..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="max-w-sm"
				/>
				<Select
					value={tierFilter}
					onValueChange={(value) => {
						setTierFilter(value);
						setPage(1);
					}}
				>
					<SelectTrigger className="w-48">
						<SelectValue placeholder="All tiers" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All tiers</SelectItem>
						{tiers.map((tier) => (
							<SelectItem key={tier.id} value={tier.id}>
								{tier.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Table */}
			{loading ? (
				<div className="space-y-2">
					{Array.from({ length: 8 }).map((_, i) => (
						<Skeleton key={i} className="h-12 w-full" />
					))}
				</div>
			) : !data || data.users.length === 0 ? (
				<p className="text-muted-foreground py-8 text-center">
					No users found.
				</p>
			) : (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Tier</TableHead>
								<TableHead>Role</TableHead>
								<TableHead className="text-right">Apps</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.users.map((user: AdminUserData) => (
								<TableRow
									key={user.id}
									className="cursor-pointer hover:bg-muted/50"
									onClick={() => navigate(`/admin/users/${user.id}`)}
								>
									<TableCell>
										<div className="flex items-center gap-3">
											<Avatar className="h-8 w-8">
												{user.avatarUrl && (
													<AvatarImage src={user.avatarUrl} alt={user.displayName} />
												)}
												<AvatarFallback className="text-xs">
													{userInitials(user.displayName || user.email)}
												</AvatarFallback>
											</Avatar>
											<div className="min-w-0">
												<p className="text-sm font-medium truncate">
													{user.displayName || user.email}
												</p>
												<p className="text-xs text-muted-foreground truncate">
													{user.email}
												</p>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{user.tierName || 'None'}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
											{user.role}
										</Badge>
									</TableCell>
									<TableCell className="text-right">{user.appCount}</TableCell>
									<TableCell>
										{user.isSuspended ? (
											<Badge variant="destructive">Suspended</Badge>
										) : (
											<Badge variant="secondary">Active</Badge>
										)}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{formatDate(user.createdAt)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>

					{/* Pagination */}
					{totalPages > 1 && (
						<div className="flex items-center justify-between pt-4">
							<p className="text-sm text-muted-foreground">
								Page {data.page} of {totalPages} ({data.total} total)
							</p>
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => p - 1)}
								>
									Previous
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => p + 1)}
								>
									Next
								</Button>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
