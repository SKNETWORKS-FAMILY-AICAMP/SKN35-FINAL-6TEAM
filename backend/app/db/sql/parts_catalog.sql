-- MySQL 8.4 / UTC / non-identifying foreign keys.
-- Initial creation only. Existing structures are not migrated by IF NOT EXISTS.
USE dev_database;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    display_name VARCHAR(100) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS consultations (
    consultation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    purpose VARCHAR(100) NOT NULL,
    requirements JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (consultation_id),
    KEY ix_consultations_user_created (user_id, created_at),
    CONSTRAINT fk_consultations_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS messages (
    message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    consultation_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (message_id),
    KEY ix_messages_consultation_created (consultation_id, created_at),
    CONSTRAINT ck_messages_role CHECK (role IN ('user','assistant','system','tool')),
    CONSTRAINT fk_messages_consultation FOREIGN KEY (consultation_id) REFERENCES consultations (consultation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS parts (
    part_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category VARCHAR(30) NOT NULL,
    brand VARCHAR(80) NOT NULL,
    name VARCHAR(255) NOT NULL,
    model_number VARCHAR(150) COLLATE utf8mb4_0900_bin NULL,
    specs JSON NOT NULL,
    source_url TEXT NOT NULL,
    verified_at DATETIME(6) NULL,
    current_price DECIMAL(15,2) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'KRW',
    price_source_url TEXT NULL,
    price_checked_at DATETIME(6) NULL,
    PRIMARY KEY (part_id),
    UNIQUE KEY uq_parts_identity (category, brand, name),
    KEY ix_parts_model (category, brand, model_number),
    CONSTRAINT ck_parts_category CHECK (category IN ('cpu','motherboard','ram','gpu','storage','psu','case','cooler')),
    CONSTRAINT ck_parts_price CHECK (current_price IS NULL OR current_price > 0),
    CONSTRAINT ck_parts_price_source CHECK (current_price IS NULL OR (price_source_url IS NOT NULL AND price_checked_at IS NOT NULL)),
    CONSTRAINT ck_parts_currency CHECK (currency = 'KRW')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quotes (
    quote_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    consultation_id BIGINT UNSIGNED NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    currency CHAR(3) NOT NULL DEFAULT 'KRW',
    total_amount DECIMAL(15,2) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (quote_id),
    KEY ix_quotes_consultation (consultation_id, created_at),
    CONSTRAINT ck_quotes_version CHECK (version > 0),
    CONSTRAINT ck_quotes_status CHECK (status IN ('DRAFT','CONFIRMED','ARCHIVED')),
    CONSTRAINT ck_quotes_total CHECK (total_amount IS NULL OR total_amount >= 0),
    CONSTRAINT ck_quotes_confirmed CHECK (status <> 'CONFIRMED' OR total_amount IS NOT NULL),
    CONSTRAINT ck_quotes_currency CHECK (currency = 'KRW'),
    CONSTRAINT fk_quotes_consultation FOREIGN KEY (consultation_id) REFERENCES consultations (consultation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quote_items (
    quote_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_id BIGINT UNSIGNED NOT NULL,
    part_id BIGINT UNSIGNED NOT NULL,
    part_name_snapshot VARCHAR(255) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(15,2) NULL,
    price_source_url TEXT NULL,
    price_checked_at DATETIME(6) NULL,
    configuration JSON NOT NULL,
    PRIMARY KEY (quote_item_id),
    UNIQUE KEY uq_quote_item_scope (quote_id, quote_item_id),
    KEY ix_quote_items_part (part_id),
    CONSTRAINT ck_quote_items_quantity CHECK (quantity > 0),
    CONSTRAINT ck_quote_items_price CHECK (unit_price IS NULL OR unit_price > 0),
    CONSTRAINT ck_quote_items_source CHECK (unit_price IS NULL OR (price_source_url IS NOT NULL AND price_checked_at IS NOT NULL)),
    CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id) REFERENCES quotes (quote_id),
    CONSTRAINT fk_quote_items_part FOREIGN KEY (part_id) REFERENCES parts (part_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS part_compatibility (
    compatibility_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    part_a_id BIGINT UNSIGNED NOT NULL,
    part_b_id BIGINT UNSIGNED NOT NULL,
    check_type VARCHAR(30) NOT NULL,
    support_status VARCHAR(20) NOT NULL,
    bios_scope VARCHAR(20) NOT NULL DEFAULT 'NOT_SPECIFIED',
    min_bios_version VARCHAR(50) NULL,
    conditions JSON NOT NULL,
    source_publisher VARCHAR(80) NOT NULL,
    source_url TEXT NOT NULL,
    source_updated_at DATETIME(6) NULL,
    verified_at DATETIME(6) NOT NULL,
    PRIMARY KEY (compatibility_id),
    KEY ix_compatibility_pair_type (part_a_id, part_b_id, check_type),
    KEY ix_compatibility_part_b (part_b_id),
    CONSTRAINT ck_compatibility_distinct CHECK (part_a_id <> part_b_id),
    CONSTRAINT ck_compatibility_type CHECK (check_type IN ('CPU_SUPPORT','MEMORY_QVL','KNOWN_CONFLICT')),
    CONSTRAINT ck_compatibility_status CHECK (support_status IN ('SUPPORTED','CONDITIONAL','UNSUPPORTED')),
    CONSTRAINT ck_compatibility_bios_scope CHECK (bios_scope IN ('ALL','MIN_VERSION','NOT_SPECIFIED')),
    CONSTRAINT ck_compatibility_min_bios CHECK ((bios_scope = 'MIN_VERSION' AND min_bios_version IS NOT NULL AND LENGTH(TRIM(min_bios_version)) > 0) OR (bios_scope <> 'MIN_VERSION' AND min_bios_version IS NULL)),
    CONSTRAINT fk_compatibility_part_a FOREIGN KEY (part_a_id) REFERENCES parts (part_id),
    CONSTRAINT fk_compatibility_part_b FOREIGN KEY (part_b_id) REFERENCES parts (part_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quote_validations (
    validation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_id BIGINT UNSIGNED NOT NULL,
    quote_version INT UNSIGNED NOT NULL,
    item_a_id BIGINT UNSIGNED NULL,
    item_b_id BIGINT UNSIGNED NULL,
    compatibility_id BIGINT UNSIGNED NULL,
    check_type VARCHAR(40) NOT NULL,
    result VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,
    input_snapshot JSON NOT NULL,
    evidence_snapshot JSON NOT NULL,
    checked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (validation_id),
    KEY ix_validations_quote_version (quote_id, quote_version),
    KEY ix_validations_item_a (quote_id, item_a_id),
    KEY ix_validations_item_b (quote_id, item_b_id),
    CONSTRAINT ck_validations_version CHECK (quote_version > 0),
    CONSTRAINT ck_validations_result CHECK (result IN ('PASS','FAIL','CONDITIONAL','UNKNOWN')),
    CONSTRAINT fk_validations_quote FOREIGN KEY (quote_id) REFERENCES quotes (quote_id),
    CONSTRAINT fk_validations_item_a FOREIGN KEY (quote_id, item_a_id) REFERENCES quote_items (quote_id, quote_item_id),
    CONSTRAINT fk_validations_item_b FOREIGN KEY (quote_id, item_b_id) REFERENCES quote_items (quote_id, quote_item_id),
    CONSTRAINT fk_validations_evidence FOREIGN KEY (compatibility_id) REFERENCES part_compatibility (compatibility_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
