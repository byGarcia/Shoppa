"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { richTags } from "@/components/rich";
import { fetchJson } from "@/lib/fetcher";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { useSecureContext, useWebAuthnSupport } from "@/hooks/use-passkey-support";
import { usePasskeyRegistration } from "@/hooks/use-passkey-registration";
import { usePasskeyLogin } from "@/hooks/use-passkey-login";
import { usePasswordLogin } from "@/hooks/use-password-login";

interface Props {
  /** AUTH_MODE allows passkeys. The only thing the server decides. */
  passkeysAllowedByMode: boolean;
  /** APP_ORIGIN is https. Only ever used to explain, never to decide. */
  appOriginIsHttps: boolean;
  passwordEnabled: boolean;
}


/**
 * The first screen of a freshly installed instance: the token the container
 * wrote to its log, and the account that takes the house.
 */
export function SetupForm({ passkeysAllowedByMode, appOriginIsHttps, passwordEnabled }: Props) {
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const registration = usePasskeyRegistration();
  const passkeyLogin = usePasskeyLogin();
  const passwordLogin = usePasswordLogin();

  // What decides whether a passkey can be created is the browser, not
  // APP_ORIGIN: http://localhost is a secure context and passkeys work there.
  // Same test the settings card uses, so the two screens never say different
  // things about the same installation.
  //
  // Read after hydration, not during render: the server cannot know whether
  // this browser is in a secure context, and deciding it in the render body
  // made the whole passkey block swap out a beat after it was painted.
  const secureContext = useSecureContext();
  const hasWebAuthn = useWebAuthnSupport();
  const supportsPasskey = secureContext && hasWebAuthn;
  const passkeyEnabled = passkeysAllowedByMode && supportsPasskey;
  const busy = sending || registration.pending || passkeyLogin.pending || passwordLogin.pending;

  async function createWithPasskey() {
    if (!token || !email || busy) return;
    setError(null);
    const done = await registration.register({
      email,
      setupToken: token,
      deviceName: t("deviceName"),
    });
    if (!done) return;
    // The account exists with its passkey now; signing in is the ordinary login
    // ceremony, the same one it will use tomorrow.
    await passkeyLogin.login(email, "/");
  }

  async function createWithPassword() {
    if (!token || !email || !password || busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== repeated) {
      setError(t("passwordMismatch"));
      return;
    }
    setError(null);
    setSending(true);
    try {
      await fetchJson("/api/setup", {
        method: "POST",
        body: JSON.stringify({ token, email, password }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
      return;
    } finally {
      setSending(false);
    }
    await passwordLogin.login(email, password, "/");
  }

  const message = error ?? registration.error ?? passkeyLogin.error ?? passwordLogin.error;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-between px-[30px] pb-8 safe-top safe-bottom">
      <div className="flex flex-col items-center justify-center gap-1.5 pt-12 text-center">
        <div
          className="mb-5 flex h-[76px] w-[76px] items-center justify-center rounded-[24px] bg-brand text-[38px]"
          style={{ boxShadow: "var(--e2), 0 0 0 6px var(--brand-tint)" }}
        >
          🧺
        </div>
        <div className="font-display text-[32px] font-semibold leading-none tracking-tight text-ink">
          {t("title")}
        </div>
        <p className="mt-2 max-w-[280px] text-[15px] font-medium leading-relaxed text-ink-2">
          {t("intro")}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (passwordEnabled) void createWithPassword();
        }}
        className="flex flex-col gap-3 py-8"
      >
        <label htmlFor="setup-token" className="ml-1 text-xs font-semibold text-muted">
          {t("tokenLabel")}
        </label>
        <input
          id="setup-token"
          type="text"
          autoComplete="off"
          spellCheck={false}
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("tokenPlaceholder")}
          className="rounded-[15px] border border-line bg-surface px-4 py-4 font-mono text-[14px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:font-sans placeholder:text-muted"
        />
        <p className="ml-1 -mt-1 text-xs font-medium text-muted">
          {t.rich("tokenHint", richTags)}
        </p>

        <label htmlFor="setup-email" className="ml-1 mt-2 text-xs font-semibold text-muted">
          {tCommon("emailLabel")}
        </label>
        <input
          id="setup-email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={tCommon("emailPlaceholder")}
          className="rounded-[15px] border border-line bg-surface px-4 py-4 text-[15px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:text-muted"
        />

        {message && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {message}
          </p>
        )}

        {passkeyEnabled && (
          <>
            <button
              type="button"
              onClick={() => void createWithPasskey()}
              disabled={!token || !email || !supportsPasskey || busy}
              className="tap-press mt-2 flex items-center justify-center gap-2.5 rounded-[15px] bg-brand py-4 text-[15px] font-bold text-on-brand disabled:opacity-50"
              style={{ boxShadow: "0 8px 20px -8px var(--brand)" }}
            >
              {registration.pending ? t("passkeyPending") : t("passkeyButton")}
            </button>
            <p className="text-center text-xs font-medium text-muted">{t("passkeyHint")}</p>
          </>
        )}

        {passkeysAllowedByMode && !supportsPasskey && (
          <p className="rounded-[15px] border border-line bg-chip px-4 py-3 text-xs font-medium leading-relaxed text-ink-2">
            {t.rich("passkeyUnavailable", { ...richTags, http: String(!appOriginIsHttps) })}
          </p>
        )}

        {passwordEnabled && (
          <>
            <label htmlFor="setup-password" className="ml-1 mt-2 text-xs font-semibold text-muted">
              {passkeyEnabled ? t("passwordLabelWithPasskey") : t("passwordLabel")}
            </label>
            <input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder", { min: MIN_PASSWORD_LENGTH })}
              className="rounded-[15px] border border-line bg-surface px-4 py-4 text-[15px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:text-muted"
            />
            <input
              id="setup-password-2"
              type="password"
              autoComplete="new-password"
              aria-label={t("passwordRepeat")}
              value={repeated}
              onChange={(e) => setRepeated(e.target.value)}
              placeholder={t("passwordRepeat")}
              className="rounded-[15px] border border-line bg-surface px-4 py-4 text-[15px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!token || !email || !password || !repeated || busy}
              className="tap-press flex items-center justify-center gap-2.5 rounded-[15px] border border-line bg-surface py-4 text-[15px] font-bold text-ink shadow-[var(--e1)] disabled:opacity-50"
            >
              {sending ? t("passwordPending") : t("passwordButton")}
            </button>
          </>
        )}

        {!passwordEnabled && !passkeyEnabled && (
          <p className="rounded-[15px] border border-line bg-chip px-4 py-3 text-xs font-medium leading-relaxed text-ink-2">
            {t.rich("noWayIn", richTags)}
          </p>
        )}
      </form>
    </main>
  );
}
