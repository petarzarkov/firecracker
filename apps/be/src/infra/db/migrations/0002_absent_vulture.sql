CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_invite_email` ON `invite` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_invite_code` ON `invite` (`code`);--> statement-breakpoint
CREATE INDEX `invite_status_index` ON `invite` (`status`);