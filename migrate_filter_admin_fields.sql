-- Run once on an existing filters table; skip when using the updated unismiles.sql schema.
ALTER TABLE `filters`
  ADD COLUMN `description` TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `css_filter` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none';
