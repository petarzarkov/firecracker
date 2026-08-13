CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_index` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_provider_id_index` ON `account` (`provider_id`);--> statement-breakpoint
CREATE TABLE `game_bet` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`user_id` text NOT NULL,
	`bet_amount_cents` integer NOT NULL,
	`cashed_out_at_x100` integer,
	`payout_cents` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `game_round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_bet_round_id_index` ON `game_bet` (`round_id`);--> statement-breakpoint
CREATE INDEX `game_bet_user_id_index` ON `game_bet` (`user_id`);--> statement-breakpoint
CREATE INDEX `game_bet_status_index` ON `game_bet` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `game_bet_round_user_demo_index` ON `game_bet` (`round_id`,`user_id`,`is_demo`);--> statement-breakpoint
CREATE TABLE `game_round` (
	`id` text PRIMARY KEY NOT NULL,
	`seed` text NOT NULL,
	`seed_hash` text NOT NULL,
	`client_seed` text,
	`nonce` integer DEFAULT 0 NOT NULL,
	`rng_algorithm` text DEFAULT 'pcg64' NOT NULL,
	`crash_point_x100` integer,
	`status` text DEFAULT 'waiting' NOT NULL,
	`waiting_ends_at` integer,
	`started_at` integer,
	`crashed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_round_status_index` ON `game_round` (`status`);--> statement-breakpoint
CREATE INDEX `game_round_created_at_index` ON `game_round` (`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_session_token` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_index` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UQ_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_index` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `wallet_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`balance_after_cents` integer NOT NULL,
	`game_bet_id` text,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_bet_id`) REFERENCES `game_bet`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wallet_transaction_wallet_id_index` ON `wallet_transaction` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `wallet_transaction_type_index` ON `wallet_transaction` (`type`);--> statement-breakpoint
CREATE TABLE `wallet` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_user_id_is_demo_index` ON `wallet` (`user_id`,`is_demo`);