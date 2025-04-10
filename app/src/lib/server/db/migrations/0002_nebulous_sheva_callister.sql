PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storagePath` text,
	`status` text DEFAULT 'PROCESSING',
	`cTime` integer DEFAULT (CURRENT_TIMESTAMP),
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` integer DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "storagePath", "status", "cTime", "createdAt", "updatedAt") SELECT "id", "storagePath", "status", "cTime", "createdAt", "updatedAt" FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;