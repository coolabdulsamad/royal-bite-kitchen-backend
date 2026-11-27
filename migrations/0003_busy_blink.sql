ALTER TABLE `sales` ADD `returned_at` timestamp;--> statement-breakpoint
ALTER TABLE `sales` ADD `returned_by_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sales` ADD `return_reason` varchar(255);--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_returned_by_id_users_id_fk` FOREIGN KEY (`returned_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;