CREATE TABLE `order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`item_id` bigint unsigned,
	`item_name` varchar(120) NOT NULL,
	`unit_price_kobo` int NOT NULL,
	`modifiers_json` varchar(2000),
	`quantity` int NOT NULL,
	`line_total_kobo` int NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_no` varchar(20) NOT NULL,
	`status` enum('placed','preparing','ready','served','completed','cancelled') NOT NULL DEFAULT 'placed',
	`label` varchar(64) NOT NULL,
	`notes` varchar(500),
	`staff_id` bigint unsigned NOT NULL,
	`sale_id` bigint unsigned,
	`total_kobo` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`cancelled_at` timestamp,
	`cancelled_by_id` bigint unsigned,
	`cancel_reason` varchar(255),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_no_unique` UNIQUE(`order_no`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_item_id_menu_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_staff_id_users_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_sale_id_sales_id_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_cancelled_by_id_users_id_fk` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;