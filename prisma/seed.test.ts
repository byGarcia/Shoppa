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

describe("semilla", () => {
  it("crea las doce categorías con sus ids de fábrica", async () => {
    await runSeed();
    const ids = (await prisma.groceryCategory.findMany({ select: { id: true } })).map((c) => c.id);
    expect(ids).toHaveLength(12);
    expect(ids.every((id) => id.startsWith("gcat-"))).toBe(true);
  });

  it("no crea ninguna tienda: eso es de cada casa", async () => {
    await runSeed();
    expect(await prisma.groceryStore.count()).toBe(0);
  });

  it("es idempotente", async () => {
    await runSeed();
    await runSeed();
    expect(await prisma.groceryCategory.count()).toBe(12);
  });

  it("no resucita una categoría borrada: el guard ya está puesto", async () => {
    await runSeed();
    await prisma.groceryCategory.delete({ where: { id: "gcat-mascotas" } });
    await runSeed();
    expect(await prisma.groceryCategory.findUnique({ where: { id: "gcat-mascotas" } })).toBeNull();
  });

  it("no pisa un renombrado ni le devuelve la clave de traducción", async () => {
    await runSeed();
    await prisma.groceryCategory.update({
      where: { id: "gcat-hogar" }, data: { name: "Trastos", nameKey: null },
    });
    await runSeed();
    const row = await prisma.groceryCategory.findUnique({ where: { id: "gcat-hogar" } });
    expect(row?.name).toBe("Trastos");
    expect(row?.nameKey).toBeNull();
  });

  it("marca el guard, que es lo único que la detiene", async () => {
    await runSeed();
    const setup = await prisma.instanceSetup.findUnique({ where: { id: "singleton" } });
    expect(setup?.seededAt).not.toBeNull();
  });

  it("distingue «ya sembrada» de «sin fila donde anotarlo»", async () => {
    const fila = await prisma.instanceSetup.findUniqueOrThrow({ where: { id: "singleton" } });
    try {
      await prisma.instanceSetup.delete({ where: { id: "singleton" } });
      const resultado = await runSeed();
      expect(resultado.status).toBe("no-guard-row");
      expect(await prisma.groceryCategory.count()).toBe(0);
    } finally {
      await prisma.instanceSetup.create({ data: fila });
    }
    expect((await runSeed()).status).toBe("seeded");
    expect((await runSeed()).status).toBe("already-seeded");
  });

  it("siembra el diccionario entero, con su clave de traducción por categoría", async () => {
    await runSeed();
    expect(await prisma.itemCategoryHint.count()).toBe(FACTORY_HINTS.length);
    const categories = await prisma.groceryCategory.findMany({ select: { id: true, nameKey: true } });
    expect(categories.every((c) => c.nameKey === c.id)).toBe(true);
    const leche = await prisma.itemCategoryHint.findUnique({ where: { normalizedName: "leche" } });
    const milk = await prisma.itemCategoryHint.findUnique({ where: { normalizedName: "milk" } });
    expect(leche?.categoryId).toBe("gcat-lacteos");
    expect(milk?.categoryId).toBe("gcat-lacteos");
  });

  // Everything above this line is protected by the guard, so it never exercises
  // the insert path twice. Clearing the marker is the only way to see what the
  // ON CONFLICT clauses actually do, and it is also the documented consequence
  // of clearing it: a category deleted before the second run comes back.
  describe("con el guard borrado a mano", () => {
    beforeEach(async () => {
      await runSeed();
      await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { seededAt: null } });
    });

    it("no duplica ni categorías ni entradas del diccionario", async () => {
      await runSeed();
      expect(await prisma.groceryCategory.count()).toBe(12);
      expect(await prisma.itemCategoryHint.count()).toBe(FACTORY_HINTS.length);
    });

    it("respeta el nombre, el icono y el orden que la casa haya cambiado", async () => {
      await prisma.groceryCategory.update({
        where: { id: "gcat-hogar" },
        data: { name: "Trastos", nameKey: null, icon: "🧰", order: 99 },
      });
      await runSeed();
      const row = await prisma.groceryCategory.findUnique({ where: { id: "gcat-hogar" } });
      expect(row).toMatchObject({ name: "Trastos", nameKey: null, icon: "🧰", order: 99 });
    });

    it("respeta lo que la casa haya aprendido sobre una palabra", async () => {
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
    it("no cae cuando la casa se quedó con el nombre de una categoría de fábrica", async () => {
      await prisma.groceryCategory.delete({ where: { id: "gcat-mascotas" } });
      await prisma.groceryCategory.create({ data: { name: "Mascotas", icon: "🐶", order: 30 } });
      const supervivientes = await prisma.itemCategoryHint.count();
      await runSeed();
      expect(await prisma.groceryCategory.findUnique({ where: { id: "gcat-mascotas" } })).toBeNull();
      expect(await prisma.itemCategoryHint.count()).toBe(supervivientes);
    });
  });
});

describe("diccionario de fábrica", () => {
  it("apunta siempre a una categoría que existe", () => {
    const ids = new Set(FACTORY_CATEGORIES.map((c) => c.id));
    for (const hint of FACTORY_HINTS) expect(ids.has(hint.categoryId)).toBe(true);
  });

  it("no tiene entradas repetidas dentro de un mismo idioma", () => {
    for (const list of [FACTORY_HINTS_ES, FACTORY_HINTS_EN]) {
      expect(new Set(list.map((h) => h.normalizedName)).size).toBe(list.length);
    }
  });

  it("no manda la misma palabra a dos categorías distintas en cada idioma", () => {
    const es = new Map(FACTORY_HINTS_ES.map((h) => [h.normalizedName, h.categoryId]));
    for (const hint of FACTORY_HINTS_EN) {
      const enEspanol = es.get(hint.normalizedName);
      if (enEspanol !== undefined) expect(enEspanol).toBe(hint.categoryId);
    }
  });

  // Which entry answers, never just which category: an entry the matcher cannot
  // reach is invisible to a test that compares categories, because another
  // entry filed under the same category answers in its place. That is how
  // "barra de pan" — which normalizes to "pan" and is answered by the "pan"
  // hint — looked reachable for a whole review round.
  const rows = FACTORY_HINTS.map((h) => ({ ...h, storeHintId: null }));
  const contesta = (escrito: string) =>
    findGroceryHint(normalizeGroceryText(escrito), rows)?.normalizedName ?? null;

  it("cada entrada contesta a su propia palabra, salvo la que otra tapa", () => {
    const tapadas = FACTORY_HINTS.filter((h) => contesta(h.normalizedName) !== h.normalizedName).map(
      (h) => `${h.normalizedName} -> ${contesta(h.normalizedName)}`,
    );
    // Exactly one, and it is deliberate: "barra de pan" comes from the curated
    // export and stays byte-for-byte as the household had it. It costs nothing
    // — "pan" answers with the same category — but it is dead weight, and this
    // list is what stops the next one from arriving unnoticed.
    expect(tapadas).toEqual(["barra de pan -> pan"]);
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
  ])("escribir «%s» lo contesta la entrada «%s»", (escrito, entrada) => {
    expect(contesta(escrito)).toBe(entrada);
  });
});
