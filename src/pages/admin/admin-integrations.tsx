import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { FileText, Eye, EyeOff } from 'lucide-react';

interface DriveConfig {
	clientId: string;
	clientSecret: string;
	hasSecret: boolean;
	enabled: boolean;
}

export default function AdminIntegrations() {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [showSecret, setShowSecret] = useState(false);

	// Google Drive form state
	const [driveClientId, setDriveClientId] = useState('');
	const [driveClientSecret, setDriveClientSecret] = useState('');
	const [driveEnabled, setDriveEnabled] = useState(false);
	const [driveHasSecret, setDriveHasSecret] = useState(false);

	useEffect(() => {
		async function load() {
			try {
				const res = await apiClient.adminGetIntegrationConfig();
				if (res.data?.config?.googleDrive) {
					const drive = res.data.config.googleDrive;
					setDriveClientId(drive.clientId || '');
					setDriveClientSecret(drive.clientSecret || '');
					setDriveEnabled(drive.enabled || false);
					setDriveHasSecret(drive.hasSecret || false);
				}
			} catch (err) {
				console.error('Failed to load integration config:', err);
			} finally {
				setLoading(false);
			}
		}
		load();
	}, []);

	async function handleSave() {
		setSaving(true);
		try {
			const update: { clientId?: string; clientSecret?: string; enabled?: boolean } = {
				clientId: driveClientId,
				enabled: driveEnabled,
			};
			// Only send secret if user typed a new one (not the masked value)
			if (driveClientSecret && !driveClientSecret.includes('****')) {
				update.clientSecret = driveClientSecret;
			}

			await apiClient.adminUpdateIntegrationConfig({ googleDrive: update });
			toast.success('Integration configuration saved');
			setDriveHasSecret(true);
		} catch (err) {
			console.error('Failed to save integration config:', err);
			toast.error('Failed to save configuration');
		} finally {
			setSaving(false);
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

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Integrations</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Configure OAuth credentials for external service integrations.
					Users in tiers with the corresponding feature flag enabled can connect these services.
				</p>
			</div>

			{/* Google Drive */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10">
								<FileText className="h-4 w-4 text-blue-500" />
							</div>
							<span>Google Drive</span>
						</div>
						<Badge variant={driveEnabled ? 'default' : 'secondary'}>
							{driveEnabled ? 'Enabled' : 'Disabled'}
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<p className="text-sm text-muted-foreground">
						Allow users to connect their Google Drive and use documents as data sources.
						The AI agent will have tools to search and read the user's Drive files.
						Deployed apps can access Drive via the <code className="text-xs bg-muted px-1 py-0.5 rounded">drive.api</code> virtual host.
					</p>

					<Separator />

					<div className="flex items-center justify-between">
						<div>
							<Label className="text-sm font-medium">Enable Google Drive Integration</Label>
							<p className="text-xs text-muted-foreground mt-0.5">
								When enabled, users in allowed tiers can connect their Google Drive.
							</p>
						</div>
						<Switch
							checked={driveEnabled}
							onCheckedChange={setDriveEnabled}
						/>
					</div>

					<div className="space-y-4">
						<div className="space-y-2">
							<Label>Google OAuth Client ID</Label>
							<Input
								value={driveClientId}
								onChange={(e) => setDriveClientId(e.target.value)}
								placeholder="123456789-abcdefgh.apps.googleusercontent.com"
							/>
							<p className="text-xs text-muted-foreground">
								From the Google Cloud Console &gt; APIs &amp; Services &gt; Credentials
							</p>
						</div>

						<div className="space-y-2">
							<Label>Google OAuth Client Secret</Label>
							<div className="relative">
								<Input
									type={showSecret ? 'text' : 'password'}
									value={driveClientSecret}
									onChange={(e) => setDriveClientSecret(e.target.value)}
									placeholder={driveHasSecret ? 'Secret is set (enter new value to replace)' : 'GOCSPX-...'}
								/>
								<button
									type="button"
									onClick={() => setShowSecret(!showSecret)}
									className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
								>
									{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
							<p className="text-xs text-muted-foreground">
								{driveHasSecret
									? 'A secret is already configured. Enter a new value to replace it.'
									: 'Required for the OAuth flow. Never exposed to users or generated apps.'}
							</p>
						</div>
					</div>

					<div className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground space-y-2">
						<p className="font-medium text-foreground">Setup instructions:</p>
						<ol className="list-decimal list-inside space-y-1">
							<li>Go to Google Cloud Console &gt; APIs &amp; Services &gt; Credentials</li>
							<li>Create an OAuth 2.0 Client ID (Web application type)</li>
							<li>Add authorized redirect URI: <code className="bg-muted px-1 rounded">{window.location.origin}/api/integrations/google-drive/callback</code></li>
							<li>Enable the Google Drive API and Google Docs API in the API library</li>
							<li>Copy the Client ID and Client Secret here</li>
							<li>Enable the integration and set <code className="bg-muted px-1 rounded">canUseGoogleDrive: true</code> on the desired tiers</li>
						</ol>
					</div>

					<Separator />

					<div className="flex justify-end">
						<Button onClick={handleSave} disabled={saving}>
							{saving ? 'Saving...' : 'Save Configuration'}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
