CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_by` text,
	`acceptance_id` text,
	`revoked_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invite_nonowner_role" CHECK("workspace_invites"."role" IN ('student', 'parent', 'teacher', 'editor', 'reviewer')),
	CONSTRAINT "invite_status" CHECK("workspace_invites"."status" IN ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_token_hash_unique` ON `workspace_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invite_workspace_status` ON `workspace_invites` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `workspace_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_nonowner_role" CHECK("workspace_memberships"."role" IN ('student', 'parent', 'teacher', 'editor', 'reviewer')),
	CONSTRAINT "membership_status" CHECK("workspace_memberships"."status" IN ('active', 'revoked')),
	CONSTRAINT "membership_not_owner" CHECK("workspace_memberships"."workspace_id" <> "workspace_memberships"."user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_workspace_user` ON `workspace_memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_active_email` ON `workspace_memberships` (`workspace_id`,`email`) WHERE "workspace_memberships"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `membership_one_active_student` ON `workspace_memberships` (`workspace_id`) WHERE "workspace_memberships"."status" = 'active' AND "workspace_memberships"."role" = 'student';--> statement-breakpoint
CREATE INDEX `membership_user_status` ON `workspace_memberships` (`user_id`,`status`);