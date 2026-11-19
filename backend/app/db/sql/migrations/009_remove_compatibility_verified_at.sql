-- Run through app.db.schema --migrate-compatibility-verified-at.
ALTER TABLE part_compatibility DROP COLUMN verified_at;
