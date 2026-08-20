-- The triggers and `_audit_ctx` were created imperatively by `AuditTriggers`, never
-- by drizzle-kit, so it does not know to drop them. They go first: a trigger left
-- behind would insert into a missing table and fail the next write to `user`.
DROP TRIGGER IF EXISTS `audit_user_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `audit_user_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `audit_user_delete`;--> statement-breakpoint
DROP TABLE IF EXISTS `_audit_ctx`;--> statement-breakpoint
DROP TABLE `audit_log`;
