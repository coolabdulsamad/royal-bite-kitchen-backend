CREATE TABLE `accounts` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`code` varchar(20) NOT NULL,
	`name` varchar(80) NOT NULL,
	`type` enum('cash','bank','pos') NOT NULL,
	`active` tinyint(1) NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_code_unique` UNIQUE(`code`)
);--> statement-breakpoint
CREATE TABLE `account_transactions` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`account_id` bigint unsigned NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`amount_kobo` int NOT NULL,
	`kind` enum('sale_payment','expense','transfer','money_in','money_out','adjustment','credit_repayment') NOT NULL,
	`ref_type` varchar(30),
	`ref_id` varchar(40),
	`transfer_group` varchar(40),
	`counter_account_id` bigint unsigned,
	`note` varchar(255),
	`staff_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `account_transactions_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
ALTER TABLE `account_transactions` ADD CONSTRAINT `at_account_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_transactions` ADD CONSTRAINT `at_counter_account_fk` FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_transactions` ADD CONSTRAINT `at_staff_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `at_account_idx` ON `account_transactions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `at_kind_idx` ON `account_transactions` (`kind`);--> statement-breakpoint
CREATE INDEX `at_staff_idx` ON `account_transactions` (`staff_id`);--> statement-breakpoint
CREATE INDEX `at_group_idx` ON `account_transactions` (`transfer_group`);
