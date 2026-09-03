"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { categoryDisplayName } from "@/lib/category-name";

/**
 * How a category is written on screen.
 *
 * The twelve a fresh installation is born with carry a `nameKey` and are read
 * from the catalog, so they follow the language. Anything the household typed —
 * a new category, or a factory one they renamed — is shown exactly as they
 * typed it. `t.has` guards the case of a key this build's catalog does not know
 * (an older installation seeded with an id we have since dropped): it falls
 * back to the stored name rather than printing the raw key.
 */
export function useCategoryName(): (category: { nameKey: string | null; name: string }) => string {
  const t = useTranslations("categories");

  return useCallback(
    (category) => categoryDisplayName(category, (key) => (t.has(key) ? t(key) : category.name)),
    [t],
  );
}
