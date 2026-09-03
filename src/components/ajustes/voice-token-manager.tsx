"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { useVoiceTokens, useCreateVoiceToken, useDeleteVoiceToken } from "@/hooks/use-voice-tokens";

export function VoiceTokenManager() {
  const t = useTranslations("voiceTokens");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: tokens = [] } = useVoiceTokens();
  const createToken = useCreateVoiceToken();
  const deleteToken = useDeleteVoiceToken();
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);
  // Plaintext of the token just generated — exists only in this component
  // state, shown once: settings can generate and revoke a token, never
  // show an existing one again.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  return (
    <section>
      <div className="rounded-[18px] border border-line bg-surface p-[18px] shadow-[var(--e1)]">
        <div className="text-[15px] font-bold text-ink">{t("title")}</div>
        <p className="mt-1.5 text-xs font-medium leading-relaxed text-muted">
          {t.rich("intro", { b: (chunks) => <b className="text-ink-2">{chunks}</b> })}
        </p>

        {freshToken ? (
          <div
            className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-dashed border-line-2 bg-bg px-3.5 py-3"
            style={{ animation: "rise .3s ease" }}
          >
            <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{freshToken}</code>
            <button
              aria-label={t("copyLabel")}
              className="tap-press shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-on-brand"
              onClick={async () => {
                await navigator.clipboard.writeText(freshToken);
                toast.success(t("copiedToast"));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? tCommon("copied") : tCommon("copy")}
            </button>
          </div>
        ) : (
          <form
            className="mt-3.5 flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!label.trim()) return;
              createToken.mutate({ label: label.trim() }, { onSuccess: (data) => setFreshToken(data.token) });
              setLabel("");
            }}
          >
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("namePlaceholder")}
              aria-label={t("nameLabel")}
              className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] font-medium text-ink outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={createToken.isPending || !label.trim()}
              className="tap-press w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-on-brand disabled:opacity-50"
              style={{ boxShadow: "0 8px 20px -8px var(--brand)" }}
            >
              {t("generate")}
            </button>
          </form>
        )}
      </div>

      {tokens.length > 0 && (
        <>
          <div className="mb-2.5 ml-0.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("activeTitle")}
          </div>
          <ul className="flex flex-col gap-2">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center gap-2 rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{token.label}</span>
                  <span className="block text-xs font-medium text-muted">
                    {token.lastUsedAt
                      ? t("lastUse", { date: new Date(token.lastUsedAt).toLocaleDateString(locale) })
                      : t("neverUsed")}
                  </span>
                </span>
                <button
                  aria-label={t("revokeLabel", { name: token.label })}
                  className="tap-press flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-danger-tint text-danger"
                  onClick={() => {
                    if (window.confirm(t("revokeConfirm", { name: token.label }))) {
                      deleteToken.mutate(token.id);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
