CREATE TABLE `bank_pos_terminals` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`provider` varchar(64),
	`terminal_code` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`notes` varchar(255),
	`created_by_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_pos_terminals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sale_payments` ADD `terminal_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `bank_pos_terminals` ADD CONSTRAINT `bank_pos_terminals_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_terminal_id_bank_pos_terminals_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `bank_pos_terminals`(`id`) ON DELETE no action ON UPDATE no action;