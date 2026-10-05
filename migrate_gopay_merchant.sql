-- Additive GoPay Merchant polling integration schema.
-- Safe to rerun; provider credentials and raw provider payloads are not stored here.

SET @schema_name = DATABASE();

SET @has_session_code = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'session_code'
);
SET @ddl = IF(@has_session_code = 0,
  'ALTER TABLE sessions ADD COLUMN session_code VARCHAR(100) COLLATE utf8mb4_unicode_ci NULL AFTER id',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

-- Older local/live schemas use sessions.id as the session code.
UPDATE sessions SET session_code = id WHERE session_code IS NULL OR session_code = '';

SET @has_session_code_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'sessions' AND INDEX_NAME = 'uq_sessions_session_code'
);
SET @ddl = IF(@has_session_code_index = 0,
  'ALTER TABLE sessions ADD UNIQUE KEY uq_sessions_session_code (session_code)',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @has_payment_provider = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'payment_provider'
);
SET @ddl = IF(@has_payment_provider = 0,
  'ALTER TABLE sessions ADD COLUMN payment_provider VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''legacy_cv'' AFTER payment_verification_method',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS provider_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  merchant_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  provider_transaction_id VARCHAR(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IDR',
  transaction_status VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  payment_type VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  channel_type VARCHAR(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  provider_transaction_time DATETIME(3) NOT NULL,
  first_observed_at DATETIME(3) NOT NULL,
  last_observed_at DATETIME(3) NOT NULL,
  match_status VARCHAR(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  session_id VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  matched_at DATETIME(3) DEFAULT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_provider_transaction (provider, merchant_id, provider_transaction_id),
  KEY idx_provider_transactions_match (provider, merchant_id, match_status, amount),
  KEY idx_provider_transactions_time (provider_transaction_time),
  KEY idx_provider_transactions_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per merchant/amount acts as the active reservation slot. Rows are reused
-- after matched/released/expired; provider_transactions retains transaction history.
CREATE TABLE IF NOT EXISTS payment_amount_reservations (
  merchant_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  expected_amount DECIMAL(12,2) NOT NULL,
  session_id VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'reserved',
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (merchant_id, expected_amount),
  UNIQUE KEY uq_payment_amount_reservation_session (session_id),
  KEY idx_payment_amount_reservations_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
