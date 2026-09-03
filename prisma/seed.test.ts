import { beforeEach, describe, expect, it } from "vitest";

import { findGroceryHint, normalizeGroceryText } from "../src/lib/grocery-match.ts";
import { prisma } from "../src/server/db.ts";
import { FACTORY_CATEGORIES, FACTORY_HINTS, FACTORY_HINTS_EN, FACTORY_HINTS_ES } from "./seed-data.ts";
import { runSeed } from "./seed.ts";

beforeEach(async () => {
  await prisma.itemCategoryHint.deleteMany();
  await prisma.groceryCategory.deleteMany();
  await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { seededAt: null } });
});

describe("seed", () => {
  it("creates the twelve categories with their factory ids", async () => {
    await runSeed();
    const ids = (await prisma.groceryCategory.findMany({ select: { id: true } })).map((c) => c.id);
    expect(ids).toHaveLength(12);
    expect(ids.every((id) => id.startsWith("gcat-"))).toBe(true);
  });

  it("creates no store: that belongs to each household", async () => {
    await runSeed();
    expect(await prisma.groceryStore.count()).toBe(0);
  });

  it("is idempotent", async () => {
    await runSeed();
    await runSeed();
    expect(await prisma.groceryCategory.count()).toBe(12);
  });

  it("does not resurrect a deleted category: the guard is already set", async () => {
    await runSeed();
    await prisma.groceryCategory.delete({ where: { id: "gcat-mascotas" } });
    await runSeed();
    expect(await prisma.groceryCategory.findUnique({ where: { id: "gcat-mascotas" } })).toBeNull();
  });

  it("does not overwrite a rename nor hand back its translation key", async () => {
    await runSeed();
    await prisma.groceryCategory.update({
      where: { id: "gcat-hogar" }, data: { name: "Trastos", nameKey: null },
    });
    await runSeed();
    const row = await prisma.groceryCategory.findUnique({ where: { id: "gcat-hogar" } });
    expect(row?.name).toBe("Trastos");
    expect(row?.nameKey).toBeNull();
  });

  it("marks the guard, which is the only thing that stops it", async () => {
    await runSeed();
    const setup = await prisma.instanceSetup.findUnique({ where: { id: "singleton" } });
    expect(setup?.seededAt).not.toBeNull();
  });

  it("tells apart 'already seeded' from 'no row to write it down in'", async () => {
    const guardRow = await prisma.instanceSetup.findUniqueOrThrow({ where: { id: "singleton" } });
    try {
      await prisma.instanceSetup.delete({ where: { id: "singleton" } });
      const result = await runSeed();
      expect(result.status).toBe("no-guard-row");
      expect(await prisma.groceryCategory.count()).toBe(0);
    } finally {
      await prisma.instanceSetup.create({ data: guardRow });
    }
    expect((await runSeed()).status).toBe("seeded");
    expect((await runSeed()).status).toBe("already-seeded");
  });

  it("seeds the whole dictionary, with a translation key per category", async () => {
    await runSeed();
    expect(await prisma.itemCategoryHint.count()).toBe(FACTORY_HINTS.length);
    const categories = await prisma.groceryCategory.findMany({ select: { id: true, nameKey: true } });
    expect(categories.every((c) => c.nameKey === c.id)).toBe(true);
    const esMilk = await prisma.itemCategoryHint.findUnique({ where: { normalizedName: "leche" } });
    const enMilk = await prisma.itemCategoryHint.findUnique({ where: { normalizedName: "milk" } });
    expect(esMilk?.categoryId).toBe("gcat-lacteos");
    expect(enMilk?.categoryId).toBe("gcat-lacteos");
  });

  // Everything above this line is protected by the guard, so it never exercises
  // the insert path twice. Clearing the marker is the only way to see what the
  // ON CONFLICT clauses actually do, and it is also the documented consequence
  // of clearing it: a category deleted before the second run comes back.
  describe("with the guard cleared by hand", () => {
    beforeEach(async () => {
      await runSeed();
      await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { seededAt: null } });
    });

    it("duplicates neither categories nor dictionary entries", async () => {
      await runSeed();
      expect(await prisma.groceryCategory.count()).toBe(12);
      expect(await prisma.itemCategoryHint.count()).toBe(FACTORY_HINTS.length);
    });

    it("respects the name, the icon and the order the household has changed", async () => {
      await prisma.groceryCategory.update({
        where: { id: "gcat-hogar" },
        data: { name: "Trastos", nameKey: null, icon: "🧰", order: 99 },
      });
      await runSeed();
      const row = await prisma.groceryCategory.findUnique({ where: { id: "gcat-hogar" } });
      expect(row).toMatchObject({ name: "Trastos", nameKey: null, icon: "🧰", order: 99 });
    });

    it("respects what the household has learned about a word", async () => {
      await prisma.itemCategoryHint.update({
        where: { normalizedName: "leche" },
        data: { categoryId: "gcat-bebidas", origin: "LEARNED" },
      });
      await runSeed();
      const row = await prisma.itemCategoryHint.findUnique({ where: { normalizedName: "leche" } });
      expect(row?.categoryId).toBe("gcat-bebidas");
      expect(row?.origin).toBe("LEARNED");
    });

    // Deleting a factory category and giving its name to one of your own is
    // the case where the insert genuinely cannot land: the name is unique, so
    // ON CONFLICT skips the row and the factory id stays missing. The words
    // that filed things under it have to stay out too, or the foreign key
    // takes the whole seed — and with it the boot — down.
    it("does not fall over when the household took the name of a factory category", async () => {
      await prisma.groceryCategory.delete({ where: { id: "gcat-mascotas" } });
      await prisma.groceryCategory.create({ data: { name: "Mascotas", icon: "🐶", order: 30 } });
      const survivors = await prisma.itemCategoryHint.count();
      await runSeed();
      expect(await prisma.groceryCategory.findUnique({ where: { id: "gcat-mascotas" } })).toBeNull();
      expect(await prisma.itemCategoryHint.count()).toBe(survivors);
    });
  });
});

