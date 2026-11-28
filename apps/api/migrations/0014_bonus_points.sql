-- Bonus points from a parent ("Daj punkty"): only ever added, never taken away.
-- SQLite can't alter a CHECK constraint, so points_ledger is rebuilt with
-- 'bonus' added to the allowed reasons, plus:
--  note:         the parent's short reason shown in the child's history (bonus only),
--  created_by:   the adult who gave the bonus,
--  client_op_id: idempotency key, so a double tap or a retry pays once.
-- No table references points_ledger, so dropping the old one is safe.
PRAGMA defer_foreign_keys = true;

CREATE TABLE points_ledger_new (
  id             TEXT PRIMARY KEY,
  member_id      TEXT NOT NULL REFERENCES member(id),
  amount         INTEGER NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN
                   ('task', 'drop_fallback', 'streak_fallback', 'shop', 'reward', 'reward_refund', 'bonus')),
  completion_id  TEXT REFERENCES completion(id),
  redemption_id  TEXT REFERENCES redemption(id),
  member_item_id TEXT REFERENCES member_item(id),
  created_at     INTEGER NOT NULL,
  note           TEXT,
  created_by     TEXT REFERENCES member(id),
  client_op_id   TEXT UNIQUE
);
INSERT INTO points_ledger_new (id, member_id, amount, reason, completion_id, redemption_id, member_item_id, created_at)
  SELECT id, member_id, amount, reason, completion_id, redemption_id, member_item_id, created_at FROM points_ledger ORDER BY rowid;
DROP TABLE points_ledger;
ALTER TABLE points_ledger_new RENAME TO points_ledger;
CREATE INDEX ledger_member ON points_ledger(member_id, created_at);
