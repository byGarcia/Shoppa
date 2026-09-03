import { withAuth, withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { priceCreateSchema } from "@/lib/validations";
import { createTrackedProduct, toProductDTO } from "@/lib/price-server";

// Household-shared like the rest of Shoppa: session-gated, not user-scoped.
export const GET = withAuth(async () => {
  const products = await prisma.trackedProduct.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return ApiResponse.success({ products: products.map(toProductDTO) });
});

export const POST = withAuthRequest(async (request) => {
  const validation = await validateRequest(request, priceCreateSchema);
  if (!validation.success) return validation.response;

  const result = await createTrackedProduct(validation.data);
  if (!result.ok) return ApiResponse.badRequest(result.reason);

  const body = { product: toProductDTO(result.product), reused: result.reused };
  return result.reused ? ApiResponse.success(body) : ApiResponse.created(body);
});
