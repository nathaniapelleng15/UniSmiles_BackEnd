-- Legacy print event history used by dashboard reports.

CREATE TABLE IF NOT EXISTS print_logs (
  id INT NOT NULL AUTO_INCREMENT,
  kiosk_id VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  session_id VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'success',
  paper_stock_left INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_print_logs_kiosk (kiosk_id),
  KEY idx_print_logs_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The production print_logs table already has its own columns. Add only the
-- kiosk inventory field required by the legacy report endpoint when missing.
DROP PROCEDURE IF EXISTS unismiles_add_print_stock_column_if_missing;
DELIMITER //
CREATE PROCEDURE unismiles_add_print_stock_column_if_missing()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'print_logs'
      AND COLUMN_NAME = 'paper_stock_left'
  ) THEN
    ALTER TABLE print_logs ADD COLUMN paper_stock_left INT DEFAULT NULL;
  END IF;
END //
DELIMITER ;

CALL unismiles_add_print_stock_column_if_missing();
DROP PROCEDURE IF EXISTS unismiles_add_print_stock_column_if_missing;
