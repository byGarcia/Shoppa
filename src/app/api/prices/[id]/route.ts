import {
  withAuthRequestParams,
  withAuthParams,
  ApiResponse,
  validateRequest,
  getRouteId,
} from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { priceUpdateSchema } from "@/lib/validations";
import { toProductDTO } from "@/lib/price-server";
import { apiText } from "@/lib/api-messages";

export const PATCH = withAuthRequestParams(async (request, _session, params) => {
  const id = await getRouteId(params);
  const validation = await validateRequest(request, priceUpdateSchema);
  if (!validation.success) return validation.response;
  const data = validation.data;

  const current = await prisma.trackedProduct.findUnique({ where: { id } });
  if (!current) return ApiResponse.notFound(await apiText("entity.product"));

  // "Use the current price as the new reference": the escape hatch for having
  // added a product at a price peak, which would otherwise never alert again.
  // Clearing alertActive matters — leaving it true would mute the next real drop.
  const rebase =
    data.rebase === true && current.currentPrice !== null
      ? { basePrice: current.currentPrice, alertActive: false }
      : {};

  const product = await prisma.trackedProduct.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...rebase,
    },
  });

  return ApiResponse.success({ product: toProductDTO(product) });
});

export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  const current = await prisma.trackedProduct.findUnique({ where: { id }, select: { id: true } });
  if (!current) return ApiResponse.notFound(await apiText("entity.product"));

  // PriceCheck rows cascade with the product (FK ON DELETE CASCADE).
  await prisma.trackedProduct.delete({ where: { id } });
  return ApiResponse.success({ deleted: true });
});
