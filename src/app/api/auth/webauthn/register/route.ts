import type { NextRequest } from "next/server";

import { ApiResponse, getOptionalAuthSession, handleApiError } from "@/lib/api-utils";
import {
  makeRegisterOptionsHandler,
  makeRegisterPresenceHandler,
  makeRegisterVerifyHandler,
} from "@/server/webauthn";
import { reauthMethodFor } from "@/server/webauthn/handlers/reauthenticate";
import { apiText } from "@/lib/api-messages";

const deps = { ApiResponse, handleApiError, getOptionalAuthSession };

const options = makeRegisterOptionsHandler(deps);
const verify = makeRegisterVerifyHandler(deps);
const presence = makeRegisterPresenceHandler(deps);

/**
 * The passkey registration ceremony, on one path.
 *
 * `?step=` is an explicit switch rather than separate routes so that
 * src/proxy.ts can rate-limit the whole ceremony as one prefix: an attacker
 * cannot pick the cheaper half to hammer.
 *
 *  - `presence` — challenge for the re-authentication of a passkey-only account
 *  - `options`  — the registration challenge, issued only against proof
 *  - `verify`   — the attestation, and the only step that writes
 */
export async function POST(request: NextRequest) {
  const step = request.nextUrl.searchParams.get("step");
  if (step === "options") return options(request);
  if (step === "verify") return verify(request);
  if (step === "presence") return presence();
  return ApiResponse.badRequest(await apiText("webauthn.missingStep"));
}

/**
 * Which proof this account can give, so the interface knows whether to ask for
 * a password or to run a presence ceremony. Says nothing an account holder does
 * not already know about their own account.
 */
export async function GET() {
  try {
    const session = await getOptionalAuthSession();
    if (!session) return ApiResponse.unauthorized();
    return ApiResponse.success({ reauth: await reauthMethodFor(session.user.id) });
  } catch (error) {
    return handleApiError(error, "GET /api/auth/webauthn/register");
  }
}
