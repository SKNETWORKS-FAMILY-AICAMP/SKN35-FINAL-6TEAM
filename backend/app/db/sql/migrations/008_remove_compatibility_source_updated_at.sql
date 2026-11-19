-- Run through app.db.schema --migrate-compatibility-source-updated-at.
ALTER TABLE part_compatibility DROP COLUMN source_updated_at;
