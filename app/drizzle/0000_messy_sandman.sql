CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`exif` text,
	`sourceStoragePath` text,
	`optimizedStoragePath` text,
	`status` text DEFAULT 'PROCESSING',
	`cTime` integer DEFAULT (CURRENT_TIMESTAMP),
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` integer DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` integer DEFAULT (CURRENT_TIMESTAMP)
);
