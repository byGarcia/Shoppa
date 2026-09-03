import { ApiResponse, withAuth } from "@/lib/api-utils";
import { appOrigin } from "@/lib/env";
import { createInvitation, listInvitations } from "@/server/invitations";

/**
 * The invitations of this instance. Session-guarded, and deliberately not
 * scoped to the caller: see listInvitations for why the household, and not the
 * person who pressed the button, is the right owner of that list.
 *
 * No token, no hash. There is nothing a browser can do with either.
 */
export const GET = withAuth(async () => {
  return ApiResponse.success({ invitations: await listInvitations() });
});

/**
 * Create an invitation link. Session-guarded and nothing else: anybody already
 * in this household may add somebody to it, which is the same authority they
 * already have over every list in the app.
 *
 * The link is built from APP_ORIGIN rather than from the request's headers.
 * `Host` and `X-Forwarded-Host` are values the caller chooses, and a link built
 * from them is a link that can be made to point somewhere else — at which
 * point a member copies it, sends it to a relative, and the invitation token
 * is typed into somebody else's server.
 *
 * The plaintext is in this response and nowhere else, ever again.
 */
export const POST = withAuth(async (session) => {
  const { token, expiresAt } = await createInvitation(session.user.id);
  const url = new URL(`/invite/${token}`, appOrigin()).toString();
  return ApiResponse.created({ token, url, expiresAt });
});
