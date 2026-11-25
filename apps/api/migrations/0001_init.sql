-- ChoreApp schema. Timestamps are epoch milliseconds (UTC); calendar days
-- are 'YYYY-MM-DD' strings in the family's time zone.

CREATE TABLE family (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  quiet_from      TEXT NOT NULL DEFAULT '22:00',
  quiet_to        TEXT NOT NULL DEFAULT '07:00',
  reminder_time   TEXT NOT NULL DEFAULT '15:00',
  price_common    INTEGER NOT NULL DEFAULT 30,
  price_rare      INTEGER NOT NULL DEFAULT 80,
  price_legendary INTEGER NOT NULL DEFAULT 200,
  created_at      INTEGER NOT NULL
);

CREATE TABLE member (
  id                 TEXT PRIMARY KEY,
  family_id          TEXT NOT NULL REFERENCES family(id),
  role               TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  name               TEXT NOT NULL,
  avatar_key         TEXT,             -- uploaded photo in R2
  avatar_item_id     TEXT,             -- or an owned avatar item
  frame_item_id      TEXT,
  theme              TEXT NOT NULL DEFAULT 'kawaii',
  last_reminder_date TEXT,
  created_at         INTEGER NOT NULL,
  removed_at         INTEGER
);
CREATE INDEX member_family ON member(family_id);

CREATE TABLE parent_login (
  member_id           TEXT PRIMARY KEY REFERENCES member(id),
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  password_iterations INTEGER NOT NULL
);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,       -- SHA-256 of the bearer token
  member_id    TEXT NOT NULL REFERENCES member(id),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX session_member ON session(member_id);

