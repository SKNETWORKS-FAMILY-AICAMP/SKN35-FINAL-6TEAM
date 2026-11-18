-- Run through app.db.schema --migrate-paid-quotes for the empty-quote precondition.
ALTER TABLE quotes
    DROP FOREIGN KEY fk_quotes_consultation,
    DROP INDEX ix_quotes_consultation,
    DROP CHECK ck_quotes_version,
    DROP CHECK ck_quotes_status,
    DROP CHECK ck_quotes_total,
    DROP CHECK ck_quotes_confirmed,
    DROP COLUMN consultation_id,
    DROP COLUMN version,
    DROP COLUMN status,
    DROP COLUMN updated_at,
    ADD COLUMN user_id BIGINT UNSIGNED NOT NULL AFTER quote_id,
    ADD COLUMN consultation_type VARCHAR(20) COLLATE utf8mb4_0900_bin NOT NULL AFTER user_id,
    ADD COLUMN payment_reference VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL AFTER consultation_type,
    ADD COLUMN paid_at DATETIME(6) NOT NULL AFTER payment_reference,
    MODIFY COLUMN total_amount DECIMAL(15,2) NOT NULL,
    ADD COLUMN performance_goal_snapshot JSON NOT NULL AFTER total_amount,
    ADD UNIQUE KEY uq_quotes_payment_reference (payment_reference),
    ADD KEY ix_quotes_user_paid (user_id, paid_at),
    ADD CONSTRAINT ck_quotes_consultation_type CHECK (consultation_type IN ('UPGRADE','NEW_BUILD')),
    ADD CONSTRAINT ck_quotes_payment_reference CHECK (REGEXP_LIKE(payment_reference, '[^[:space:]]')),
    ADD CONSTRAINT ck_quotes_total CHECK (total_amount >= 0),
    ADD CONSTRAINT ck_quotes_performance_goal CHECK (JSON_TYPE(performance_goal_snapshot) = 'OBJECT'),
    ADD CONSTRAINT fk_quotes_user FOREIGN KEY (user_id) REFERENCES users (user_id);

ALTER TABLE quote_items
    DROP CHECK ck_quote_items_price,
    DROP CHECK ck_quote_items_source,
    MODIFY COLUMN unit_price DECIMAL(15,2) NOT NULL,
    ADD COLUMN selection_basis JSON NOT NULL AFTER configuration,
    ADD CONSTRAINT ck_quote_items_price CHECK (unit_price >= 0),
    ADD CONSTRAINT ck_quote_items_source CHECK ((price_source_url IS NULL) = (price_checked_at IS NULL)),
    ADD CONSTRAINT ck_quote_items_selection_basis CHECK (JSON_TYPE(selection_basis) = 'OBJECT');

ALTER TABLE quote_validations
    DROP INDEX ix_validations_quote_version,
    DROP CHECK ck_validations_version,
    DROP COLUMN quote_version;
