-- The password rescue (scripts/auth-password.mjs) rewrites a credential with no
-- session and no authentication behind it. It is the only path in the product
-- that does, which is exactly why it is the one that most needs a durable
-- record — and the enum had no value to record it with.
--
-- IF NOT EXISTS so the migration is repeatable: a run that fails after this
-- statement can be replayed without tripping over a value it already added.
-- Adding a value inside a transaction is allowed since Postgres 12 as long as
-- nothing uses it in the same transaction, and nothing here does.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
