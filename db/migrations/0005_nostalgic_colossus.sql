CREATE TABLE `partner_connections` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`provider` enum('glovo','chowdeck') NOT NULL,
	`name` varchar(64) NOT NULL,
	`token` varchar(80) NOT NULL,
	`store_ref` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`created_by_id` bigint unsigned,
	`last_order_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_connections_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `staff_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD `source` enum('pos','glovo','chowdeck') DEFAULT 'pos' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `external_id` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD `partner_connection_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_name` varchar(120);--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_phone` varchar(40);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_address` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `kitchen_printed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_source_external_unique` UNIQUE(`source`,`external_id`);--> statement-breakpoint
ALTER TABLE `partner_connections` ADD CONSTRAINT `partner_connections_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_partner_connection_id_partner_connections_id_fk` FOREIGN KEY (`partner_connection_id`) REFERENCES `partner_connections`(`id`) ON DELETE no action ON UPDATE no action;