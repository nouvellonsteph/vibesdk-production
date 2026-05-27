-- Tiers table: defines usage plans
CREATE TABLE `tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`max_apps` integer NOT NULL DEFAULT 3,
	`daily_app_creations` integer NOT NULL DEFAULT 2,
	`daily_llm_credits` integer NOT NULL DEFAULT 100,
	`max_custom_providers` integer NOT NULL DEFAULT 0,
	`features` text NOT NULL DEFAULT '{}',
	`sort_order` integer NOT NULL DEFAULT 0,
	`is_default` integer DEFAULT false,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tiers_name_idx` ON `tiers` (`name`);
--> statement-breakpoint

-- Seed default tiers (must exist before users.tier_id references them)
INSERT INTO `tiers` (`id`, `name`, `description`, `max_apps`, `daily_app_creations`, `daily_llm_credits`, `max_custom_providers`, `features`, `sort_order`, `is_default`) VALUES
('free', 'Free', 'Free tier with basic access', 3, 2, 100, 0, '{"canDeploy":false,"canExportGithub":false,"canUseCustomModels":false,"canMakePublic":false}', 0, true);
--> statement-breakpoint
INSERT INTO `tiers` (`id`, `name`, `description`, `max_apps`, `daily_app_creations`, `daily_llm_credits`, `max_custom_providers`, `features`, `sort_order`, `is_default`) VALUES
('builder', 'Builder', 'For individual builders and creators', 15, 5, 300, 3, '{"canDeploy":true,"canExportGithub":true,"canUseCustomModels":true,"canMakePublic":true}', 1, false);
--> statement-breakpoint
INSERT INTO `tiers` (`id`, `name`, `description`, `max_apps`, `daily_app_creations`, `daily_llm_credits`, `max_custom_providers`, `features`, `sort_order`, `is_default`) VALUES
('team', 'Team', 'For teams and organizations', 50, 15, 1000, 10, '{"canDeploy":true,"canExportGithub":true,"canUseCustomModels":true,"canMakePublic":true}', 2, false);
--> statement-breakpoint

-- Tier overrides: per-user limit overrides set by admins
CREATE TABLE `tier_overrides` (
	`user_id` text PRIMARY KEY NOT NULL,
	`max_apps` integer,
	`daily_app_creations` integer,
	`daily_llm_credits` integer,
	`max_custom_providers` integer,
	`features` text,
	`reason` text,
	`set_by` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tier_overrides_set_by_idx` ON `tier_overrides` (`set_by`);
--> statement-breakpoint

-- Add tier_id and role columns to users table
-- SQLite ALTER TABLE does not support REFERENCES with DEFAULT, so we omit the FK constraint here.
-- The Drizzle schema defines the relationship; the application layer enforces referential integrity.
ALTER TABLE `users` ADD COLUMN `tier_id` text DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `role` text DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX `users_tier_id_idx` ON `users` (`tier_id`);
--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);
