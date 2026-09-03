-- The container gates its startup on this file. Its boot command (the CMD in
-- the Dockerfile) is three steps chained with &&: `prisma migrate deploy`, then
-- the seed, then `next start`. Prisma 7.9.1 does NOT wrap a migration in a
-- transaction, so this one wraps itself. Without the BEGIN, a statement failing
-- halfway leaves an installation's only copy of its data half-migrated AND the
-- application refusing to boot on every restart until somebody clears the
-- failed migration by hand. Every statement is also written to be safe on a
-- second run, so that a retry is a retry and not a second kind of failure.
--
-- The seed is the step after this one, and the `seeded_at` back-fill below is
-- what the two agree on: this file marks an installation that already has its
-- categories as seeded, so the seed that runs seconds later leaves them alone.
BEGIN;

-- AlterTable
ALTER TABLE "grocery_categories" ADD COLUMN IF NOT EXISTS "name_key" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "instance_setup" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "claimed_at" TIMESTAMP(3),
    "seeded_at" TIMESTAMP(3),

    CONSTRAINT "instance_setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "invitations" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invitations_expires_at_idx" ON "invitations"("expires_at");

-- AddForeignKey
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS. Dropping first is what makes
-- this re-runnable, and it is safe only because of the transaction above: the
-- window in which the table has no foreign key is never visible to anybody.
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_created_by_user_id_fkey";
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One singleton row, and a constraint so it stays singular. Same reason as
-- above for the drop.
ALTER TABLE "instance_setup" DROP CONSTRAINT IF EXISTS "instance_setup_singleton";
ALTER TABLE "instance_setup" ADD CONSTRAINT "instance_setup_singleton" CHECK (id = 'singleton');
INSERT INTO "instance_setup" (id) VALUES ('singleton') ON CONFLICT DO NOTHING;

-- An installation that already has users has already been claimed. Without
-- this, an upgrade would look like a fresh instance waiting to be taken.
UPDATE "instance_setup" SET claimed_at = now()
  WHERE claimed_at IS NULL AND EXISTS (SELECT 1 FROM "users");

-- Likewise for the seed: an installation being upgraded already has its own.
UPDATE "instance_setup" SET seeded_at = now()
  WHERE seeded_at IS NULL
    AND EXISTS (SELECT 1 FROM "grocery_categories" WHERE id LIKE 'gcat-%');

-- name_key is claimed ONLY where the stored name is still the canonical one.
-- A category somebody already renamed keeps name_key NULL, so the interface
-- keeps showing their name instead of quietly translating over it. The names
-- below were read from a production installation on 2026-09-02 and must stay
-- byte-for-byte identical to prisma/seed-data.ts and to the record of that
-- reading in prisma/factory-categories.md.
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-frutas-verduras' AND name = 'Frutas y verduras';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-carne-pescado' AND name = 'Carne y pescado';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-lacteos' AND name = 'Lácteos';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-panaderia' AND name = 'Panadería';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-congelados' AND name = 'Congelados';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-bebidas' AND name = 'Bebidas';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-despensa' AND name = 'Despensa';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-limpieza' AND name = 'Limpieza';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-higiene' AND name = 'Higiene';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-hogar' AND name = 'Hogar';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-mascotas' AND name = 'Mascotas';
UPDATE "grocery_categories" SET name_key = id
  WHERE id = 'gcat-otros' AND name = 'Otros';

COMMIT;
