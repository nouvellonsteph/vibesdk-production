# Google Drive Integration Design

## Overview

Allow users to connect their Google Drive and use documents as data sources
for vibe-coded apps. The integration is exposed to the AI agent as a tool.

## Architecture

### User Flow

1. User goes to Settings > Integrations > Google Drive
2. Clicks "Connect Google Drive"
3. OAuth popup requests Drive/Docs scopes (in addition to existing auth scopes)
4. After consent, refresh token stored encrypted in D1
5. User enables Drive integration for their apps
6. The AI coding agent can now use Google Drive as a data source

### OAuth Scopes

Extend the existing Google OAuth to request additional scopes:

- `https://www.googleapis.com/auth/drive.readonly` -- read files and metadata
- `https://www.googleapis.com/auth/documents.readonly` -- read Google Docs content

These are requested in a **separate OAuth flow** from the login flow (incremental consent).
The login flow keeps minimal scopes. Drive access is opt-in.

### Data Model

```sql
-- User integrations: track connected services
CREATE TABLE user_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- 'google_drive'
    -- Encrypted OAuth tokens
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at INTEGER,
    -- Scopes granted
    scopes TEXT, -- JSON array of granted scopes
    -- Status
    is_active INTEGER DEFAULT true,
    last_synced_at INTEGER,
    -- Metadata
    created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
    updated_at INTEGER DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
);
```

### Google Drive API Client

`worker/services/integrations/GoogleDriveService.ts`:

- `listFiles(query?)` -- list files in Drive
- `getFile(fileId)` -- get file metadata
- `getFileContent(fileId)` -- download file content
- `getDocContent(docId)` -- get Google Docs content as structured text
- `searchFiles(query)` -- search by name/content

### Agent Tool

`worker/agents/tools/toolkit/google-drive.ts`:

Exposed as a tool to the AI coding agent:

```typescript
tool({
    name: 'google_drive_search',
    description: 'Search the user\'s Google Drive for documents. Use this when the user references Google Docs, Sheets, or Drive files.',
    args: {
        query: t.string('Search query for file names or content'),
    },
    run: async ({ query }) => {
        // Uses the user's Drive OAuth token
        // Returns list of matching files with titles and IDs
    },
});

tool({
    name: 'google_drive_read',
    description: 'Read the content of a Google Drive document. Returns the text content of the specified file.',
    args: {
        fileId: t.string('The Google Drive file ID'),
    },
    run: async ({ fileId }) => {
        // Returns the document content as text
    },
});
```

The tools are only registered when the user has an active Google Drive integration.

### Tier Gating

The Drive integration is gated by a tier feature flag:
- Add `canUseGoogleDrive` to `TierFeatures`
- Only users in tiers with this feature can connect Drive

### API Endpoints

- `GET /api/integrations` -- list user's integrations
- `POST /api/integrations/google-drive/connect` -- initiate OAuth
- `GET /api/integrations/google-drive/callback` -- OAuth callback
- `DELETE /api/integrations/google-drive` -- disconnect
- `GET /api/integrations/google-drive/files` -- list files (for UI)
- `GET /api/integrations/google-drive/files/:id` -- get file content

### Frontend

Settings > Integrations page:
- Google Drive card: Connect/Disconnect button
- File browser when connected
- Scopes granted display

## Implementation Steps

1. Create `user_integrations` table (migration)
2. Add `canUseGoogleDrive` to tier features
3. Build Google Drive OAuth flow (separate from login)
4. Build `GoogleDriveService` (API client)
5. Build Drive integration API endpoints
6. Create agent tools for Drive access
7. Register tools conditionally in `buildTools()`
8. Frontend: integration settings page
