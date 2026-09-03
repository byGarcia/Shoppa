"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";

import { richTags } from "@/components/rich";
import { usePasskeyAccount, usePasskeyRegistration } from "@/hooks/use-passkey-registration";
import { useSecureContext, useWebAuthnSupport } from "@/hooks/use-passkey-support";
import {
  closedPasskeyCard,
  passkeyAddition,
  passkeyCopy,
  passkeyUse,
  type PasskeyListEntry,
} from "@/lib/passkey-addition";
import { groceryKeys } from "@/types";

/**
 * The passkeys of this account, and "add another", from Settings.
 *
 * The card has two halves and they answer different questions.
 *
 * **Closed** — what this account already has. It lists the passkeys by the name
 * the device was given when it was registered and when each was last used, in
 * the shape the voice-token list and the invitation list use for the same two
 * facts, because it is the same gesture and must not have to be learned twice.
 * There is no bin at the end of the row, unlike those two: this release has no
 * route that deletes a credential, and a control implying one would be a
 * promise the server cannot keep.
 *
 * **Open** — what adding one will do. Authorised by the session and by nothing
 * else — no installation token, no invitation, and the server refuses a request
 * carrying two authorities at once — but the session alone is not enough for
 * this, so before anything happens it asks for proof of identity. What it says
 * while asking depends on the account: for one with a password, registering
 * destroys it in the same transaction that creates the credential and no screen
 * in this version puts it back; for one that has no password — every account
 * migrated from an older installation — there is nothing to destroy.
 */
export function PasskeyCard() {
  const t = useTranslations("passkeyCard");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { register, pending } = usePasskeyRegistration();
  // On mount, not on open. The closed card is the one on the screen, and until
  // this arrived it described an account it had never asked about.
  const { data, isError } = usePasskeyAccount();
  const cuenta = data ?? null;
  const [abierto, setAbierto] = useState(false);
  const [contrasena, setContrasena] = useState("");

  // window.isSecureContext is the browser's own authority on whether it will
  // let a passkey be created, and it is right where APP_ORIGIN is wrong: on
  // http://localhost — a secure context — the scheme says "no" and the browser
  // says "yes". Read after hydration, as in /login and /setup: the server
  // cannot know it, and reading it during render made the card swap out on its
  // own.
  const contextoSeguro = useSecureContext();
  const hayWebAuthn = useWebAuthnSupport();
  const disponible = contextoSeguro && hayWebAuthn;

  const cerrada = closedPasskeyCard({ available: disponible, account: cuenta, failed: isError });
  const metodo = cuenta?.reauth ?? null;
  // Three states, and the panel says something different in each. The third —
  // no password and no passkey — cannot belong to anybody signed in, and is
  // handled rather than guessed: see src/lib/passkey-addition.ts.
  const copia = cuenta ? passkeyCopy(passkeyAddition(cuenta)) : null;

  async function confirmar() {
    // Unreachable: the confirmation only exists once the account has answered.
    // Returning beats defaulting, which would mean picking one of the two
    // messages without knowing which is true — the bug this replaces.
    if (!copia) return;
    const hecho = await register({
      deviceName: nombreDeDispositivo(t("deviceGeneric")),
      currentPassword: metodo === "password" ? contrasena : undefined,
    });
    setContrasena("");
    if (hecho) {
      setAbierto(false);
      toast.success(t(copia.added));
      // The key that was just created belongs in the list below, and the line
      // above it now counts one more.
      void queryClient.invalidateQueries({ queryKey: groceryKeys.passkeys });
    } else {
      toast.error(t("addFailed"));
    }
  }

  return (
    <section>
      <div className="rounded-[18px] border border-line bg-surface px-4 py-4 shadow-[var(--e1)]">
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-xl"
            style={{ background: "color-mix(in srgb, #d6a13f 16%, transparent)" }}
          >
            🔑
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-ink">{t("title")}</span>
            <span className="mt-0.5 block text-xs font-medium text-muted">
              {cerrada.subtitle.key === "subtitleCount"
                ? t("subtitleCount", { count: cerrada.subtitle.count })
                : t(cerrada.subtitle.key)}
            </span>
          </span>
          {!abierto && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              disabled={!disponible || pending || cerrada.action === null}
              className="tap-press shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-bold text-on-brand disabled:opacity-40"
            >
              {/* Not "Add" as a placeholder: while the account is unknown, both
                  labels are claims about it, and showing one and then swapping
                  to the other is the flicker this card is being fixed for. */}
              {cerrada.action === null ? "…" : t(cerrada.action)}
            </button>
          )}
        </div>

        {abierto && copia && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            {/* No paragraph at all in the third state: both of the others would
                assert something about this account that nothing has established,
                and the refusal below is the whole of what is true. */}
            {copia.warning && (
              <p className="text-xs font-medium leading-relaxed text-ink-2">
                {t.rich(copia.warning, richTags)}
              </p>
            )}

            {metodo === "password" && (
              <input
                type="password"
                autoComplete="current-password"
                aria-label={t("passwordLabel")}
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full rounded-[15px] border border-line bg-bg px-4 py-3 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
              />
            )}
            {metodo === "presence" && (
              <p className="text-xs font-medium text-muted">
                {t("presenceHint")}
              </p>
            )}
            {metodo === null && (
              <p className="text-xs font-medium text-danger">
                {t("noWayToConfirm")}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAbierto(false);
                  setContrasena("");
                }}
                disabled={pending}
                className="tap-press flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink disabled:opacity-40"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={pending || metodo === null || (metodo === "password" && !contrasena)}
                className="tap-press flex-1 rounded-full bg-brand px-4 py-2.5 text-xs font-bold text-on-brand disabled:opacity-40"
              >
                {pending ? t("adding") : t(copia.confirm)}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The keys themselves. Rendered whenever there are any, secure context or
          not: an instance served over http cannot create a passkey but still
          holds the ones it has, and hiding them there would put the card back
          to showing nothing at all about the account. */}
      {cerrada.passkeys.length > 0 && (
        <>
          <div className="mb-2.5 ml-0.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("listTitle")}
          </div>
          <ul className="flex flex-col gap-2">
            {cerrada.passkeys.map((passkey) => (
              <li
                key={`${passkey.createdAt}-${passkey.deviceName}`}
                className="rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="block truncate text-[15px] font-semibold text-ink">
                  {passkey.deviceName}
                </span>
                <span className="block text-xs font-medium text-muted">
                  {uso(passkey, t, locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * "Last used: 3 March" or "Never used", written the way the voice-token list
 * writes the same two facts. The date follows the interface's language, which
 * is the one thing `toLocaleDateString` does for free.
 */
function uso(
  passkey: PasskeyListEntry,
  t: (key: string, values?: Record<string, string>) => string,
  locale: string,
): string {
  const used = passkeyUse(passkey);
  return used.key === "lastUse"
    ? t("lastUse", { date: new Date(used.at).toLocaleDateString(locale) })
    : t("neverUsed");
}

/**
 * A recognisable name in the passkey list, without pasting the whole user agent.
 *
 * The five names are brands and are spelled the same in any language; the one
 * that is a phrase — "this device" — arrives translated from the card.
 */
const DEVICE_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/i, "iPhone"],
  [/iPad/i, "iPad"],
  [/Android/i, "Android"],
  [/Macintosh/i, "Mac"],
  [/Windows/i, "Windows"],
];

function nombreDeDispositivo(generico: string): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return DEVICE_NAMES.find(([re]) => re.test(ua))?.[1] ?? generico;
}
