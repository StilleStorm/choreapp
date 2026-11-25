-- Theme avatars (1.0.10): built-in avatars tied to an app theme. They are free
-- to wear for everyone (no purchase, not in the shop or drops). NULL = a normal
-- item. Rows come from seed/builtin.sql, so run the seed after this migration.
ALTER TABLE item ADD COLUMN theme TEXT;
