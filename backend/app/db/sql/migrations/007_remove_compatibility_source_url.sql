-- Run through app.db.schema --migrate-compatibility-source-url to verify the evidence file first.
ALTER TABLE part_compatibility DROP COLUMN source_url;
