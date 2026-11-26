CREATE TABLE `stock_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`unit` varchar(20) NOT NULL,
	`quantity_milli` int NOT NULL DEFAULT 0,
	`low_stock_at_milli` int,
	`cost_per_unit_kobo` int,
	`active` boolean NOT NULL DEFAULT true,
	`created_by_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`item_id` bigint unsigned NOT NULL,
	`type` enum('restock','usage','waste','adjustment') NOT NULL,
	`delta_milli` int NOT NULL,
	`balance_after_milli` int NOT NULL,
	`total_cost_kobo` int,
	`note` varchar(255),
	`staff_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stock_items` ADD CONSTRAINT `stock_items_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_item_id_stock_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_staff_id_users_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;