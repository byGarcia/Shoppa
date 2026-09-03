import { withAuthParams, ApiResponse, getRouteId } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { apiText } from "@/lib/api-messages";

export const DELETE = withAuthParams(async (session, params) => {
  const id = await getRouteId(params);
  // Ownership check: you can only revoke YOUR tokens.
  const { count } = await prisma.voiceToken.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (count === 0) return ApiResponse.notFound(await apiText("entity.token"));
  return ApiResponse.deleted();
});
