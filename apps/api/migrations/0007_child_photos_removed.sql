-- Children use avatars only (Google Play Families policy): clear uploaded child
-- photos. Their profile falls back to the default built-in picture (initials) or
-- an avatar item they own. The R2 objects are not reachable from SQL: list and
-- delete them BEFORE applying this migration (docs/setup.md, "Zdjęcia dzieci").
UPDATE member SET avatar_key = NULL WHERE role = 'child' AND avatar_key IS NOT NULL;
