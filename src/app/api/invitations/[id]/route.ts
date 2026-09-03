import { ApiResponse, getRouteId, withAuthParams } from "@/lib/api-utils";
import { revokeInvitation } from "@/server/invitations";
import { apiText } from "@/lib/api-messages";

/**
 * Take a pending invitation back.
 *
 * Any member may revoke any invitation, for the same reason any member can see
 * them all: the link opens this household's list, not the sender's. The case
 * this exists for is a lost phone whose owner cannot log in, and an ownership
 * check would make exactly that case unfixable from the interface.
 *
 * A link that was already used, already revoked or never existed all answer
 * 404. Nothing distinguishes them to the person pressing the button — the link
 * is dead either way — and the alternative is an endpoint that reports whether
 * an id it refused to act on exists.
 */
export const DELETE = withAuthParams(async (_session, params) => {
  const id = await getRouteId(params);
  const revoked = await revokeInvitation(id);
  if (!revoked) return ApiResponse.notFound(await apiText("entity.invitation"));
  return ApiResponse.deleted();
});
