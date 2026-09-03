"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { fetchJson } from "@/lib/fetcher";
import { safeRedirect } from "@/lib/safe-redirect";
import { useTranslations } from "next-intl";

export function usePasskeyLogin() {
  const t = useTranslations("toast");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(email: string, redirectTo: string): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const options = await fetchJson<unknown>("/api/auth/webauthn/options", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const assertion = await startAuthentication({
        optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      });
      const res = await signIn("credentials", {
        email,
        webauthnAssertion: JSON.stringify(assertion),
        redirect: false,
      });
      if (!res || res.error) {
        setError(t("passkeyVerifyFailed"));
        return false;
      }
      window.location.assign(safeRedirect(redirectTo));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unknownError"));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { login, pending, error };
}
