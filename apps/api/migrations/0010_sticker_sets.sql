-- 20 original sticker sets (AI-generated art for Stille Storm Studio), one
-- built-in pack each: builtin-set-<slug>, items set-<slug>-<key>, images under
-- builtin/stickers/<slug>/. Like every built-in pack (family_id NULL) they reach
-- all families through seed/builtin.sql, switched on by default. Deploy the
-- Worker first (it serves the new images), then this migration, then the seed.
-- Make sure no family starts with one of the new packs switched off.
DELETE FROM pack_setting WHERE pack_id LIKE 'builtin-set-%';
