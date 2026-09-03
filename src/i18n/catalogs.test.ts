import { describe, expect, it } from "vitest";

import { FACTORY_CATEGORIES } from "../../prisma/seed-data.ts";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/**
 * The catalogs are checked here because the alternative is checking them by
 * eye, and a key missing in English is invisible: next-intl returns the raw key
 * on somebody's screen, not a build error.
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
 * The placeholder names: `{name}` and the argument of `{count, plural, …}`.
 *
 * Requires the comma or the closing brace after the name so it is not confused
 * with the body of a `select` branch, which also starts with `{` followed by a
 * word: in `{http, select, true { porque la instancia…}}` the placeholder is
 * `http` and `porque` is text.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
}

const ES = flatten(es as Tree);
const EN = flatten(en as Tree);

describe("message catalogs", () => {
  it("have exactly the same keys", () => {
    expect([...EN.keys()].sort()).toEqual([...ES.keys()].sort());
  });

  it("leave no message empty", () => {
    for (const [key, value] of [...ES, ...EN]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in both languages", () => {
    // A placeholder that exists in only one language is broken text in the
    // other: either the literal "{name}" shows up on screen, or the data is
    // lost.
    for (const [key, spanish] of ES) {
      expect(placeholders(EN.get(key) ?? ""), key).toEqual(placeholders(spanish));
    }
  });
});

describe("prefix of the Telegram notifications", () => {
  /**
   * The prefix is a label saying where the message comes from, not a
   * translation: the notifications land in a chat shared with other things and
   * have to be told apart at a glance. That is why the three "same keys / same
   * placeholders" tests above let it through: the Spanish value was a perfectly
   * valid English value as far as they were concerned, and a stranger running
   * an English installation got "🔻 compra — <b>Café</b>".
   */
  const PREFIXED = ["api.prices.telegramTest", "api.notify.unreadable", "api.notify.drop"];

  it("each language carries its own", () => {
    for (const key of PREFIXED) {
      expect(ES.get(key), key).toContain("compra —");
      expect(EN.get(key), key).toContain("Shoppa —");
    }
  });

  it("no English message drags the Spanish prefix along", () => {
    // This includes the Settings screen that explains what the prefix is: if
    // the notification is changed and the explanation is not, the document lies
    // about the product.
    for (const [key, value] of EN) {
      expect(value, key).not.toContain("compra —");
    }
  });
});

describe("factory categories", () => {
  it("have a catalog entry for every seeded id", () => {
    // A category's name_key IS its id (prisma/seed-data.ts), so a seeded
    // category with no entry here renders as "gcat-whatever".
    for (const category of FACTORY_CATEGORIES) {
      expect(ES.has(`categories.${category.id}`), category.id).toBe(true);
      expect(EN.has(`categories.${category.id}`), category.id).toBe(true);
    }
  });

  it("bring no entry too many", () => {
    const seeded = new Set(FACTORY_CATEGORIES.map((c) => c.id));
    for (const key of ES.keys()) {
      if (!key.startsWith("categories.")) continue;
      expect(seeded.has(key.slice("categories.".length)), key).toBe(true);
    }
  });

  it("say the same as the seed, word for word", () => {
    // The seed and the catalog are two copies of the same name and today they
    // agree. If they drift apart, a freshly seeded installation shows one name
    // and the same category translated shows another, with nothing failing.
    for (const category of FACTORY_CATEGORIES) {
      expect(ES.get(`categories.${category.id}`), category.id).toBe(category.es);
      expect(EN.get(`categories.${category.id}`), category.id).toBe(category.en);
    }
  });
});
