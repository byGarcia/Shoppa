"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { safeRedirect } from "@/lib/safe-redirect";
import { useTranslations } from "next-intl";

/**
 * Sign-in with a password. The branch that makes the app usable on a LAN
 * address, where the browser refuses to create a passkey.
 *
 * Every failure reads the same on screen: the server already refuses to say
 * whether the address exists, whether it has a password or whether the account
 * is being throttled, and repeating a distinction here would undo that.
 */
export function usePasswordLogin() {
  const t = useTranslations("toast");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(email: string, password: string, redirectTo: string): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) {
        setError(t("badCredentials"));
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
