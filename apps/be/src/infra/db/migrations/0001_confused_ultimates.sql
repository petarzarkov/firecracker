CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_name` text NOT NULL,
	`entity_id` text NOT NULL,
	`old_values` text,
	`new_values` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_actor_id_index` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_action_index` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_entity_name_index` ON `audit_log` (`entity_name`);--> statement-breakpoint
CREATE INDEX `audit_entity_id_index` ON `audit_log` (`entity_id`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`thumbnail_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_file_key` ON `file` (`key`);--> statement-breakpoint
CREATE INDEX `file_user_id_index` ON `file` (`user_id`);