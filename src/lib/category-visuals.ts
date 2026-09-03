// Visual-only mapping: a category → its accent color, tinted chip background,
// and a fallback emoji. Category color is NOT stored in the DB (CategoryDTO has
// no color field), so it lives here to keep chips and dots consistent. The emoji
// comes from the category's own `icon` when present, else a neutral fallback.
//
// chipBg uses color-mix so the same token reads correctly on the light cream and
// the dark surface without any per-theme JavaScript.

const PALETTE = [
  "#3fa372",
  "#5b8fd6",
  "#cc5b6b",
  "#c98a3b",
  "#4fb6c4",
  "#8b6fd6",
  "#d08a5a",
  "#46b39a",
  "#d67ba8",
  "#7a8699",
  "#a9794e",
  "#9a8f7e",
];

// The 12 factory categories (fixed ids, migration 20260722150000_grocery_compra).
const SEED_COLORS: Record<string, string> = {
  "gcat-frutas-verduras": "#3fa372",
  "gcat-carne-pescado": "#cc5b6b",
  "gcat-lacteos": "#5b8fd6",
  "gcat-panaderia": "#c98a3b",
  "gcat-congelados": "#4fb6c4",
  "gcat-bebidas": "#8b6fd6",
  "gcat-despensa": "#d08a5a",
  "gcat-limpieza": "#46b39a",
  "gcat-higiene": "#d67ba8",
  "gcat-hogar": "#7a8699",
  "gcat-mascotas": "#a9794e",
  "gcat-otros": "#9a8f7e",
};

function hashIndex(key: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

/** Accent color for a category (seeded map → DB id/name hash fallback). */
export function categoryColor(
  category?: { id: string; name: string } | null,
): string {
  if (!category) return "#9a8f7e";
  return SEED_COLORS[category.id] ?? PALETTE[hashIndex(category.id || category.name, PALETTE.length)];
}

export type CategoryVisual = { emoji: string; color: string; chipBg: string };

export function categoryVisual(
  category?: { id: string; name: string; icon: string | null } | null,
): CategoryVisual {
  const color = categoryColor(category);
  return {
    emoji: category?.icon || "📦",
    color,
    chipBg: `color-mix(in srgb, ${color} 18%, transparent)`,
  };
}

/** Accent color for a store (its own `color` → id/name hash fallback). */
export function storeColor(
  store?: { id: string; name: string; color: string | null } | null,
): string {
  if (store?.color) return store.color;
  if (!store) return "#3fa372";
  return PALETTE[hashIndex(store.id || store.name, PALETTE.length)];
}
