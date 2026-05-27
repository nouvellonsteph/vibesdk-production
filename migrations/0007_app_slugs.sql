-- Add slug column to apps table for custom deployment URLs
ALTER TABLE `apps` ADD COLUMN `slug` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_idx` ON `apps` (`slug`);
