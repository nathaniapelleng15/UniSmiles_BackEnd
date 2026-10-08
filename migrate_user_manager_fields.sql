-- Run once on an existing users table; skip when using the updated unismiles.sql schema.
ALTER TABLE `users`
  ADD COLUMN `service_mode` VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Self-managed',
  ADD COLUMN `notes` TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL;
