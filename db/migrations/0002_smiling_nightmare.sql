ALTER TABLE `sales` ADD `client_ref` varchar(64);--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_client_ref_unique` UNIQUE(`client_ref`);