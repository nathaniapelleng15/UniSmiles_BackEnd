-- Core key/value settings table used by Admin and backend cleanup jobs.
-- The default retention value is inserted only if it is not already present.

CREATE TABLE IF NOT EXISTS system_settings (
  id INT NOT NULL AUTO_INCREMENT,
  setting_group VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT 'general',
  setting_key VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  setting_value TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  value_type VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT 'string',
  description VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  is_public TINYINT(1) DEFAULT 0,
  updated_by INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_settings_key (setting_key),
  KEY idx_system_settings_updated_by (updated_by),
  CONSTRAINT fk_system_settings_user
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_settings
  (setting_group, setting_key, setting_value, value_type, description, is_public)
VALUES
  ('retention', 'session_retention_months', '6', 'number', 'Retention duration for sessions in months', 0)
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
