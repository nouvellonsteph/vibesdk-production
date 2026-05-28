# Egress Control Design

## Overview

Control outbound network traffic from sandboxes (dev previews) and deployed apps (WfP).

## Architecture

### Sandbox Egress (via @cloudflare/sandbox)

The existing `UserAppSandboxService` re-exports `Sandbox` directly (line 51 of `sandboxSdkClient.ts`).
We need a custom subclass that:

1. Sets `enableInternet = false` by default (deny-all)
2. Uses `allowedHosts` for admin-configured allowlist
3. Implements `outbound` handler for logging/auditing
4. Uses runtime methods (`setAllowedHosts`, `setDeniedHosts`) to apply per-user/per-app rules
5. Exports `ContainerProxy` for outbound interception

**Key change:** Replace `export { Sandbox as UserAppSandboxService }` with a custom class.

### Deployed App Egress (via WfP Outbound Workers)

For apps deployed to Workers for Platforms, outbound traffic filtering uses
[Outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/).
The deployer already creates dispatch namespace workers. We need to:

1. Create an outbound worker that checks egress rules
2. Configure the dispatch namespace to use the outbound worker
3. The outbound worker reads rules from KV/D1 and allows/denies

## Database Schema

```sql
-- Egress rules: admin-configured allowlist/denylist
CREATE TABLE egress_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    -- Rule type: 'allow' or 'deny'
    rule_type TEXT NOT NULL DEFAULT 'allow',
    -- Scope: 'global' (all apps), 'tier' (per tier), 'app' (per app)
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT, -- tier ID or app ID when scope != 'global'
    -- Pattern matching
    host_pattern TEXT NOT NULL, -- hostname or glob pattern (e.g., '*.google.com')
    -- Metadata
    created_by TEXT REFERENCES users(id),
    created_at INTEGER DEFAULT CURRENT_TIMESTAMP,
    updated_at INTEGER DEFAULT CURRENT_TIMESTAMP
);
```

## Admin API

- `GET /api/admin/egress-rules` -- list rules
- `POST /api/admin/egress-rules` -- create rule
- `PUT /api/admin/egress-rules/:id` -- update rule
- `DELETE /api/admin/egress-rules/:id` -- delete rule

## Rule Resolution

1. Load global rules
2. Load tier-specific rules for the user's tier
3. Load app-specific rules (if any)
4. Merge: deny rules take precedence over allow rules
5. Pass to sandbox `setAllowedHosts()`/`setDeniedHosts()` at runtime

## Implementation Steps

1. Create `egress_rules` table (migration)
2. Create `EgressRuleService` (CRUD + resolution)
3. Create custom `UserAppSandboxService` subclass with outbound filtering
4. Update sandbox creation to apply egress rules
5. Create outbound worker for WfP deployed apps
6. Admin API endpoints + frontend UI
