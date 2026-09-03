import { withAuth, withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { categoryCreateSchema } from "@/lib/validations";

export const GET = withAuth(async () => {
  const categories = await prisma.groceryCategory.findMany({ orderBy: { order: "asc" } });
  return ApiResponse.success({ categories });
});

export const POST = withAuthRequest(async (request) => {
  const validation = await validateRequest(request, categoryCreateSchema);
  if (!validation.success) return validation.response;

  const max = await prisma.groceryCategory.aggregate({ _max: { order: true } });
  const category = await prisma.groceryCategory.create({
    data: {
      name: validation.data.name,
      icon: validation.data.icon ?? null,
      order: (max._max.order ?? 0) + 1,
    },
  });
  return ApiResponse.created({ category });
});
