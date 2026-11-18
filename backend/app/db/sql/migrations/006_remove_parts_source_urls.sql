-- Run through app.db.schema --migrate-part-source-urls to verify URL equivalence first.
-- TiDB prefixes the stored expression with NOT when validating existing rows.
ALTER TABLE parts ADD CONSTRAINT ck_parts_price_checked_at
    CHECK ((current_price IS NULL OR price_checked_at IS NOT NULL));
ALTER TABLE parts DROP CONSTRAINT ck_parts_price_source;
ALTER TABLE parts DROP COLUMN price_source_url;
ALTER TABLE parts DROP COLUMN source_url;
