/**
 * A category shows its translation only while it still carries a name_key.
 * Renaming clears the key, so the household's choice wins from then on —
 * otherwise switching language would silently overwrite what they typed.
 */
export function categoryDisplayName(
  category: { nameKey: string | null; name: string },
  t: (key: string) => string,
): string {
  return category.nameKey ? t(category.nameKey) : category.name;
}
