-- Add reusable assets for the admin frame editor.
-- Safe to run repeatedly against MySQL 8+.

CREATE TABLE IF NOT EXISTS admin_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NOT NULL,
  name VARCHAR(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  asset_type VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'overlay',
  file_url VARCHAR(1024) COLLATE utf8mb4_unicode_ci NOT NULL,
  mime_type VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  file_size BIGINT UNSIGNED DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_assets_owner_type (admin_id, asset_type, is_active),
  CONSTRAINT fk_admin_assets_admin
    FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_asset_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'frame_templates'
    AND COLUMN_NAME = 'asset_id'
);
SET @ddl = IF(@has_asset_id = 0,
  'ALTER TABLE frame_templates ADD COLUMN asset_id BIGINT UNSIGNED NULL AFTER layout_config',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @has_asset_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'frame_templates'
    AND INDEX_NAME = 'idx_frame_templates_asset'
);
SET @ddl = IF(@has_asset_index = 0,
  'ALTER TABLE frame_templates ADD INDEX idx_frame_templates_asset (asset_id)',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @has_asset_fk = (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'frame_templates'
    AND CONSTRAINT_NAME = 'fk_ft_asset'
);
SET @ddl = IF(@has_asset_fk = 0,
  'ALTER TABLE frame_templates ADD CONSTRAINT fk_ft_asset FOREIGN KEY (asset_id) REFERENCES admin_assets (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
