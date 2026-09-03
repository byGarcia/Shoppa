"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { richTags } from "@/components/rich";
import { usePasskeyRegistration, type ReauthMethod } from "@/hooks/use-passkey-registration";
import { useSecureContext, useWebAuthnSupport } from "@/hooks/use-passkey-support";

/**
 * "Add a passkey", from Settings.
 *
 * Authorised by the session and by nothing else — no installation token, no
 * invitation, and the server refuses a request carrying two authorities at once
 * — but the session alone is not enough for this: when it finishes the account
 * has no password (the server deletes it in the same transaction that creates
 * the credential) and this version has no screen that puts one back. So before
 * anything happens it says what is being lost and asks for proof of identity.
 */
export function PasskeyCard() {
  const t = useTranslations("passkeyCard");
  const tCommon = useTranslations("common");
  const { register, reauthMethod, pending } = usePasskeyRegistration();
  const [abierto, setAbierto] = useState(false);
  const [metodo, setMetodo] = useState<ReauthMethod | null>(null);
  const [contrasena, setContrasena] = useState("");
  const [preparando, setPreparando] = useState(false);

  // window.isSecureContext is the browser's own authority on whether it will
  // let a passkey be created, and it is right where APP_ORIGIN is wrong: on
  // http://localhost — a secure context — the scheme says "no" and the browser
  // says "yes". Read after hydration, as in /login and /setup: the server
  // cannot know it, and reading it during render made the card swap out on its
  // own.
  const contextoSeguro = useSecureContext();
  const hayWebAuthn = useWebAuthnSupport();
  const disponible = contextoSeguro && hayWebAuthn;

  async function abrir() {
    setPreparando(true);
    try {
      setMetodo(await reauthMethod());
      setAbierto(true);
    } catch {
      toast.error(t("checkFailed"));
    } finally {
      setPreparando(false);
    }
  }

  async function confirmar() {
    const hecho = await register({
      deviceName: nombreDeDispositivo(t("deviceGeneric")),
      currentPassword: metodo === "password" ? contrasena : undefined,
    });
    setContrasena("");
    if (hecho) {
      setAbierto(false);
      toast.success(t("added"));
    } else {
      toast.error(t("addFailed"));
    }
  }

  return (
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
            {disponible ? t("subtitleReady") : t("subtitleInsecure")}
          </span>
        </span>
        {!abierto && (
          <button
            type="button"
            onClick={() => void abrir()}
            disabled={!disponible || pending || preparando}
            className="tap-press shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-bold text-on-brand disabled:opacity-40"
          >
            {preparando ? "…" : t("add")}
          </button>
        )}
      </div>

      {abierto && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-xs font-medium leading-relaxed text-ink-2">
            {t.rich("warning", richTags)}
          </p>

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
              {pending ? t("adding") : t("confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
