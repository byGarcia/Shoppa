"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWebAuthnSupport } from "@/hooks/use-passkey-support";
import { usePasskeyLogin } from "@/hooks/use-passkey-login";
import { usePasswordLogin } from "@/hooks/use-password-login";
import type { AuthMode } from "@/lib/env";
import { loginLayout } from "@/lib/login-layout";

/**
 * The sign-in screen.
 *
 * What it offers is decided by `loginLayout` from AUTH_MODE alone, and the
 * ordering is the point: in `auto` the passkey is the action and the password
 * sits behind a control that reveals it. Every account that came from the
 * previous application has a passkey and no password, and used to be shown a
 * field that could never work for it, given the same weight as the button that
 * could. The field is still there — the server must not reveal which of the two
 * an address has, and a screen that adapted to the account would answer exactly
 * that — but it is no longer the first thing offered.
 */
export function LoginForm({ mode }: { mode: AuthMode }) {
  const t = useTranslations("login");
  const tCommon = useTranslations("common");
  const tApp = useTranslations("app");
  const search = useSearchParams();
  const from = search.get("from") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passkey = usePasskeyLogin();
  const passwordLogin = usePasswordLogin();

  const layout = loginLayout(mode);
  // Opened by the visitor, never by anything known about an account. It starts
  // closed on every load, so two people typing two different addresses into
  // this instance see the same screen.
  const [revealed, setRevealed] = useState(false);
  const passwordShown =
    layout.passwordSlot === "primary" || (layout.passwordSlot === "behind-reveal" && revealed);

  // Read after hydration, not during render: the server cannot know whether
  // this browser has WebAuthn, and deciding it in the render body made the
  // whole passkey block swap out a beat after the page appeared.
  const supportsWebAuthn = useWebAuthnSupport();
  const pending = passkey.pending || passwordLogin.pending;

  function signInWithPasskey() {
    if (!layout.passkey || !email || !supportsWebAuthn || pending) return;
    passkey.login(email, from);
  }

  function signInWithPassword() {
    if (!email || !password || pending) return;
    passwordLogin.login(email, password, from);
  }

  // What is typed decides: with a password, the password; without one, the
  // passkey, which is what Enter did before this field existed. The guard in
  // signInWithPasskey is what makes that safe in `password` mode, where there
  // is no passkey to fall through to and Enter on an empty password must do
  // nothing rather than start a ceremony the server would refuse.
  function submit() {
    if (passwordShown && password) {
      signInWithPassword();
      return;
    }
    signInWithPasskey();
  }

  // The browser's implicit submission is no good here: it presses the form's
  // first submit button and, if that button is disabled — the password one is
  // while its field is empty — it does nothing at all. Enter is resolved by
  // hand on both fields so that what was typed decides, not the DOM order.
  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // Enter while an IME has a candidate open confirms the word; it submits
    // nothing. Without this guard, typing the address in Japanese or Chinese
    // sends the form mid-word.
    if (e.nativeEvent.isComposing) return;
    // With no valid address, let Enter through: the browser's implicit
    // submission fires the native `required` validation and shows the field's
    // bubble. Cutting it off here with preventDefault turned that Enter into a
    // gesture that did nothing at all and did not say why.
    if (!email || !e.currentTarget.validity.valid) return;
    e.preventDefault();
    submit();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-between px-[30px] pb-8 safe-top safe-bottom">
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <div
          className="mb-5 flex h-[76px] w-[76px] items-center justify-center rounded-[24px] bg-brand text-[38px]"
          style={{ boxShadow: "var(--e2), 0 0 0 6px var(--brand-tint)" }}
        >
          🧺
        </div>
        <div className="font-display text-[40px] font-semibold leading-none tracking-tight text-ink">
          {tApp("name")}
        </div>
        <p className="mt-1 max-w-[230px] text-[15px] font-medium leading-relaxed text-ink-2">
          {t("tagline")}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 pb-2"
      >
        <label htmlFor="login-email" className="ml-1 text-xs font-semibold text-muted">
          {tCommon("emailLabel")}
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email webauthn"
          enterKeyHint="go"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onEnter}
          placeholder={tCommon("emailPlaceholder")}
          className="rounded-[15px] border border-line bg-surface px-4 py-4 text-[15px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:text-muted"
        />

        {passkey.error && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {passkey.error}
          </p>
        )}

        {layout.passkey && (
          <>
            <button
              type="button"
              onClick={signInWithPasskey}
              disabled={!email || !supportsWebAuthn || pending}
              className="tap-press flex items-center justify-center gap-2.5 rounded-[15px] bg-brand py-4 text-[15px] font-bold text-on-brand disabled:opacity-50"
              style={{ boxShadow: "0 8px 20px -8px var(--brand)" }}
            >
              {passkey.pending ? t("passkeyPending") : t("passkeyButton")}
            </button>

            <p className="text-center text-xs font-medium text-muted">
              {supportsWebAuthn ? t("passkeyHint") : t("noPasskeySupport")}
            </p>
          </>
        )}

        {/* The reveal. Discreet on purpose: it is the second way in, and it is
            the only one some accounts have. It says nothing about any account —
            it is on the screen before an address is typed and stays there
            whatever is typed. */}
        {layout.passwordSlot === "behind-reveal" && !revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="tap-press mx-auto mt-1 rounded-full px-4 py-2 text-xs font-bold text-muted"
          >
            {t("passwordReveal")}
          </button>
        )}

        {passwordShown && (
          <>
            <label htmlFor="login-password" className="ml-1 mt-2 text-xs font-semibold text-muted">
              {t("passwordLabel")}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              enterKeyHint="go"
              // Only where the field arrived because somebody asked for it. In
              // `password` mode it is on the screen from the start and stealing
              // focus from the address would be taking the caret off the field
              // that is filled first.
              autoFocus={layout.passwordSlot === "behind-reveal"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter}
              placeholder={t("passwordPlaceholder")}
              className="rounded-[15px] border border-line bg-surface px-4 py-4 text-[15px] font-medium text-ink shadow-[var(--e1)] outline-none placeholder:text-muted"
            />

            {passwordLogin.error && (
              <p role="alert" aria-live="assertive" className="text-sm text-danger">
                {passwordLogin.error}
              </p>
            )}

            {/* Primary where it is the only way in, quiet where it is the
                second one: two buttons of equal weight is the screen this
                change exists to undo. */}
            <button
              type="submit"
              disabled={!email || !password || pending}
              className={
                layout.passwordSlot === "primary"
                  ? "tap-press flex items-center justify-center gap-2.5 rounded-[15px] bg-brand py-4 text-[15px] font-bold text-on-brand disabled:opacity-50"
                  : "tap-press flex items-center justify-center gap-2.5 rounded-[15px] border border-line bg-surface py-4 text-[15px] font-bold text-ink shadow-[var(--e1)] disabled:opacity-50"
              }
              style={
                layout.passwordSlot === "primary"
                  ? { boxShadow: "0 8px 20px -8px var(--brand)" }
                  : undefined
              }
            >
              {passwordLogin.pending ? t("passwordPending") : t("passwordButton")}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
