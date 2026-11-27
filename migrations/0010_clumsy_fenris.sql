CREATE TABLE `drawer_counts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`counted_kobo` int NOT NULL,
	`expected_kobo` int NOT NULL,
	`note` varchar(255),
	`counted_by_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drawer_counts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`category` enum('supplies','utilities','wages','rent','transport','equipment','other') NOT NULL,
	`amount_kobo` int NOT NULL,
	`note` varchar(500) NOT NULL,
	`method` enum('cash','bank_pos','transfer') NOT NULL,
	`staff_id` bigint unsigned NOT NULL,
	`expense_at` timestamp NOT NULL DEFAULT (now()),
	`voided_at` timestamp,
	`voided_by_id` bigint unsigned,
	`void_reason` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `drawer_counts` ADD CONSTRAINT `drawer_counts_counted_by_id_users_id_fk` FOREIGN KEY (`counted_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_staff_id_users_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_voided_by_id_users_id_fk` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;