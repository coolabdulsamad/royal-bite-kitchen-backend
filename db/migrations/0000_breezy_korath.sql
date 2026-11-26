CREATE TABLE `categories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `item_modifier_groups` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`item_id` bigint unsigned NOT NULL,
	`group_id` bigint unsigned NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `item_modifier_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(500),
	`price_kobo` int NOT NULL,
	`available` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`image_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `menu_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_groups` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`selection_type` enum('single','multi') NOT NULL DEFAULT 'single',
	`required` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `modifier_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_options` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`group_id` bigint unsigned NOT NULL,
	`name` varchar(80) NOT NULL,
	`price_delta_kobo` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `modifier_options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`staff_code` varchar(20) NOT NULL,
	`name` varchar(120) NOT NULL,
	`username` varchar(60) NOT NULL,
	`secret_hash` varchar(120) NOT NULL,
	`role` enum('sales','ordering-sales','manager','admin','superadmin') NOT NULL DEFAULT 'sales',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_staff_code_unique` UNIQUE(`staff_code`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `item_modifier_groups` ADD CONSTRAINT `item_modifier_groups_item_id_menu_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_modifier_groups` ADD CONSTRAINT `item_modifier_groups_group_id_modifier_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `modifier_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_options` ADD CONSTRAINT `modifier_options_group_id_modifier_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `modifier_groups`(`id`) ON DELETE no action ON UPDATE no action;