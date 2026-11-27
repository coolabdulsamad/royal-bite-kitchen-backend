ALTER TABLE `expenses` ADD `status` enum('pending','approved','rejected') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `decided_by_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `expenses` ADD `decided_at` timestamp;--> statement-breakpoint
ALTER TABLE `expenses` ADD `reject_reason` varchar(255);--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_decided_by_id_users_id_fk` FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;