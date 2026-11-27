-- Per-family cron markers, so each 5-minute run only touches families that
-- still have work today (dates are the family's local dates):
--  occ_through_date: the day the cron last topped up the two-week occurrence
--                    horizon (it then covers that day + 14),
--  reminder_date:    the day the family's daily reminder pass completed.
-- member.last_reminder_date stays: it prevents a second reminder per child.
ALTER TABLE family ADD COLUMN occ_through_date TEXT;
ALTER TABLE family ADD COLUMN reminder_date TEXT;
