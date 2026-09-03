import { withAuthParams, ApiResponse, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { checkProduct } from "@/lib/price-service";
import { toProductDTO } from "@/lib/price-server";
import { apiText } from "@/lib/api-messages";

/**
 * POST /api/prices/[id]/check — "comprobar ahora" from the card.
 * Runs the same code path as the cron, including the Telegram rule, so what you
 * see here is exactly what the morning run would have done — and, like it, falls
 * back to the home agent when this host is bot-walled (hence maxDuration).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 45;
export const POST = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  const product = await prisma.trackedProduct.findUnique({ where: { id } });
  if (!product) return ApiResponse.notFound(await apiText("entity.product"));

  const outcome = await checkProduct(product);
  const updated = await prisma.trackedProduct.findUnique({ where: { id } });

  return ApiResponse.success({
    outcome,
    product: updated ? toProductDTO(updated) : null,
  });
});
