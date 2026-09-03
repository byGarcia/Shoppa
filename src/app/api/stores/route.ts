import { withAuth, withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { storeCreateSchema } from "@/lib/validations";

// Household-shared data: session-gated but NOT user-scoped. One instance is
// one household, so the shops are the same for everybody who can sign in.
export const GET = withAuth(async () => {
  const stores = await prisma.groceryStore.findMany({ orderBy: { order: "asc" } });
  return ApiResponse.success({ stores });
});

export const POST = withAuthRequest(async (request) => {
  const validation = await validateRequest(request, storeCreateSchema);
  if (!validation.success) return validation.response;

  const max = await prisma.groceryStore.aggregate({ _max: { order: true } });
  const store = await prisma.groceryStore.create({
    data: {
      name: validation.data.name,
      color: validation.data.color ?? null,
      icon: validation.data.icon ?? null,
      order: (max._max.order ?? 0) + 1,
    },
  });
  return ApiResponse.created({ store });
});
