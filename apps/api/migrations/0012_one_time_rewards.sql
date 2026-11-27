-- A parent reward is either permanent (one_time = 0, the default: a child may
-- choose it again and again) or one-time (1: choosing it takes it off every
-- child's shelf; a parent's refund puts it back).
-- used_at: when a child took a one-time reward (NULL = available). Kept apart
-- from active, which is only the parent's "visible in the shop" switch.
ALTER TABLE reward ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reward ADD COLUMN used_at INTEGER;
