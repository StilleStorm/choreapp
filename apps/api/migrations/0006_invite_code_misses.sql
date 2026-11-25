-- Wrong 6-digit codes count against every live invite; at the limit the code
-- (not the QR link) stops working. See docs/decisions.md.
ALTER TABLE invite ADD COLUMN code_misses INTEGER NOT NULL DEFAULT 0;
