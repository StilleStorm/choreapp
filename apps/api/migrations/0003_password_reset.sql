-- Forgotten password (adults only): a 6-digit code sent by e-mail. Only its hash is stored.
CREATE TABLE password_reset (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES member(id),
  code_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX password_reset_member ON password_reset(member_id);
