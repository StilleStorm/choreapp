-- The adult who registered the family administers it (settings, adults, removals).
ALTER TABLE family ADD COLUMN admin_member_id TEXT REFERENCES member(id);

-- Existing families: the earliest-joined parent still in the family.
UPDATE family SET admin_member_id = (
  SELECT m.id FROM member m
   WHERE m.family_id = family.id AND m.role = 'parent' AND m.removed_at IS NULL
   ORDER BY m.created_at, m.id
   LIMIT 1
)
WHERE admin_member_id IS NULL;
