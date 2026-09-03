import { withAuth, ApiResponse } from "@/lib/api-utils";
import { prisma } from "@/server/db";

export const GET = withAuth(async () => {
  const hints = await prisma.itemCategoryHint.findMany({
    orderBy: { normalizedName: "asc" },
  });
  return ApiResponse.success({ hints });
});
