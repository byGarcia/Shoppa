-- Same shape as 20260902152123_public_release, and for the same reason: the
-- container gates its startup on `prisma migrate deploy`, Prisma does not wrap
-- a migration in a transaction, and a file that fails halfway leaves an
-- installation half-migrated AND refusing to boot until somebody clears it by
-- hand.
BEGIN;

-- The lowercase rule arrived with first-run registration: every write and every
-- lookup normalises now. Rows written before it never did, and they can hold
-- any spelling their owner typed. A stored `Ana@example.com` used to be
-- reachable through the old raw lookup and, once the lookups were normalised,
-- became reachable by nothing at all.
--
-- If two rows normalise to the same address this UPDATE fails on the existing
-- unique constraint, inside the transaction. That is the right way for it to
-- surface: loudly, before anything is lost.
UPDATE "users" SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

-- And the invariant becomes the database's rather than the code's, so a future
-- writer that forgets normalizeEmail() is refused instead of quietly creating a
-- second account for the same person.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_key" ON "users" (lower(email));

COMMIT;
