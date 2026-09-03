import { withAuthRequestParams, withAuthParams, ApiResponse, validateRequest, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { storeUpdateSchema } from "@/lib/validations";

export const PUT = withAuthRequestParams(async (request, _session, params) => {
  const id = await getRouteId(params);
  const validation = await validateRequest(request, storeUpdateSchema);
  if (!validation.success) return validation.response;

  const store = await prisma.groceryStore.update({
    where: { id },
    data: validation.data,
  });
  return ApiResponse.success({ store });
});

export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  // onDelete: SetNull sends the store's items to the inbox.
  await prisma.groceryStore.delete({ where: { id } });
  return ApiResponse.deleted();
});
