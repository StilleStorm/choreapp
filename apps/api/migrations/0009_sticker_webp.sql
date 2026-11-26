-- Built-in stickers are now 192 px WebP rasters instead of heavy Fluent Emoji
-- SVGs (slow to draw in grids). Same paths, new extension. Deploy the Worker
-- first (it serves both the .webp files and, for one release, the old .svg),
-- then apply this migration and the seed (seed/builtin.sql sets the same keys).
UPDATE item SET image_key = substr(image_key, 1, length(image_key) - 4) || '.webp'
WHERE image_key LIKE 'builtin/stickers/%.svg';
