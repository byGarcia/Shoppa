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
  const account = data ?? null;
  const [addOpen, setAddOpen] = useState(false);
  const [password, setPassword] = useState("");
  // The key waiting on a password before it goes. Only ever set for an account
  // whose proof IS a password; a presence account confirms with its
  // authenticator and never lands here.
  const [pendingDeletion, setPendingDeletion] = useState<{ id: string; deviceName: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");

  // window.isSecureContext is the browser's own authority on whether it will
  // let a passkey be created, and it is right where APP_ORIGIN is wrong: on
  // http://localhost — a secure context — the scheme says "no" and the browser
  // says "yes". Read after hydration, as in /login and /setup: the server
  // cannot know it, and reading it during render made the card swap out on its
  // own.
  const secureContext = useSecureContext();
  const hasWebAuthn = useWebAuthnSupport();
  const available = secureContext && hasWebAuthn;

  const closed = closedPasskeyCard({ available, account, failed: isError });
  const method = account?.reauth ?? null;
  // Three states, and the panel says something different in each. The third —
  // no password and no passkey — cannot belong to anybody signed in, and is
  // handled rather than guessed: see src/lib/passkey-addition.ts.
  const copy = account ? passkeyCopy(passkeyAddition(account)) : null;

  async function confirmAddition() {
    // Unreachable: the confirmation only exists once the account has answered.
    // Returning beats defaulting, which would mean picking one of the two
    // messages without knowing which is true — the bug this replaces.
    if (!copy) return;
    const added = await register({
      deviceName: detectDeviceName(t("deviceGeneric")),
      currentPassword: method === "password" ? password : undefined,
    });
    setPassword("");
    if (added) {
      setAddOpen(false);
      toast.success(t(copy.added));
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
  function requestDeletion(passkey: PasskeyRow) {
    if (!window.confirm(t("deleteConfirm", { name: passkey.deviceName }))) return;
    if (method === "password") {
      // One panel at a time: the card cannot be adding and removing at once.
      setAddOpen(false);
      setPassword("");
      setDeletePassword("");
      setPendingDeletion({ id: passkey.id, deviceName: passkey.deviceName });
      return;
    }
    void deletePasskey(passkey.id);
  }

  async function deletePasskey(id: string, currentPassword?: string) {
    try {
      await deletion.mutateAsync({ id, currentPassword });
      setPendingDeletion(null);
      setDeletePassword("");
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
              {closed.subtitle.key === "subtitleCount"
                ? t("subtitleCount", { count: closed.subtitle.count })
                : t(closed.subtitle.key)}
            </span>
          </span>
          {!addOpen && !pendingDeletion && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={!available || pending || closed.action === null}
              className="tap-press shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-bold text-on-brand disabled:opacity-40"
            >
              {/* Not "Add" as a placeholder: while the account is unknown, both
                  labels are claims about it, and showing one and then swapping
                  to the other is the flicker this card is being fixed for. */}
              {closed.action === null ? "…" : t(closed.action)}
            </button>
          )}
        </div>

        {addOpen && copy && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            {/* No paragraph at all in the third state: both of the others would
                assert something about this account that nothing has established,
                and the refusal below is the whole of what is true. */}
            {copy.warning && (
              <p className="text-xs font-medium leading-relaxed text-ink-2">
                {t.rich(copy.warning, richTags)}
              </p>
            )}

            {method === "password" && (
              <input
                type="password"
                autoComplete="current-password"
                aria-label={t("passwordLabel")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full rounded-[15px] border border-line bg-bg px-4 py-3 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
              />
            )}
            {method === "presence" && (
              <p className="text-xs font-medium text-muted">
                {t("presenceHint")}
              </p>
            )}
            {method === null && (
              <p className="text-xs font-medium text-danger">
                {t("noWayToConfirm")}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setPassword("");
                }}
                disabled={pending}
                className="tap-press flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink disabled:opacity-40"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmAddition()}
                disabled={pending || method === null || (method === "password" && !password)}
                className="tap-press flex-1 rounded-full bg-brand px-4 py-2.5 text-xs font-bold text-on-brand disabled:opacity-40"
              >
                {pending ? t("adding") : t(copy.confirm)}
              </button>
            </div>
          </div>
        )}

        {/* Removing asks for exactly what adding asks for. The panel is the same
            panel because it is the same question. */}
        {pendingDeletion && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <p className="text-xs font-medium leading-relaxed text-ink-2">
              {t.rich("deletePrompt", { ...richTags, name: pendingDeletion.deviceName })}
            </p>
            <input
              type="password"
              autoComplete="current-password"
              aria-label={t("passwordLabel")}
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full rounded-[15px] border border-line bg-bg px-4 py-3 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDeletion(null);
                  setDeletePassword("");
                }}
                disabled={deletion.isPending}
                className="tap-press flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink disabled:opacity-40"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void deletePasskey(pendingDeletion.id, deletePassword)}
                disabled={deletion.isPending || !deletePassword}
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
      {closed.passkeys.length > 0 && (
        <>
          <div className="mb-2.5 ml-0.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("listTitle")}
          </div>
          <ul className="flex flex-col gap-2">
            {closed.passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center gap-2 rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {passkey.deviceName}
                  </span>
                  <span className="block text-xs font-medium text-muted">
                    {usageLine(passkey, t, locale)}
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
                    onClick={() => requestDeletion(passkey)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {closed.explainLastKey && (
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
function usageLine(
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

function detectDeviceName(fallback: string): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return DEVICE_NAMES.find(([re]) => re.test(ua))?.[1] ?? fallback;
}
