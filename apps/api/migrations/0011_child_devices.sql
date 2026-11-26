-- A child can be logged in on several devices, and Settings shows how many.
-- session.kind: 'device' = the member's own phone or tablet; 'swap' = an adult
-- switched into a child's account on the adult's own phone (never counted).
ALTER TABLE session ADD COLUMN kind TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'swap'));
-- invite.add_device: a code for a child's additional device; redeeming it keeps
-- the child's other devices logged in (0 = "move to a new phone", logs them out).
ALTER TABLE invite ADD COLUMN add_device INTEGER NOT NULL DEFAULT 0;
-- Older swap sessions weren't marked. Until now every new-phone code logged out
-- all of a child's sessions, so the oldest live session of a child is the
-- child's own phone and any newer live one came from an adult's phone. A
-- session with a push token is always a real device (swap sessions never register one).
UPDATE session SET kind = 'swap'
 WHERE revoked_at IS NULL
   AND member_id IN (SELECT id FROM member WHERE role = 'child')
   AND NOT EXISTS (SELECT 1 FROM device d WHERE d.session_id = session.id)
   AND EXISTS (
     SELECT 1 FROM session e
      WHERE e.member_id = session.member_id AND e.revoked_at IS NULL
        AND (e.created_at < session.created_at OR (e.created_at = session.created_at AND e.id < session.id))
   );
