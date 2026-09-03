"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";

import { richTags } from "@/components/rich";
import {
  isLastCredentialRefusal,
  useDeletePasskey,
  usePasskeyAccount,
  usePasskeyRegistration,
} from "@/hooks/use-passkey-registration";
import { useSecureContext, useWebAuthnSupport } from "@/hooks/use-passkey-support";
import {
  closedPasskeyCard,
  passkeyAddition,
  passkeyCopy,
  passkeyUse,
  type PasskeyListEntry,
  type PasskeyRow,
} from "@/lib/passkey-addition";
import { groceryKeys } from "@/types";

/**
 * The passkeys of this account, from Settings: what it has, one more, one less.
 *
 * The card has two halves and they answer different questions.
 *
 * **Closed** — what this account already has. It lists the passkeys by the name
 * the device was given when it was registered and when each was last used, in
 * the shape the voice-token list and the invitation list use for the same two
 * facts, because it is the same gesture and must not have to be learned twice.
 * Each row now ends in the same bin those two carry, and it does the same job:
 * until this existed a phone that was lost a year ago still opened the
 * instance, and the only way to retire its key was a database console.
 *
 * The bin is withheld from one row and one only: the last credential of an
 * account with no password, where deleting it would leave nobody able to sign
 * in and no screen able to undo it. A line under the list says so, because a
 * row that is quietly different from every other row in Settings reads as a
 * bug. The server refuses it too, and it is the server that decides — this card
 * can be a minute out of date and two of them can be open at once.
 *
 * **Open** — what adding one will do. Authorised by the session and by nothing
 * else, but the session alone is not enough for this: before anything happens
 * it asks for proof of identity. Deleting asks for exactly the same proof, and
 * for the same reason — a borrowed session must not be able to attach a key of
 * its own, nor strip the owner's.
 */
export function PasskeyCard() {
  const t = useTranslations("passkeyCard");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { register, pending } = usePasskeyRegistration();
  const deletion = useDeletePasskey();
  // On mount, not on open. The closed card is the one on the screen, and until
  // this arrived it described an account it had never asked about.
  const { data, isError } = usePasskeyAccount();
  const cuenta = data ?? null;
  const [abierto, setAbierto] = useState(false);
  const [contrasena, setContrasena] = useState("");
  // The key waiting on a password before it goes. Only ever set for an account
  // whose proof IS a password; a presence account confirms with its
  // authenticator and never lands here.
  const [porBorrar, setPorBorrar] = useState<{ id: string; deviceName: string } | null>(null);
  const [contrasenaBorrado, setContrasenaBorrado] = useState("");

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

  /**
   * The bin. Same confirmation the voice-token list uses, then the proof.
   *
   * A password account has to type it, so the row hands over to the panel
   * above; an account with no password proves itself with an authenticator it
   * already has, and there is nothing to type — the ceremony starts here.
   */
  function pedirBorrado(passkey: PasskeyRow) {
    if (!window.confirm(t("deleteConfirm", { name: passkey.deviceName }))) return;
    if (metodo === "password") {
      // One panel at a time: the card cannot be adding and removing at once.
      setAbierto(false);
      setContrasena("");
      setContrasenaBorrado("");
      setPorBorrar({ id: passkey.id, deviceName: passkey.deviceName });
      return;
    }
    void borrar(passkey.id);
  }

  async function borrar(id: string, currentPassword?: string) {
    try {
      await deletion.mutateAsync({ id, currentPassword });
      setPorBorrar(null);
      setContrasenaBorrado("");
      toast.success(t("deleted"));
    } catch (error) {
      // The one refusal this card can explain rather than merely report. It
      // reaches here when the list on the screen was out of date — another tab,
      // another phone — because the row it came from carried no bin.
      toast.error(isLastCredentialRefusal(error) ? t("deleteLast") : t("deleteFailed"));
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
          {!abierto && !porBorrar && (
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

        {/* Removing asks for exactly what adding asks for. The panel is the same
            panel because it is the same question. */}
        {porBorrar && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <p className="text-xs font-medium leading-relaxed text-ink-2">
              {t.rich("deletePrompt", { ...richTags, name: porBorrar.deviceName })}
            </p>
            <input
              type="password"
              autoComplete="current-password"
              aria-label={t("passwordLabel")}
              value={contrasenaBorrado}
              onChange={(e) => setContrasenaBorrado(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full rounded-[15px] border border-line bg-bg px-4 py-3 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPorBorrar(null);
                  setContrasenaBorrado("");
                }}
                disabled={deletion.isPending}
                className="tap-press flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink disabled:opacity-40"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void borrar(porBorrar.id, contrasenaBorrado)}
                disabled={deletion.isPending || !contrasenaBorrado}
                className="tap-press flex-1 rounded-full bg-danger px-4 py-2.5 text-xs font-bold text-on-brand disabled:opacity-40"
              >
                {deletion.isPending ? t("deleting") : t("deleteConfirmButton")}
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
                key={passkey.id}
                className="flex items-center gap-2 rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {passkey.deviceName}
                  </span>
                  <span className="block text-xs font-medium text-muted">
                    {uso(passkey, t, locale)}
                  </span>
                </span>
                {/* Withheld from the account's only way in — see
                    closedPasskeyCard. A bin the server would refuse is a promise
                    it cannot keep, and this card has been fixed twice for
                    exactly that. */}
                {passkey.removable && (
                  <button
                    type="button"
                    aria-label={t("deleteLabel", { name: passkey.deviceName })}
                    disabled={deletion.isPending || pending}
                    className="tap-press flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-danger-tint text-danger disabled:opacity-40"
                    onClick={() => pedirBorrado(passkey)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {cerrada.explainLastKey && (
            <p className="mt-2.5 px-1 text-xs font-medium leading-relaxed text-muted">
              {t("deleteLast")}
            </p>
          )}
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
