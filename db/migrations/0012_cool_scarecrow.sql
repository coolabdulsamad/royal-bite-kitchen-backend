CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` varchar(500) NOT NULL,
	`updated_by_id` bigint unsigned,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_updated_by_id_users_id_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;