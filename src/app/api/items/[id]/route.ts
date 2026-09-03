import { withAuthRequestParams, withAuthParams, ApiResponse, validateRequest, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { itemUpdateSchema } from "@/lib/validations";
import { learnHint } from "@/lib/grocery-server";
import { normalizeGroceryText } from "@/lib/grocery-match";
import { apiText } from "@/lib/api-messages";

export const PATCH = withAuthRequestParams(async (request, _session, params) => {
  const id = await getRouteId(params);
  const validation = await validateRequest(request, itemUpdateSchema);
  if (!validation.success) return validation.response;
  const data = validation.data;

  const current = await prisma.groceryItem.findUnique({ where: { id } });
  if (!current) return ApiResponse.notFound(await apiText("entity.item"));

  const item = await prisma.groceryItem.update({
    where: { id },
    data: {
      ...(data.name !== undefined
        ? { name: data.name, normalizedName: normalizeGroceryText(data.name) }
        : {}),
      ...(data.checked !== undefined
        ? { checked: data.checked, checkedAt: data.checked ? new Date() : null }
        : {}),
      ...(data.storeId !== undefined ? { storeId: data.storeId } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
      ...(data.unit !== undefined ? { unit: data.unit } : {}),
    },
  });

  // Learning: a manual category correction or a store assignment
  // is remembered for the next time this product is added.
  if (data.categoryId != null) {
    await learnHint(item.normalizedName, { categoryId: data.categoryId });
  }
  if (data.storeId != null) {
    await learnHint(item.normalizedName, { storeHintId: data.storeId });
  }

  return ApiResponse.success({ item: { ...item, suggestedStoreId: null } });
});

export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  await prisma.groceryItem.delete({ where: { id } });
  return ApiResponse.deleted();
});
