CREATE TABLE `role_permissions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`role` enum('sales','ordering-sales','accountant','auditor','manager','admin','superadmin') NOT NULL,
	`domain` varchar(32) NOT NULL,
	`level` enum('none','view','manage') NOT NULL,
	`updated_by_id` bigint unsigned,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `rp_role_domain_unique` UNIQUE(`role`,`domain`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('sales','ordering-sales','accountant','auditor','manager','admin','superadmin') NOT NULL DEFAULT 'sales';--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_updated_by_id_users_id_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;