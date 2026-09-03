import { withAuth, withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { itemCreateSchema } from "@/lib/validations";
import { addOrReviveItem } from "@/lib/grocery-server";
import { matchGrocery } from "@/lib/grocery-match";

// Auto-purge horizon: checked items older than this are deleted
// lazily on list load — the app has no cron; the list is read often.
const PURGE_CHECKED_AFTER_DAYS = 14;

// Household-shared list: session-gated, NOT user-scoped. One instance is one
// household, so everybody who can sign in reads and writes the same rows.
export const GET = withAuth(async () => {
  await prisma.groceryItem.deleteMany({
    where: {
      checked: true,
      checkedAt: { lt: new Date(Date.now() - PURGE_CHECKED_AFTER_DAYS * 24 * 60 * 60 * 1000) },
    },
  });
  const [items, hints] = await Promise.all([
    prisma.groceryItem.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.itemCategoryHint.findMany({
      select: { normalizedName: true, categoryId: true, storeHintId: true },
    }),
  ]);
  const payload = items.map((item) => ({
    ...item,
    // Habitual-store suggestion only matters in the inbox assignment UI.
    suggestedStoreId:
      item.storeId === null ? matchGrocery(item.normalizedName, hints).storeHintId : null,
  }));
  return ApiResponse.success({ items: payload });
});

export const POST = withAuthRequest(async (request, session) => {
  const validation = await validateRequest(request, itemCreateSchema);
  if (!validation.success) return validation.response;

  const { item, reused } = await addOrReviveItem({
    name: validation.data.name,
    storeId: validation.data.storeId ?? null,
    source: "APP",
    addedByUserId: session.user.id,
  });
  const body = { item: { ...item, suggestedStoreId: null }, reused };
  return reused ? ApiResponse.success(body) : ApiResponse.created(body);
});
