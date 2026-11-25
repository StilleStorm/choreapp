-- A child's phone can belong to several families (one member per family), so
-- the same push token may be registered once per member instead of once overall.
CREATE TABLE device_new (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES member(id),
  session_id   TEXT REFERENCES session(id),
  push_token   TEXT NOT NULL,
  app_version  TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (push_token, member_id)
);
INSERT INTO device_new (id, member_id, session_id, push_token, app_version, created_at, last_seen_at)
  SELECT id, member_id, session_id, push_token, app_version, created_at, last_seen_at FROM device;
DROP TABLE device;
ALTER TABLE device_new RENAME TO device;
CREATE INDEX device_member ON device(member_id);
