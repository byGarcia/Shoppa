"use client";

import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

import { fetchJson } from "@/lib/fetcher";
import { useTranslations } from "next-intl";

export interface PasskeyRegistrationInput {
  /** Only for the first run: the account does not exist yet. */
  email?: string;
  /** Only for the first run. Absent from settings, where the session authorises. */
  setupToken?: string;
  /** Only when arriving by invitation link. Same shape as the setup token. */
  invitationToken?: string;
  /** Settings, for an account that has a password: its current password. */
  currentPassword?: string;
  /** What the list of passkeys will call this device. */
  deviceName?: string;
}

/** What the server will accept as proof before it registers anything. */
export type ReauthMethod = "password" | "presence";

/**
 * The passkey registration ceremony.
 *
 * Mirrors use-passkey-login: ask for options, hand them to the authenticator,
 * send the attestation back. Two things differ. Who is allowed to ask — from
 * settings nothing is sent but the ceremony itself and the session authorises
 * it; on the first run the installation token travels with BOTH requests, and
 * on an invitation link the invitation token does the same, because the server
 * checks the authority at both ends. And, from settings, the account
 * has to prove itself again first: registering a passkey deletes the password
 * and nothing in this release can put it back.
 */
export function usePasskeyRegistration() {
  const t = useTranslations("toast");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Which proof this account can give, straight from the server. */
  async function reauthMethod(): Promise<ReauthMethod | null> {
    const state = await fetchJson<{ reauth: ReauthMethod | null }>(
      "/api/auth/webauthn/register",
    );
    return state.reauth;
  }

  async function register(input: PasskeyRegistrationInput = {}): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const authority = {
        email: input.email,
        setupToken: input.setupToken,
        invitationToken: input.invitationToken,
      };

      // A passkey-only account proves itself with the authenticator it already
      // has. The presence challenge is separate from the registration one and
      // is spent before it: they cannot share a cookie, and they must not share
      // a scope either.
      //
      // Only from settings, though. An account that does not exist yet — first
      // run or invitation — has nothing to prove itself with, and asking would
      // send a sessionless request to an endpoint that answers 401.
      let presenceAssertion: string | undefined;
      const accountExists = !input.setupToken && !input.invitationToken;
      if (accountExists && !input.currentPassword) {
        const presenceOptions = await fetchJson<unknown>(
          "/api/auth/webauthn/register?step=presence",
          { method: "POST" },
        );
        const assertion = await startAuthentication({
          optionsJSON: presenceOptions as Parameters<
            typeof startAuthentication
          >[0]["optionsJSON"],
        });
        presenceAssertion = JSON.stringify(assertion);
      }

      const proof = { currentPassword: input.currentPassword, presenceAssertion };
      const options = await fetchJson<unknown>("/api/auth/webauthn/register?step=options", {
        method: "POST",
        body: JSON.stringify({ ...authority, ...proof }),
      });
      const attestation = await startRegistration({
        optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });
      await fetchJson<unknown>("/api/auth/webauthn/register?step=verify", {
        method: "POST",
        body: JSON.stringify({
          ...authority,
          deviceName: input.deviceName,
          attestation: JSON.stringify(attestation),
        }),
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { register, reauthMethod, pending, error };
}
