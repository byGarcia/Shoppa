import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiResponse, handleApiError } from "@/lib/api-utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { authMode } from "@/lib/env";
import { claimInstance } from "@/server/setup";
import { apiText } from "@/lib/api-messages";

const bodySchema = z.object({
  token: z.string().min(1),
  // `.trim()` before `.email()`: zod rejects surrounding whitespace outright,
  // so without it a pasted address with a trailing space is a 400 here while
  // claimInstance would have trimmed it happily — the schema contradicting the
  // primitive it guards.
  email: z.string().trim().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH, "setup.passwordTooShort"),
});

/**
 * Claim this instance with an email and a password.
 *
 * The passkey route to the same claim is
 * `POST /api/auth/webauthn/register?step=options|verify`; both end in
 * claimInstance, which is where the token is checked and the race is decided.
 */
export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());

    // With AUTH_MODE=passkey the password branch of the sign-in refuses
    // everything, so an account created here would be one nobody could ever
    // open. Refused at the door instead of created and abandoned.
    if (authMode() === "passkey") {
      return ApiResponse.badRequest(await apiText("setup.passkeyOnly"));
    }

    const result = await claimInstance(body);
    if (!result.ok) {
      // A wrong token and an already-claimed instance are told apart on
      // purpose: whoever is looking at this screen is holding the container
      // logs, and "you typed the token wrong" versus "somebody already
      // finished the install" are different actions. Neither reveals anything
      // an unauthenticated caller could not learn from /login itself.
      if (result.reason === "bad-token") {
        return ApiResponse.error(await apiText("setup.badToken"), 403);
      }
      if (result.reason === "already-claimed") {
        return ApiResponse.conflict(await apiText("setup.alreadyClaimed"));
      }
      return ApiResponse.badRequest(await apiText("setup.missingFields"));
    }

    return ApiResponse.success({ ok: true });
  } catch (error) {
    return handleApiError(error, "POST /api/setup");
  }
}
