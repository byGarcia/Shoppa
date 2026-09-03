import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiResponse, handleApiError } from "@/lib/api-utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { authMode } from "@/lib/env";
import { invitationRefusalMessage, redeemInvitation } from "@/server/invitations";
import { apiText } from "@/lib/api-messages";

const bodySchema = z.object({
  token: z.string().min(1),
  // `.trim()` before `.email()`: zod rejects surrounding whitespace outright,
  // so without it a pasted address with a trailing space is a 400 here while
  // redeemInvitation would have trimmed it happily — the schema contradicting
  // the primitive it guards.
  email: z.string().trim().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH, "setup.passwordTooShort"),
});

/**
 * Redeem an invitation with an email and a password.
 *
 * Public by necessity — the invited person has no session, that is the whole
 * point — and therefore in `STRICT_RATE_LIMIT_ROUTES`, alongside `/api/setup`:
 * both take a secret a human types.
 *
 * The passkey route to the same redemption is
 * `POST /api/auth/webauthn/register?step=options|verify`, which ends in the
 * same `redeemInvitation`. That is where the invitation is spent and where a
 * race between two people holding the same link is decided; nothing here
 * decides anything, exactly as `/api/setup` decides nothing about the claim.
 *
 * The 12-character minimum lives in this schema rather than in the primitive,
 * the same way `/api/setup` holds it: a policy the interface must be able to
 * state before the request is sent, not an invariant of storing a hash.
 */
export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());

    // With AUTH_MODE=passkey the password branch of the sign-in refuses
    // everything, so an account created here would be one nobody could ever
    // open. Refused at the door instead of created and abandoned — the same
    // guard /api/setup applies to the first account. The mirror image,
    // AUTH_MODE=password, is refused by resolveRegistrationGrant before the
    // passkey ceremony gets anywhere near an invitation.
    if (authMode() === "passkey") {
      return ApiResponse.badRequest(await apiText("setup.passkeyOnly"));
    }

    const result = await redeemInvitation(body);
    if (!result.ok) {
      // 409 for an address that is already taken — the one refusal the person
      // can act on by changing what they typed. The rest are facts about the
      // link itself and no amount of retrying this form changes them.
      const status = result.reason === "email-taken" ? 409 : 400;
      return ApiResponse.error(await invitationRefusalMessage(result.reason), status);
    }

    return ApiResponse.success({ ok: true });
  } catch (error) {
    return handleApiError(error, "POST /api/invitations/redeem");
  }
}
