CREATE TABLE `sale_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sale_id` bigint unsigned NOT NULL,
	`item_id` bigint unsigned,
	`item_name` varchar(120) NOT NULL,
	`unit_price_kobo` int NOT NULL,
	`modifiers_json` varchar(2000),
	`quantity` int NOT NULL,
	`line_total_kobo` int NOT NULL,
	CONSTRAINT `sale_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sale_id` bigint unsigned NOT NULL,
	`method` enum('cash','bank_pos','transfer') NOT NULL,
	`amount_kobo` int NOT NULL,
	`reference` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sale_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`receipt_no` varchar(20) NOT NULL,
	`staff_id` bigint unsigned NOT NULL,
	`subtotal_kobo` int NOT NULL,
	`discount_kobo` int NOT NULL DEFAULT 0,
	`total_kobo` int NOT NULL,
	`status` enum('completed','held','returned') NOT NULL DEFAULT 'completed',
	`sold_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_receipt_no_unique` UNIQUE(`receipt_no`)
);
--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_sale_id_sales_id_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_item_id_menu_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_sale_id_sales_id_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_staff_id_users_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;