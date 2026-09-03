-- Same shape as the two migrations before it, and for the same reason: the
-- container gates its startup on `prisma migrate deploy`, Prisma does not wrap
-- a migration in a transaction, and a file that fails halfway leaves an
-- installation half-migrated AND refusing to boot until somebody clears it by
-- hand over SSH.
BEGIN;

-- Who came in through which link. Until now nothing recorded it: an invitation
-- was spent and the row said only `used_at`, so "who did we let in, and on
-- whose invitation" had no answer on a public instance. It is written inside
-- the same transaction that creates the user, so the account and the record of
-- how it was created cannot come apart.
--
-- Nullable because it is also how a REVOKED invitation is told from a redeemed
-- one: revoking sets `used_at` and leaves this null.
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "redeemed_by_user_id" TEXT;

-- ON DELETE SET NULL, not CASCADE: deleting the person who was let in must not
-- delete the record that somebody was. The row survives saying "used", just no
-- longer saying by whom.
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_redeemed_by_user_id_fkey";
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_user_id_fkey"
  FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
