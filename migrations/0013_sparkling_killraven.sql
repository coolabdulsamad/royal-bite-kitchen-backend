CREATE TABLE `settlement_invoice_orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	CONSTRAINT `settlement_invoice_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `sio_invoice_order_unique` UNIQUE(`invoice_id`,`order_id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_invoices` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`invoice_no` varchar(20) NOT NULL,
	`partner_connection_id` bigint unsigned NOT NULL,
	`partner_name` varchar(64) NOT NULL,
	`provider` enum('glovo','chowdeck') NOT NULL,
	`status` enum('open','paid','cancelled') NOT NULL DEFAULT 'open',
	`order_count` int NOT NULL,
	`gross_kobo` int NOT NULL,
	`commission_bps` int NOT NULL DEFAULT 0,
	`commission_kobo` int NOT NULL DEFAULT 0,
	`net_kobo` int NOT NULL,
	`period_from` timestamp NOT NULL,
	`period_to` timestamp NOT NULL,
	`note` varchar(255),
	`created_by_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`paid_at` timestamp,
	`paid_by_id` bigint unsigned,
	`payment_method` enum('cash','bank_pos','transfer'),
	`payment_reference` varchar(120),
	`commission_expense_id` bigint unsigned,
	`cancelled_at` timestamp,
	`cancelled_by_id` bigint unsigned,
	`cancel_reason` varchar(255),
	CONSTRAINT `settlement_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `settlement_invoices_invoice_no_unique` UNIQUE(`invoice_no`)
);
--> statement-breakpoint
ALTER TABLE `partner_connections` ADD `commission_bps` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlement_invoice_orders` ADD CONSTRAINT `settlement_invoice_orders_invoice_id_settlement_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `settlement_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlement_invoice_orders` ADD CONSTRAINT `settlement_invoice_orders_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlement_invoices` ADD CONSTRAINT `settlement_invoices_partner_connection_id_partner_connections_id_fk` FOREIGN KEY (`partner_connection_id`) REFERENCES `partner_connections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlement_invoices` ADD CONSTRAINT `settlement_invoices_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlement_invoices` ADD CONSTRAINT `settlement_invoices_paid_by_id_users_id_fk` FOREIGN KEY (`paid_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlement_invoices` ADD CONSTRAINT `settlement_invoices_cancelled_by_id_users_id_fk` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;