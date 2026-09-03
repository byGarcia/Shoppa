// Pure text-matching engine for the grocery dictionary. No prisma, no IO —
// keep it importable from anywhere (server routes today, maybe client later).

export type GroceryHintRow = {
  normalizedName: string;
  categoryId: string | null;
  storeHintId: string | null;
};

const QUANTITY_WORDS =
  "un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|medio|media";
const UNIT_WORDS =
  "litros?|l|kilos?|kg|kilogramos?|gramos?|g|paquetes?|cajas?|latas?|botellas?|botes?|bolsas?|docenas?|unidades?|barras?|bricks?|packs?|tarros?|sobres?";

/**
 * Normalize free text (typed or dictated) to the dictionary key form:
 * lowercase, no accents, no punctuation, no leading quantity/unit/article,
 * naive singular. "2 litros de Leche entera" → "leche entera".
 * The seeded dictionary stores keys already in this form (Task 2).
 */
export function normalizeGroceryText(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip combining accents (accents + n-tilde -> plain)
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  // "2 litros de …", "dos latas de …", "1.5 l …"
  s = s.replace(
    new RegExp(`^(?:\\d+(?:[.,]\\d+)?|${QUANTITY_WORDS})\\s+(?:(?:${UNIT_WORDS})\\s+)?(?:de\\s+)?`),
    "",
  );
  // "paquete de arroz" (unit without a number)
  s = s.replace(new RegExp(`^(?:${UNIT_WORDS})\\s+(?:de\\s+)?`), "");
  // "la leche", "los tomates"
  s = s.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/, "");
  s = s.split(" ").map(singularizeWord).join(" ").trim();
  return s;
}

// Naive Spanish singular: "lapices"→"lapiz", "tomates"→"tomate", "latas"→"lata".
// Consonant plurals ("yogures"→"yogure") intentionally stay imperfect — the
// fuzzy token matcher below absorbs the ≤2-char tail difference.
function singularizeWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ces")) return word.slice(0, -3) + "z";
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // Prefix tolerance for plural/dictation tails ("yogure" vs "yogur",
  // "lavavajilla" vs "lavavajillas"). Short tokens must match exactly so
  // "col" can never swallow "colacao".
  if (shorter.length < 4) return false;
  return longer.startsWith(shorter) && longer.length - shorter.length <= 2;
}

/**
 * Which hint answers an already-normalized item name.
 * 1. Exact normalizedName hit (learned rows shadow seeds — same table).
 * 2. Fuzzy: hint matches when EVERY hint token matches some item token;
 *    the longest matching hint wins ("queso rallado" beats "queso").
 *
 * Exported alongside `matchGrocery` because *which* row answered is not
 * recoverable from the category it returns, and that is exactly what
 * prisma/seed.test.ts has to assert: a dead dictionary entry is invisible to a
 * test that only compares categories, since a different entry filed under the
 * same category answers in its place.
 */
export function findGroceryHint(
  normalized: string,
  hints: GroceryHintRow[],
): GroceryHintRow | null {
  const exact = hints.find((h) => h.normalizedName === normalized);
  if (exact) return exact;

  const itemTokens = normalized.split(" ").filter(Boolean);
  let best: GroceryHintRow | null = null;
  for (const hint of hints) {
    const hintTokens = hint.normalizedName.split(" ");
    const allMatch = hintTokens.every((ht) =>
      itemTokens.some((it) => tokenMatches(it, ht)),
    );
    if (allMatch && (!best || hint.normalizedName.length > best.normalizedName.length)) {
      best = hint;
    }
  }
  return best;
}

/** The category and store a normalized item name falls into, or nulls. */
export function matchGrocery(
  normalized: string,
  hints: GroceryHintRow[],
): { categoryId: string | null; storeHintId: string | null } {
  const hit = findGroceryHint(normalized, hints);
  if (hit) return { categoryId: hit.categoryId, storeHintId: hit.storeHintId };
  return { categoryId: null, storeHintId: null };
}
