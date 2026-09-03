import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FACTORY_CATEGORIES } from "./seed-data.ts";

const PRISMA_DIR = import.meta.dirname;
const MIGRATIONS = join(PRISMA_DIR, "migrations");
const PUBLIC_RELEASE = readdirSync(MIGRATIONS).find((d) => d.endsWith("_public_release"));
const MIGRATION_SQL = readFileSync(join(MIGRATIONS, PUBLIC_RELEASE!, "migration.sql"), "utf8");

/**
 * The reading of a production installation, kept in the repository so these
 * tests are anchored to what was actually there rather than to each other:
 * seed-data and the migration can be edited together and stay consistent while
 * both drift away from the installation they have to match.
 */
interface RecordedCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
}

function readRecordedCategories(): RecordedCategory[] {
  const doc = readFileSync(join(PRISMA_DIR, "factory-categories.md"), "utf8");
  return doc
    .split("\n")
    .filter((line) => line.startsWith("| gcat-"))
    .map((line) => {
      const [id, name, icon, order] = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      return { id, name, icon, order: Number(order) };
    });
}

const RECORDED = readRecordedCategories();

describe("datos de fábrica", () => {
  it("son doce", () => {
    expect(FACTORY_CATEGORIES).toHaveLength(12);
  });

  it("todos los ids llevan el prefijo del que cuelgan los colores", () => {
    for (const category of FACTORY_CATEGORIES) {
      expect(category.id.startsWith("gcat-")).toBe(true);
    }
  });

  it("no hay ids ni órdenes repetidos", () => {
    expect(new Set(FACTORY_CATEGORIES.map((c) => c.id)).size).toBe(12);
    expect(new Set(FACTORY_CATEGORIES.map((c) => c.order)).size).toBe(12);
  });

  it("tienen nombre en los dos idiomas", () => {
    for (const category of FACTORY_CATEGORIES) {
      expect(category.es.trim()).not.toBe("");
      expect(category.en.trim()).not.toBe("");
    }
  });

  it("reproducen, carácter a carácter, lo leído de la instalación de origen", () => {
    expect(RECORDED).toHaveLength(12);
    expect(FACTORY_CATEGORIES.map((c) => ({ id: c.id, name: c.es, icon: c.icon, order: c.order }))).toEqual(
      RECORDED,
    );
  });
});

// The whole point of the name_key back-fill is a character-for-character match
// against the names an existing installation already holds. Drift breaks
// nothing visible: the category quietly keeps a null key and stops being
// translatable, with nothing failing to say so.
describe("relleno de name_key de la migración", () => {
  it("existe la migración public_release", () => {
    expect(PUBLIC_RELEASE).toBeDefined();
  });

  it("reclama cada categoría por su id y por el nombre leído de la instalación", () => {
    for (const recorded of RECORDED) {
      expect(MIGRATION_SQL).toContain(`WHERE id = '${recorded.id}' AND name = '${recorded.name}';`);
    }
  });

  it("son doce sentencias vivas, no texto dentro de un comentario", () => {
    const claims = MIGRATION_SQL.match(/^UPDATE "grocery_categories" SET name_key = id$/gm);
    expect(claims).toHaveLength(12);
  });
});

// The Dockerfile's boot command gates `next start` on `prisma migrate deploy`
// (and, since the seed exists, on the seed too), and Prisma 7.9.1
// does not wrap a migration in a transaction. Losing these two lines turns a
// failed statement into a half-migrated database that also refuses to boot.
describe("la migración es atómica", () => {
  it("se abre en BEGIN y se cierra en COMMIT", () => {
    expect(MIGRATION_SQL.split("\n").find((l) => l.trim() && !l.startsWith("--"))).toBe("BEGIN;");
    expect(MIGRATION_SQL.trimEnd().endsWith("\nCOMMIT;")).toBe(true);
  });
});
