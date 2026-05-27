import type { RouteObject } from 'react-router';
import React from 'react';

import App from './App';
import Home from './routes/home';
import Chat from './routes/chat/chat';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import AppsPage from './routes/apps';
import AppView from './routes/app';
import DiscoverPage from './routes/discover';
import { ProtectedRoute } from './routes/protected-route';

// Admin pages (role guard handled inside AdminLayout)
import AdminLayout from './pages/admin/admin-layout';
import AdminDashboard from './pages/admin/admin-dashboard';
import AdminUsers from './pages/admin/admin-users';
import AdminUserDetail from './pages/admin/admin-user-detail';
import AdminTiers from './pages/admin/admin-tiers';

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				index: true,
				Component: Home,
			},
			{
				path: 'chat/:chatId',
				Component: Chat,
			},
			{
				path: 'profile',
				element: React.createElement(ProtectedRoute, { children: React.createElement(Profile) }),
			},
			{
				path: 'settings',
				element: React.createElement(ProtectedRoute, { children: React.createElement(Settings) }),
			},
			{
				path: 'apps',
				element: React.createElement(ProtectedRoute, { children: React.createElement(AppsPage) }),
			},
			{
				path: 'app/:id',
				Component: AppView,
			},
			{
				path: 'discover',
				Component: DiscoverPage,
			},
			{
				path: 'admin',
				Component: AdminLayout,
				children: [
					{
						index: true,
						Component: AdminDashboard,
					},
					{
						path: 'users',
						Component: AdminUsers,
					},
					{
						path: 'users/:userId',
						Component: AdminUserDetail,
					},
					{
						path: 'tiers',
						Component: AdminTiers,
					},
				],
			},
		],
	},
] satisfies RouteObject[];

export { routes };