CREATE TABLE device (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES member(id),
  session_id   TEXT REFERENCES session(id),
  push_token   TEXT NOT NULL UNIQUE,
  app_version  TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX device_member ON device(member_id);

-- Invitations (QR token + short code), also used to reconnect a child's new
-- phone (member_id set, role child) and to reset a parent's password
-- (member_id set, role parent).
CREATE TABLE invite (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES family(id),
  role       TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  member_id  TEXT REFERENCES member(id),
  code_hash  TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES member(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX invite_family ON invite(family_id);

CREATE TABLE task (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES family(id),
  series_id   TEXT NOT NULL,           -- shared by all versions of an edited series
  title       TEXT NOT NULL,
  icon        TEXT NOT NULL,
  description TEXT,
  points      INTEGER NOT NULL CHECK (points IN (5, 10, 20)),
  shared_mode TEXT NOT NULL DEFAULT 'each' CHECK (shared_mode IN ('each', 'any')),
  start_date  TEXT NOT NULL,
  end_date    TEXT,                    -- inclusive; set when a series is edited or deleted
  due_time    TEXT,
  recurrence  TEXT,                    -- RRULE, NULL = one-off
  created_by  TEXT NOT NULL REFERENCES member(id),
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX task_family ON task(family_id);
CREATE INDEX task_series ON task(series_id);

CREATE TABLE task_assignee (
  task_id   TEXT NOT NULL REFERENCES task(id),
  member_id TEXT NOT NULL REFERENCES member(id),
  PRIMARY KEY (task_id, member_id)
);
CREATE INDEX task_assignee_member ON task_assignee(member_id);

CREATE TABLE occurrence (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES task(id),
  date         TEXT NOT NULL,
  cancelled_at INTEGER,
  UNIQUE (task_id, date)
);
CREATE INDEX occurrence_date ON occurrence(date);

-- One row per report. A rejection keeps its row; a new report adds a new one.
CREATE TABLE completion (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrence(id),
  member_id     TEXT NOT NULL REFERENCES member(id),
  status        TEXT NOT NULL CHECK (status IN ('reported', 'approved', 'rejected', 'closed')),
  reported_at   INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   TEXT REFERENCES member(id),
  comment       TEXT,
  client_op_id  TEXT UNIQUE            -- idempotency key from the offline queue
);
CREATE INDEX completion_occurrence ON completion(occurrence_id, member_id);
CREATE INDEX completion_member ON completion(member_id, reported_at);
CREATE INDEX completion_pending ON completion(status) WHERE status = 'reported';

CREATE TABLE reward (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES family(id),
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL,
  cost       INTEGER NOT NULL CHECK (cost > 0),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX reward_family ON reward(family_id);

CREATE TABLE redemption (
  id           TEXT PRIMARY KEY,
  reward_id    TEXT NOT NULL REFERENCES reward(id),
  member_id    TEXT NOT NULL REFERENCES member(id),
  cost         INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('requested', 'delivered', 'cancelled')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT REFERENCES member(id)
);
CREATE INDEX redemption_member ON redemption(member_id);

-- Sticker / avatar / frame packs. Data, not part of the APK.
-- family_id NULL = built-in pack available to every family.
CREATE TABLE pack (
  id          TEXT PRIMARY KEY,
  family_id   TEXT REFERENCES family(id),
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,           -- where the art comes from (URL or "własne")
  license     TEXT NOT NULL,           -- e.g. "MIT", "CC0-1.0", or "private"
  attribution TEXT,                    -- required credit line, if any
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- Per-family on/off switch for built-in packs.
CREATE TABLE pack_setting (
  family_id TEXT NOT NULL REFERENCES family(id),
  pack_id   TEXT NOT NULL REFERENCES pack(id),
  active    INTEGER NOT NULL,
  PRIMARY KEY (family_id, pack_id)
);

CREATE TABLE item (
  id          TEXT PRIMARY KEY,
  pack_id     TEXT NOT NULL REFERENCES pack(id),
  kind        TEXT NOT NULL CHECK (kind IN ('sticker', 'avatar', 'frame')),
  name        TEXT NOT NULL,
  album       TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'legendary')),
  image_key   TEXT NOT NULL,
  -- NULL = only from drops. Otherwise for sale; 0 means "family default price
  -- for this rarity", any other value is a fixed price.
  price       INTEGER,
  droppable   INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER
);
CREATE INDEX item_pack ON item(pack_id);

CREATE TABLE member_item (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member(id),
  item_id       TEXT NOT NULL REFERENCES item(id),
  acquired_at   INTEGER NOT NULL,
  how           TEXT NOT NULL CHECK (how IN ('drop', 'streak', 'shop')),
  completion_id TEXT REFERENCES completion(id),
  seen_at       INTEGER,               -- for the "new sticker!" reveal
  UNIQUE (member_id, item_id)
);

CREATE TABLE points_ledger (
  id             TEXT PRIMARY KEY,
  member_id      TEXT NOT NULL REFERENCES member(id),
  amount         INTEGER NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN
                   ('task', 'drop_fallback', 'streak_fallback', 'shop', 'reward', 'reward_refund')),
  completion_id  TEXT REFERENCES completion(id),
  redemption_id  TEXT REFERENCES redemption(id),
  member_item_id TEXT REFERENCES member_item(id),
  created_at     INTEGER NOT NULL
);
CREATE INDEX ledger_member ON points_ledger(member_id, created_at);

CREATE TABLE streak_award (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member(id),
  threshold     INTEGER NOT NULL,
  streak_start  TEXT NOT NULL,
  completion_id TEXT REFERENCES completion(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX streak_award_member ON streak_award(member_id);

-- Push notifications waiting for the end of quiet hours (and a send log).
CREATE TABLE notification_outbox (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member(id),
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          TEXT,                  -- JSON
  created_at    INTEGER NOT NULL,
  deliver_after INTEGER NOT NULL,
  sent_at       INTEGER
);
CREATE INDEX outbox_pending ON notification_outbox(deliver_after) WHERE sent_at IS NULL;

CREATE TABLE kv_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE rate_limit (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

CREATE TABLE app_release (
  version_code INTEGER PRIMARY KEY,
  version_name TEXT NOT NULL,
  apk_key      TEXT NOT NULL,
  notes        TEXT,
  created_at   INTEGER NOT NULL
);
