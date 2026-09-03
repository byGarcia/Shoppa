import type { NextResponse } from "next/server";
import { z } from "zod";

import { apiText } from "@/lib/api-messages";
import { ApiResponse, getRouteId, withAuthRequestParams } from "@/lib/api-utils";
import { recordSecurityEvent } from "@/server/security-log";
import { clientIPFromHeaders } from "@/server/webauthn";
import { clearChallengeCookieOn } from "@/server/webauthn/challenge-cookie";
import { deleteOwnCredential } from "@/server/webauthn/handlers/delete-credential";
import { reauthSchema, reauthenticate } from "@/server/webauthn/handlers/reauthenticate";
import { trustedProxy } from "@/lib/env";

const bodySchema = z.object({ ...reauthSchema });

/**
 * Retire one of this account's passkeys.
 *
 * Until now credentials could only ever be added. A phone that was lost a year
 * ago still opened the instance and no screen took it back; the only way to
 * remove one was `psql`. This is that screen's route.
 *
 * **The session is not the authority.** It is the same threat that made
 * *registration* demand proof: a 30-day JWT on a phone somebody left unlocked
 * must not be enough to strip the owner's key, which is the one move that turns
 * a borrowed session into an eviction. So the proof is demanded again, through
 * the same `reauthenticate` the registration ceremony uses — the current
 * password for an account that has one, a presence assertion for one that does
 * not. Not a second mechanism: one place decides what this account can prove,
 * and both irreversible operations ask it.
 *
 * **What it answers.**
 *
 *  - `401` — no session. The proxy answers first; `withAuthRequestParams` again.
 *  - `400` — no proof, the wrong proof, or the account's throttle window is
 *    open. The three are separate sentences so the card can say which.
 *  - `404` — the id names no credential of *this* account. A credential that
 *    does not exist and one belonging to somebody else are the same answer,
 *    reached by the same query: `deleteOwnCredential` scopes by `userId`, so
 *    the difference never exists to be leaked.
 *  - `409 LAST_CREDENTIAL` — it is the last way into the account. Its own code,
 *    not a generic 400, because it is the one refusal the card has something
 *    useful to say about.
 *  - `200 { success: true }` — gone, and a `PASSKEY_DELETED` row written.
 *
 * The id in the path is the **row** id handed out by `GET
 * /api/auth/webauthn/register`, never the WebAuthn credential id.
 */
export const DELETE = withAuthRequestParams(async (request, session, params) => {
  const id = await getRouteId(params);
  // A DELETE with no body is a DELETE with no proof, which is a 400 below and
  // not a 500 here.
  const body = bodySchema.parse(await request.json().catch(() => ({})));

  const proof = await reauthenticate(session.user.id, body);
  if (!proof.ok) {
    const message = await apiText(
      proof.reason === "no-proof"
        ? "webauthn.confirmToDelete"
        : proof.reason === "throttled"
          ? "webauthn.throttled"
          : "webauthn.badConfirmation",
    );
    return spent(await ApiResponse.badRequest(message), body);
  }

  const result = await deleteOwnCredential(session.user.id, id);
  if (!result.ok) {
    if (result.reason === "last-credential") {
      return spent(
        ApiResponse.error(await apiText("webauthn.lastCredential"), 409, "LAST_CREDENTIAL"),
        body,
      );
    }
    return spent(await ApiResponse.notFound(await apiText("entity.passkey")), body);
  }

  // Nothing else records that a key was retired. The registration writes its
  // own row for the same reason: these two are the only operations on this
  // instance that change who can get in, and neither can be undone from a
  // screen.
  await recordSecurityEvent({
    eventType: "PASSKEY_DELETED",
    userId: session.user.id,
    email: session.user.email,
    endpoint: "/api/auth/webauthn/credentials/[id]",
    ipAddress: clientIPFromHeaders(request.headers, { trustedProxy: trustedProxy() }),
    userAgent: request.headers.get("user-agent"),
    details: { deviceName: result.deviceName, remaining: result.remaining },
  });
  return spent(ApiResponse.deleted(), body);
});

/**
 * Burn the presence challenge, whatever the answer was.
 *
 * Only when one was actually spent: a request proving itself with a password
 * carries no challenge, and clearing the cookie regardless would wipe a
 * registration challenge out from under a ceremony running in another tab.
 * `verifyWebAuthnAssertion` already clears it when the assertion verifies; this
 * is the other half — a challenge that survives its own rejection is one an
 * attacker gets to try again against.
 */
function spent(response: NextResponse, body: { presenceAssertion?: string }): NextResponse {
  if (body.presenceAssertion) clearChallengeCookieOn(response);
  return response;
}
