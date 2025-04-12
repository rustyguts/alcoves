ALTER TABLE `assets` RENAME COLUMN "storagePath" TO "sourceStoragePath";--> statement-breakpoint
ALTER TABLE `assets` ADD `optimizedStoragePath` text;