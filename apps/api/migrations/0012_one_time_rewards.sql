-- A parent reward is either permanent (0, the default: a child may choose it
-- again and again) or one-time (1: choosing it takes it off every child's
-- shelf; a parent's refund puts it back).
ALTER TABLE reward ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0;
