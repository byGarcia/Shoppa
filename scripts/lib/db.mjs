import pg from "pg";

/**
 * A `pg` client for the scripts that run inside the container.
 *
 * They cannot use the Prisma client: it is generated into `src/generated/prisma`
 * and the runner image never receives it, so `prisma/seed.ts` — today the only
 * caller, and the password rescue — talk to Postgres directly.
 * `pg` is a production dependency and is already in the image;
 * `prisma migrate deploy` is unaffected, because the CLI only needs the schema,
 * which the image does copy.
 *
 * Plain ESM and outside `src/` for the same reason as `password.mjs`: plain
 * `node` runs these files and does not resolve the `@/` alias.
 *
 * The caller owns the connection and must `end()` it — a script that leaves it
 * open never exits, and the boot command would hang between migrating and
 * serving.
 *
 * @returns {Promise<import("pg").Client>} an already-connected client
 */
export async function getClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}
