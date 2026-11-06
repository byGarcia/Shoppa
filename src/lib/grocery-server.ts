import { prisma } from "@/server/db";
import type { GroceryItem } from "@/server/db";
import { normalizeGroceryText, matchGrocery, type GroceryHintRow } from "./grocery-match";

/** Load all hints (a few hundred rows — in-memory matching is fine). */
async function loadHints(): Promise<GroceryHintRow[]> {
  return prisma.itemCategoryHint.findMany({
    select: { normalizedName: true, categoryId: true, storeHintId: true },
  });
}

/** Normalize + categorize a raw text against learned + seeded hints. */
export async function categorizeText(
  raw: string,
): Promise<{ normalizedName: string; categoryId: string | null; storeHintId: string | null }> {
  const normalizedName = normalizeGroceryText(raw);
  const hints = await loadHints();
  const { categoryId, storeHintId } = matchGrocery(normalizedName, hints);
  return { normalizedName, categoryId, storeHintId };
}

/**
 * Persist a correction/assignment so it wins next time.
 * Upsert on normalizedName; origin flips to LEARNED even for seed rows.
 */
export async function learnHint(
  normalizedName: string,
  patch: { categoryId?: string; storeHintId?: string },
): Promise<void> {
  if (!normalizedName || (!patch.categoryId && !patch.storeHintId)) return;
  await prisma.itemCategoryHint.upsert({
    where: { normalizedName },
    update: { ...patch, origin: "LEARNED" },
    create: {
      normalizedName,
      categoryId: patch.categoryId ?? null,
      storeHintId: patch.storeHintId ?? null,
      origin: "LEARNED",
    },
  });
}

/**
 * Destination: the shop the caller named. With none (the inbox, and every voice
 * add), the shop this exact product was last moved to — a household that has
 * filed "milk" under one shop does not want to file it again every week.
 * Exact only: the looser word match is right often enough to suggest a shop in
 * the inbox and wrong often enough ("milk" answering for "oat milk") that it
 * must not file anything by itself. Everything else lands in the inbox.
 *
 * Dedup/idempotency rule, applied to BOTH manual and voice adds:
 * same normalizedName + same destination (storeId; inbox = null) →
 *   - unchecked row exists: reuse it, do not duplicate
 *   - checked row exists: uncheck it (bring it back)
 *   - else: create, auto-categorized.
 */
export async function addOrReviveItem(input: {
  name: string;
  storeId: string | null;
  source: "APP" | "SIRI";
  addedByUserId: string | null;
}): Promise<{ item: GroceryItem; reused: boolean }> {
  const name = input.name.trim();
  const normalizedName = normalizeGroceryText(name);
  const hints = await loadHints();
  const { categoryId } = matchGrocery(normalizedName, hints);
  const learnedStoreId =
    hints.find((h) => h.normalizedName === normalizedName)?.storeHintId ?? null;
  const storeId = input.storeId ?? learnedStoreId;

  const existing = await prisma.groceryItem.findFirst({
    where: { normalizedName, storeId },
    orderBy: { createdAt: "desc" },
  });

  if (existing && !existing.checked) {
    return { item: existing, reused: true };
  }
  if (existing && existing.checked) {
    const item = await prisma.groceryItem.update({
      where: { id: existing.id },
      data: { checked: false, checkedAt: null, source: input.source },
    });
    return { item, reused: true };
  }

  const item = await prisma.groceryItem.create({
    data: {
      name,
      normalizedName,
      storeId,
      categoryId,
      source: input.source,
      addedByUserId: input.addedByUserId,
    },
  });
  return { item, reused: false };
}
