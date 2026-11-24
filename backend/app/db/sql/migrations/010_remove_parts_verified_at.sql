-- Run through app.db.schema --migrate-part-verified-at to check for populated timestamps.
ALTER TABLE parts DROP COLUMN verified_at;
