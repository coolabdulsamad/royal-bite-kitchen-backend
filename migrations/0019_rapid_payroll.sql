ALTER TABLE `users` ADD COLUMN `salary_kobo` int;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `salary_note` varchar(255);--> statement-breakpoint
ALTER TABLE `account_transactions` MODIFY COLUMN `kind` enum('sale_payment','expense','transfer','money_in','money_out','adjustment','credit_repayment','payroll') NOT NULL;--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`period` varchar(7) NOT NULL,
	`status` enum('draft','paid','cancelled') NOT NULL DEFAULT 'draft',
	`total_kobo` int NOT NULL DEFAULT 0,
	`account_id` bigint unsigned,
	`note` varchar(255),
	`created_by_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`paid_at` timestamp,
	`cancelled_at` timestamp,
	CONSTRAINT `payroll_runs_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
CREATE TABLE `payroll_items` (
	`id` bigint unsigned NOT NULL AUTO_INCREMENT,
	`run_id` bigint unsigned NOT NULL,
	`staff_id` bigint unsigned NOT NULL,
	`base_kobo` int NOT NULL,
	`bonus_kobo` int NOT NULL DEFAULT 0,
	`deduction_kobo` int NOT NULL DEFAULT 0,
	`net_kobo` int NOT NULL,
	`note` varchar(255),
	CONSTRAINT `payroll_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `pi_run_staff_unique` UNIQUE(`run_id`,`staff_id`)
);--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `pr_account_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `pr_creator_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `pi_run_fk` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `pi_staff_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pr_period_idx` ON `payroll_runs` (`period`);--> statement-breakpoint
CREATE INDEX `pr_status_idx` ON `payroll_runs` (`status`);
