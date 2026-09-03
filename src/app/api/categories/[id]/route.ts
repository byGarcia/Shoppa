import { withAuthRequestParams, withAuthParams, ApiResponse, validateRequest, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { categoryUpdateSchema } from "@/lib/validations";

export const PUT = withAuthRequestParams(async (request, _session, params) => {
  const id = await getRouteId(params);
  const validation = await validateRequest(request, categoryUpdateSchema);
  if (!validation.success) return validation.response;

  // A rename is the household saying what this section is called, so the claim
  // to translate it goes in the same update. Without this, switching language
  // would silently overwrite the name they just typed.
  const data = validation.data.name === undefined ? validation.data : { ...validation.data, nameKey: null };

  const category = await prisma.groceryCategory.update({
    where: { id },
    data,
  });
  return ApiResponse.success({ category });
});

export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  // onDelete: Cascade drops the category's hints (seeds included, no
  // recovery, and that is accepted); items fall back to the uncategorized
  // section.
  await prisma.groceryCategory.delete({ where: { id } });
  return ApiResponse.deleted();
});
