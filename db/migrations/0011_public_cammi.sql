CREATE TABLE `audit_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`actor_id` bigint unsigned,
	`actor_name` varchar(120),
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` bigint unsigned,
	`detail` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;