import { pathToFileURL } from "node:url";

import { getClient } from "../scripts/lib/db.mjs";
import { cargaEnvLocal } from "../src/entorno.ts";
import { FACTORY_CATEGORIES, FACTORY_HINTS } from "./seed-data.ts";

/**
 * The seed. It runs from the container's boot command, between
 * `prisma migrate deploy` and `next start`, so a fresh installation opens with
 * the twelve categories and a dictionary instead of an empty screen.
 *
 * Two rules decide everything here:
 *
 * 1. It talks to Postgres through `pg`, never through the Prisma client. The
 *    generated client lives in `src/generated/prisma` and does not reach the
 *    runner image; `scripts/lib/db.mjs` explains the arrangement.
 *
 * 2. Idempotent means insert-only. It never updates a row: not a `name` an
 *    installation renamed, not an `icon` or an `order` it reordered, not a
 *    dictionary entry it corrected. Every statement is an INSERT with
 *    ON CONFLICT DO NOTHING, which is the SQL for `skipDuplicates`.
 *
 * What keeps a deleted category deleted is `instance_setup.seeded_at`, and
 * nothing else. Once it is set the seed returns without looking at any table.
 * Clearing it by hand puts the factory rows back — insert-only means a row that
 * is not there gets inserted, and telling the two cases apart would need a
 * tombstone table recording every category anybody ever deleted. That is a lot
 * of machinery for a case that only arises when somebody deliberately resets
 * the marker, so the guard is the contract and `pnpm db:seed` says so.
 */
export interface SeedResult {
  /**
   * - `seeded`: it wrote. The counts say what.
   * - `already-seeded`: the guard was set, so it wrote nothing. The ordinary case,
   *   on every restart of every installation.
   * - `no-guard-row`: `instance_setup` has no row, so there is nowhere to
   *   record the guard and it refused to write. Not the same thing as the case
   *   above and it must not be reported as it: an installation in this state
   *   has no categories and will never get any until somebody puts the row
   *   back.
   */
  status: "seeded" | "already-seeded" | "no-guard-row";
  categories: number;
  hints: number;
}

export async function runSeed(): Promise<SeedResult> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // FOR UPDATE, not a plain read: two containers booting at once queue on
    // this row, and the second one re-reads it after the first commits, sees
    // the marker and skips. Without the lock both would pass the check and race
    // on the inserts, where ON CONFLICT would save the data but not the noise.
    const guard = await client.query<{ seeded_at: Date | null }>(
      `SELECT seeded_at FROM instance_setup WHERE id = 'singleton' FOR UPDATE`,
    );
    if (guard.rowCount === 0) {
      // The migration creates this row and a CHECK keeps it singular, but a
      // DELETE is still possible and there would be nowhere to record the
      // guard: seeding would then repeat on every boot and resurrect whatever
      // the household had removed. Doing nothing is the conservative answer.
      await client.query("COMMIT");
      return { status: "no-guard-row", categories: 0, hints: 0 };
    }
    if (guard.rows[0].seeded_at !== null) {
      await client.query("COMMIT");
      return { status: "already-seeded", categories: 0, hints: 0 };
    }

    // `name` is the Spanish name, the same string the migration's name_key
    // back-fill matches against and the same one recorded in
    // prisma/factory-categories.md. The interface does not show it: name_key
    // is the id, so the screen shows the translation of that key in whichever
    // language the browser asks for. It only surfaces if somebody renames the
    // category, and then it is their own text. Storing the same names on every
    // installation is what keeps a fresh database and an upgraded one identical.
    const categories = await client.query(
      `INSERT INTO grocery_categories (id, name, name_key, icon, "order", created_at, updated_at)
       SELECT id, name, id, icon, ord, now(), now()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS t(id, name, icon, ord)
       ON CONFLICT DO NOTHING`,
      [
        FACTORY_CATEGORIES.map((c) => c.id),
        FACTORY_CATEGORIES.map((c) => c.es),
        FACTORY_CATEGORIES.map((c) => c.icon),
        FACTORY_CATEGORIES.map((c) => c.order),
      ],
    );

    // The id is generated here because `grocery_categories` has literal ids and
    // `item_category_hints` does not: its default is a Prisma-side cuid, which
    // only exists inside the client this file cannot use. A uuid is as good a
    // primary key and nothing reads meaning into it.
    //
    // The EXISTS is not decoration. ON CONFLICT DO NOTHING above skips a
    // category whose *name* an installation gave to a category of its own, so
    // the factory id can legitimately be missing after the insert; a hint
    // pointing at it would then violate the foreign key and take the whole seed
    // down. Skipping those words is the right answer: the category they file
    // things under is not there.
    const hints = await client.query(
      `INSERT INTO item_category_hints (id, normalized_name, category_id, origin, updated_at)
       SELECT gen_random_uuid()::text, t.name, t.category_id, 'SEED', now()
         FROM unnest($1::text[], $2::text[]) AS t(name, category_id)
        WHERE EXISTS (SELECT 1 FROM grocery_categories c WHERE c.id = t.category_id)
       ON CONFLICT DO NOTHING`,
      [FACTORY_HINTS.map((h) => h.normalizedName), FACTORY_HINTS.map((h) => h.categoryId)],
    );

    await client.query(
      `UPDATE instance_setup SET seeded_at = now() WHERE id = 'singleton' AND seeded_at IS NULL`,
    );
    await client.query("COMMIT");
    return {
      status: "seeded",
      categories: categories.rowCount ?? 0,
      hints: hints.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // Without this the process never exits and the boot command hangs before
    // `next start`.
    await client.end();
  }
}

// Run only when invoked directly, so importing this module from a test does
// nothing. `pnpm db:seed` reads .env.local, the way prisma.config.ts and the
// test runner do; inside the container that file is absent and DATABASE_URL
// comes from the environment.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cargaEnvLocal();
  const result = await runSeed();
  if (result.status === "seeded") {
    console.info(
      `[seed] seeded ${result.categories} categories and ${result.hints} dictionary entries.`,
    );
  } else if (result.status === "already-seeded") {
    console.info("[seed] this installation was already seeded: nothing touched.");
  } else {
    // Loud, and not a lie about having found the work done. The boot is not
    // stopped over it: this state only comes from a manual DELETE, and an
    // established installation that did it is still perfectly usable, while
    // refusing to start would take its shopping list down.
    console.error(
      "[seed] instance_setup has no 'singleton' row: nothing was seeded, because there " +
        "would be nowhere to record the mark and the seed would run again on every boot. " +
        "Restore the row (INSERT INTO instance_setup (id) VALUES ('singleton')) and run it " +
        "again.",
    );
  }
}
