-- Egress rules: admin-configured allowlist/denylist for outbound traffic
CREATE TABLE `egress_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rule_type` text NOT NULL DEFAULT 'allow',
	`scope` text NOT NULL DEFAULT 'global',
	`scope_id` text,
	`host_pattern` text NOT NULL,
	`created_by` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `egress_rules_scope_idx` ON `egress_rules` (`scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `egress_rules_type_idx` ON `egress_rules` (`rule_type`);
--> statement-breakpoint

-- User integrations: track connected external services (Google Drive, etc.)
CREATE TABLE `user_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`provider` text NOT NULL,
	`access_token_encrypted` text,
	`refresh_token_encrypted` text,
	`token_expires_at` integer,
	`scopes` text,
	`is_active` integer DEFAULT true,
	`last_synced_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_integrations_user_provider_idx` ON `user_integrations` (`user_id`, `provider`);
--> statement-breakpoint
CREATE INDEX `user_integrations_user_idx` ON `user_integrations` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_integrations_provider_idx` ON `user_integrations` (`provider`);
