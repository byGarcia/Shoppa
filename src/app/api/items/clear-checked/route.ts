import { withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { clearCheckedSchema } from "@/lib/validations";

// "Clear ticked": one tab ({storeId}, null = inbox) or, from the "All"
// view, every store AND the inbox at once ({all: true}). The
// union is strict and exclusive: {storeId, all} matches neither branch → 400.
export const POST = withAuthRequest(async (request) => {
  const validation = await validateRequest(request, clearCheckedSchema);
  if (!validation.success) return validation.response;

  const data = validation.data;
  const where = "all" in data ? { checked: true } : { checked: true, storeId: data.storeId };
  const { count } = await prisma.groceryItem.deleteMany({ where });
  return ApiResponse.success({ deleted: count });
});
