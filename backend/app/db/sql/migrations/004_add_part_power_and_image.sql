USE dev_database;

ALTER TABLE parts
    ADD COLUMN power_draw_w DECIMAL(8,2) NULL,
    ADD COLUMN image_url TEXT NULL;

ALTER TABLE parts
    ADD CONSTRAINT ck_parts_power_draw CHECK (power_draw_w IS NULL OR power_draw_w > 0);
