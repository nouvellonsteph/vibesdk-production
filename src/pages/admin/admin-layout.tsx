import { Outlet, NavLink, Navigate } from 'react-router';
import { useAuth } from '@/contexts/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { LayoutDashboard, Users, Layers, ShieldCheck, Plug } from 'lucide-react';

const NAV_ITEMS = [
	{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/admin/users', label: 'Users', icon: Users, end: false },
	{ to: '/admin/tiers', label: 'Tiers', icon: Layers, end: false },
	{ to: '/admin/egress', label: 'Egress Rules', icon: ShieldCheck, end: false },
	{ to: '/admin/integrations', label: 'Integrations', icon: Plug, end: false },
] as const;

export default function AdminLayout() {
	const { user, isAuthenticated, isLoading } = useAuth();

	if (isLoading) {
		return (
			<div className="flex h-screen">
				<div className="w-56 border-r p-4 space-y-3">
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
				</div>
				<div className="flex-1 p-8">
					<Skeleton className="h-8 w-48 mb-6" />
					<Skeleton className="h-64 w-full" />
				</div>
			</div>
		);
	}

	if (!isAuthenticated || user?.role !== 'admin') {
		return <Navigate to="/" replace />;
	}

	return (
		<div className="flex h-screen">
			<nav className="w-56 border-r bg-muted/30 flex flex-col">
				<div className="px-4 py-5 border-b">
					<h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
						Admin
					</h2>
				</div>
				<div className="flex-1 py-2">
					{NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
						<NavLink
							key={to}
							to={to}
							end={end}
							className={({ isActive }) =>
								`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
									isActive
										? 'bg-accent text-accent-foreground font-medium'
										: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
								}`
							}
						>
							<Icon className="h-4 w-4" />
							{label}
						</NavLink>
					))}
				</div>
			</nav>
			<main className="flex-1 overflow-y-auto p-8">
				<Outlet />
			</main>
		</div>
	);
}
