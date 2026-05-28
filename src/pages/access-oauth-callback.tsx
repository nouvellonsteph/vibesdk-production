/**
 * OAuth callback page for Cloudflare Access Managed OAuth.
 * The popup redirects here after IdP authentication.
 * Extracts the authorization code from the URL and sends it
 * back to the opener window via postMessage.
 */

import { useEffect } from 'react';
import { handleOAuthCallback } from '@/lib/access-oauth';

export default function AccessOAuthCallback() {
	useEffect(() => {
		handleOAuthCallback();
		// Close the popup after a short delay to ensure the message is sent
		const timer = setTimeout(() => window.close(), 1000);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div className="flex h-screen items-center justify-center bg-background">
			<div className="text-center space-y-2">
				<p className="text-lg font-medium">Authentication complete</p>
				<p className="text-sm text-muted-foreground">This window will close automatically.</p>
			</div>
		</div>
	);
}
