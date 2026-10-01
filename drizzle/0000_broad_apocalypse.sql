CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mission` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agents_owner` ON `agents` (`owner`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`image_url` text,
	`metadata_uri` text,
	`mint` text,
	`signature` text,
	`prepared` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_drafts_owner` ON `drafts` (`owner`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_owner_time` ON `events` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`owner`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`owner` text NOT NULL,
	`agent_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`max_lamports` integer NOT NULL,
	`per_launch` integer NOT NULL,
	`max_launches` integer NOT NULL,
	`used_lamports` integer DEFAULT 0 NOT NULL,
	`used_launches` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`image_url` text,
	`recipient` text NOT NULL,
	`support_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_owner` ON `sessions` (`owner`);--> statement-breakpoint
CREATE TABLE `settings` (
	`owner` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`owner`, `key`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`url` text NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`id`, `owner`)
);
--> statement-breakpoint
CREATE INDEX `idx_signals_owner_kind` ON `signals` (`owner`,`kind`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`query` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`last_checked` text
);
--> statement-breakpoint
CREATE INDEX `idx_tracks_owner` ON `tracks` (`owner`);