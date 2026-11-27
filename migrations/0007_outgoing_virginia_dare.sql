CREATE TABLE `customer_payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`amount_kobo` int NOT NULL,
	`method` enum('cash','bank_pos','transfer') NOT NULL,
	`reference` varchar(120),
	`note` varchar(255),
	`received_by_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`phone` varchar(40),
	`notes` varchar(255),
	`credit_balance_kobo` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_by_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sales` ADD `credit_kobo` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_received_by_id_users_id_fk` FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;