describe("factory dictionary", () => {
  it("always points at a category that exists", () => {
    const ids = new Set(FACTORY_CATEGORIES.map((c) => c.id));
    for (const hint of FACTORY_HINTS) expect(ids.has(hint.categoryId)).toBe(true);
  });

  it("has no repeated entries within the same language", () => {
    for (const list of [FACTORY_HINTS_ES, FACTORY_HINTS_EN]) {
      expect(new Set(list.map((h) => h.normalizedName)).size).toBe(list.length);
    }
  });

  it("does not send the same word to two different categories in the two languages", () => {
    const es = new Map(FACTORY_HINTS_ES.map((h) => [h.normalizedName, h.categoryId]));
    for (const hint of FACTORY_HINTS_EN) {
      const spanish = es.get(hint.normalizedName);
      if (spanish !== undefined) expect(spanish).toBe(hint.categoryId);
    }
  });

  // Which entry answers, never just which category: an entry the matcher cannot
  // reach is invisible to a test that compares categories, because another
  // entry filed under the same category answers in its place. That is how
  // "barra de pan" — which normalizes to "pan" and is answered by the "pan"
  // hint — looked reachable for a whole review round.
  const rows = FACTORY_HINTS.map((h) => ({ ...h, storeHintId: null }));
  const answerFor = (typed: string) =>
    findGroceryHint(normalizeGroceryText(typed), rows)?.normalizedName ?? null;

  it("every entry answers its own word, except the one another entry covers", () => {
    const shadowed = FACTORY_HINTS.filter((h) => answerFor(h.normalizedName) !== h.normalizedName).map(
      (h) => `${h.normalizedName} -> ${answerFor(h.normalizedName)}`,
    );
    // Exactly one, and it is deliberate: "barra de pan" comes from the curated
    // export and stays byte-for-byte as the household had it. It costs nothing
    // — "pan" answers with the same category — but it is dead weight, and this
    // list is what stops the next one from arriving unnoticed.
    expect(shadowed).toEqual(["barra de pan -> pan"]);
  });

  // Re-normalizing the stored key is not a test of anything: it is the form the
  // dictionary is already written in, so plurals never enter it. These are the
  // forms people type. The eight at the top were all NO MATCH until the plural
  // was added as its own entry: the singulariser is Spanish, it turns "-ies"
  // into "-ie", and the fuzzy pass will not bridge that or a short plural.
  it.each([
    ["strawberries", "strawberries"],
    ["cherries", "cherries"],
    ["blueberries", "blueberries"],
    ["raspberries", "raspberries"],
    ["anchovies", "anchovies"],
    ["pastries", "pastries"],
    ["buns", "buns"],
    ["pens", "pens"],
    ["storage boxes", "storage boxes"],
    ["eggs", "eggs"],
    ["egg", "egg"],
    ["6 eggs", "eggs"],
    ["apples", "apple"],
    ["bananas", "banana"],
    ["tomatoes", "tomato"],
    ["potatoes", "potato"],
    ["onions", "onion"],
    ["scallions", "scallion"],
    ["cookies", "cookie"],
    ["chicken breasts", "chicken breast"],
    ["toilet rolls", "toilet roll"],
    ["paper towels", "paper towels"],
    ["trash bags", "trash bags"],
    ["dish soap", "dish soap"],
    ["tin foil", "tin foil"],
    ["diapers", "diapers"],
    ["nappies", "nappies"],
    ["yoghurt", "yoghurt"],
    ["yogurt", "yogurt"],
    ["coriander", "coriander"],
    ["cilantro", "cilantro"],
    ["tinned tuna", "tuna"],
    ["frozen peas", "frozen pea"],
    ["fresas", "fresa"],
    ["huevos", "huevo"],
    ["yogures", "yogur"],
    ["panales", "panal"],
    ["2 kg de tomates", "tomate"],
    ["dos barras de pan", "pan"],
    ["paquete de arroz", "arroz"],
    ["una lata de atun", "atun"],
    ["leche entera", "leche"],
    ["papel higienico", "papel higienico"],
  ])("typing '%s' is answered by the '%s' entry", (typed, entry) => {
    expect(answerFor(typed)).toBe(entry);
  });
});
