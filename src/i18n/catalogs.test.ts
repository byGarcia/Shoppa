import { describe, expect, it } from "vitest";

import { FACTORY_CATEGORIES } from "../../prisma/seed-data.ts";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/**
 * Los catálogos se comprueban aquí porque la alternativa es comprobarlos a ojo,
 * y una clave que falta en inglés no se ve: next-intl devuelve la clave en
 * crudo en la pantalla de alguien, no un error en el build.
 */
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/**
 * Los nombres de los huecos: `{nombre}` y el argumento de `{count, plural, …}`.
 *
 * Exige la coma o la llave de cierre detrás del nombre para no confundirse con
 * el cuerpo de una rama de `select`, que también empieza por `{` seguido de una
 * palabra: en `{http, select, true { porque la instancia…}}` el hueco es `http`
 * y `porque` es texto.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
}

const ES = flatten(es as Tree);
const EN = flatten(en as Tree);

describe("catálogos de mensajes", () => {
  it("tienen exactamente las mismas claves", () => {
    expect([...EN.keys()].sort()).toEqual([...ES.keys()].sort());
  });

  it("no dejan ningún mensaje vacío", () => {
    for (const [key, value] of [...ES, ...EN]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("usan los mismos huecos en los dos idiomas", () => {
    // Un hueco que sólo existe en un idioma es texto roto en el otro: o sale
    // el literal "{name}" en pantalla, o se pierde el dato.
    for (const [key, spanish] of ES) {
      expect(placeholders(EN.get(key) ?? ""), key).toEqual(placeholders(spanish));
    }
  });
});

describe("prefijo de los avisos de Telegram", () => {
  /**
   * El prefijo es una etiqueta de origen, no una traducción: los avisos caen en
   * un chat compartido con otras cosas y hay que distinguirlos de un vistazo.
   * Por eso las tres pruebas de "mismas claves / mismos huecos" de arriba lo
   * dejaban pasar: el valor castellano era un valor inglés perfectamente
   * válido para ellas, y a un desconocido le llegaba «🔻 compra — <b>Café</b>»
   * en una instalación en inglés.
   */
  const PREFIXED = ["api.prices.telegramTest", "api.notify.unreadable", "api.notify.drop"];

  it("cada idioma lleva el suyo", () => {
    for (const key of PREFIXED) {
      expect(ES.get(key), key).toContain("compra —");
      expect(EN.get(key), key).toContain("Shoppa —");
    }
  });

  it("ningún mensaje inglés arrastra el prefijo castellano", () => {
    // Incluye la pantalla de Ajustes que explica cuál es el prefijo: si se
    // cambia el aviso y no la explicación, el documento miente sobre el
    // producto.
    for (const [key, value] of EN) {
      expect(value, key).not.toContain("compra —");
    }
  });
});

describe("categorías de fábrica", () => {
  it("tienen una entrada de catálogo por cada id sembrado", () => {
    // El name_key de una categoría ES su id (prisma/seed-data.ts), así que una
    // categoría sembrada sin entrada aquí se renderiza como "gcat-loquesea".
    for (const category of FACTORY_CATEGORIES) {
      expect(ES.has(`categories.${category.id}`), category.id).toBe(true);
      expect(EN.has(`categories.${category.id}`), category.id).toBe(true);
    }
  });

  it("no traen ninguna entrada de más", () => {
    const seeded = new Set(FACTORY_CATEGORIES.map((c) => c.id));
    for (const key of ES.keys()) {
      if (!key.startsWith("categories.")) continue;
      expect(seeded.has(key.slice("categories.".length)), key).toBe(true);
    }
  });

  it("dicen lo mismo que la semilla, palabra por palabra", () => {
    // La semilla y el catálogo son dos copias del mismo nombre y hoy coinciden.
    // Si se separan, una instalación recién sembrada muestra un nombre y la
    // misma categoría traducida muestra otro, sin que falle nada.
    for (const category of FACTORY_CATEGORIES) {
      expect(ES.get(`categories.${category.id}`), category.id).toBe(category.es);
      expect(EN.get(`categories.${category.id}`), category.id).toBe(category.en);
    }
  });
});
