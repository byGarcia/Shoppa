import { withAuthRequestParams, withAuthParams, ApiResponse, validateRequest, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { hintUpdateSchema } from "@/lib/validations";

export const PUT = withAuthRequestParams(async (request, _session, params) => {
  const id = await getRouteId(params);
  const validation = await validateRequest(request, hintUpdateSchema);
  if (!validation.success) return validation.response;

  // Any manual correction becomes LEARNED — even on a factory row.
  const hint = await prisma.itemCategoryHint.update({
    where: { id },
    data: { ...validation.data, origin: "LEARNED" },
  });
  return ApiResponse.success({ hint });
});

export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  await prisma.itemCategoryHint.delete({ where: { id } });
  return ApiResponse.deleted();
});
