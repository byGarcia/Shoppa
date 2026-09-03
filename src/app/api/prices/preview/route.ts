import { withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { priceUrlSchema } from "@/lib/validations";
import { previewProduct } from "@/lib/price-server";
import { apiText } from "@/lib/api-messages";

/**
 * POST /api/prices/preview — read a pasted URL and return what we understood,
 * without writing anything. The add form shows this so the reference price is
 * confirmed by a human before it becomes the thing every alert depends on.
 *
 * Can take ~20 s when the shop bot-walls this host and the download is handed
 * to the home agent (see fetch-jobs), hence the generous maxDuration. A shop
 * neither side can read still returns 200 with `price: null` and a reason, so
 * the user can type the reference price by hand.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 45;
export const POST = withAuthRequest(async (request) => {
  const validation = await validateRequest(request, priceUrlSchema);
  if (!validation.success) return validation.response;

  const preview = await previewProduct(validation.data.url);
  if (!preview) return ApiResponse.badRequest(await apiText("prices.invalidUrl"));

  return ApiResponse.success({ preview });
});
