CREATE TABLE `uploaded_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`purpose` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_files_object_key_unique` ON `uploaded_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `uploaded_files_owner` ON `uploaded_files` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
