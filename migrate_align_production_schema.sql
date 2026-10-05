-- Bring the local schema up to the production dump (uniin_unismiles_dump.sql).
-- Forward-only and additive: preserve local data and GoPay/printing extensions.

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `kiosk_id` VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `session_id` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `module` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` TEXT COLLATE utf8mb4_unicode_ci,
  `ip_address` VARCHAR(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` TEXT COLLATE utf8mb4_unicode_ci,
  `metadata` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Match the production table definition. Its current production schema does
-- not define a primary key or AUTO_INCREMENT for `id`.
CREATE TABLE IF NOT EXISTS `email_logs` (
  `id` BIGINT UNSIGNED NOT NULL,
  `session_id` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `photo_id` BIGINT UNSIGNED DEFAULT NULL,
  `recipient_email` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider` VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` ENUM('pending','sent','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `error_message` TEXT COLLATE utf8mb4_unicode_ci,
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS `unismiles_add_column_if_missing`;
DELIMITER //
CREATE PROCEDURE `unismiles_add_column_if_missing`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Production kiosk fields used by kiosk management and kiosk authentication.
CALL `unismiles_add_column_if_missing`('kiosks', 'base_price', 'DECIMAL(10,2) DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('kiosks', 'orientation', "VARCHAR(50) DEFAULT 'PORTRAIT 1080x1920'");

-- Production print configuration fields, used by the admin and kiosk clients.
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'allowed_layouts', 'LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'thermal_density', "TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'Kepekatan cetak termal 1-5'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'thermal_offset_y_px', "SMALLINT NOT NULL DEFAULT 0 COMMENT 'Geser vertikal cetak (px)'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'photo_fit_mode', "VARCHAR(10) NOT NULL DEFAULT 'fit' COMMENT 'fit atau stretch'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'print_sharpen', 'INT NOT NULL DEFAULT 0');
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'grayscale_algorithm', "VARCHAR(16) NOT NULL DEFAULT 'rec601'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'show_email_button', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'show_retake_button', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'show_print_button', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'photo_brightness', "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Kecerahan foto hasil (%) 50-150'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'photo_contrast', "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Kontras foto hasil (%) 50-150'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'photo_saturation', "TINYINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Saturasi foto hasil (%) 0-150'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'thermal_offset_x_px', "SMALLINT NOT NULL DEFAULT 0 COMMENT 'Geser mendatar cetak (px); positif = kanan'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'print_margin_top_px', "SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Margin kosong atas (px)'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'print_margin_right_px', "SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Margin kosong kanan (px)'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'print_margin_left_px', "SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Margin kosong kiri (px)'");
CALL `unismiles_add_column_if_missing`('kiosk_printing_configs', 'print_margin_bottom_px', "SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Margin kosong bawah (px)'");

DROP PROCEDURE IF EXISTS `unismiles_add_check_if_missing`;
DELIMITER //
CREATE PROCEDURE `unismiles_add_check_if_missing`(
  IN p_table VARCHAR(64),
  IN p_constraint VARCHAR(64),
  IN p_expression TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint
      AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint, '` CHECK (', p_expression, ')');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL `unismiles_add_check_if_missing`('kiosk_printing_configs', 'chk_kpc_allowed_layouts_valid', 'JSON_VALID(`allowed_layouts`)');
DROP PROCEDURE IF EXISTS `unismiles_add_check_if_missing`;

-- The production schema permits paper size labels longer than the old local
-- VARCHAR(20) limit (for example, named paper formats).
ALTER TABLE `kiosk_printing_configs`
  MODIFY COLUMN `paper_size` VARCHAR(50) NOT NULL DEFAULT '4R';

-- Production payment verification review and processing fields.
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'blur_score', 'DECIMAL(7,2) DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'challenge_passed', 'TINYINT(1) DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'reviewed_by', 'INT DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'review_reason', 'VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'reviewed_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('payment_verification_attempts', 'processing_ms', 'INT DEFAULT NULL');

-- Production allows longer kiosk identifiers in verification audit records.
ALTER TABLE `payment_verification_attempts`
  MODIFY COLUMN `kiosk_id` VARCHAR(100) NOT NULL;

-- Production print history fields; keep local `paper_stock_left` for the
-- existing kiosk print reporting API.
CALL `unismiles_add_column_if_missing`('print_logs', 'photo_id', 'BIGINT UNSIGNED DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('print_logs', 'printer_name', 'VARCHAR(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('print_logs', 'copies', 'INT DEFAULT 1');
CALL `unismiles_add_column_if_missing`('print_logs', 'error_message', 'TEXT COLLATE utf8mb4_unicode_ci');
CALL `unismiles_add_column_if_missing`('print_logs', 'printed_at', 'DATETIME DEFAULT NULL');

-- Production user profile fields.
CALL `unismiles_add_column_if_missing`('users', 'avatar_url', 'VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('users', 'deleted_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('users', 'email_verified_at', 'DATETIME DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('users', 'full_name', 'VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('users', 'last_login_at', 'DATETIME DEFAULT NULL');
CALL `unismiles_add_column_if_missing`('users', 'phone', 'VARCHAR(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL');

DROP PROCEDURE IF EXISTS `unismiles_add_column_if_missing`;

-- Widen paper_size to match production's VARCHAR(50) while keeping local-only
-- GoPay tables/columns and print calibration fields intact.
