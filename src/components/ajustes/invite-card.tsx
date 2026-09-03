"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";

import { richTags } from "@/components/rich";
import {
  useCreateInvitation,
  useInvitations,
  useRevokeInvitation,
} from "@/hooks/use-invitations";
import type { InvitationDTO } from "@/types";

/**
 * "Invite someone", from Settings: how everybody who is not the first person
 * gets into this house.
 *
 * The link is shown ONCE, exactly like the Siri Shortcut token and for the same
 * reason: the server stores its hash, not the link, so there is nowhere to go
 * and look it up afterwards.
 *
 * Which is why there is a list underneath. Closing the sessions of a lost phone
 * — bumping token_version — does not touch the invitations that session
 * created: they stay live for up to 72 hours with no way to see them or take
 * them back. This is that way. The screen is the voice-token one on purpose
 * (list, when it was created, whether it was used, a bin): it is the same
 * gesture and must not have to be learned twice.
 */
export function InviteCard() {
  const t = useTranslations("inviteCard");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: invitations = [] } = useInvitations();
  const create = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Spent ones stay in the database because they are the record of who came in,
  // but the Settings list is for acting: what is actionable is what still opens
  // the door.
  const live = invitations.filter((i) => i.state === "pending");
  const spent = invitations.filter((i) => i.state !== "pending");

  return (
    <section>
      <div className="rounded-[18px] border border-line bg-surface px-4 py-4 shadow-[var(--e1)]">
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-xl"
            style={{ background: "color-mix(in srgb, #d6606f 16%, transparent)" }}
          >
            ✉️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-ink">{t("title")}</span>
            <span className="mt-0.5 block text-xs font-medium text-muted">{t("subtitle")}</span>
          </span>
          {!link && (
            <button
              type="button"
              onClick={() =>
                create.mutate(undefined, { onSuccess: (data) => setLink(data) })
              }
              disabled={create.isPending}
              className="tap-press shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-bold text-on-brand disabled:opacity-40"
            >
              {create.isPending ? "…" : t("create")}
            </button>
          )}
        </div>

        {link && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <p className="text-xs font-medium leading-relaxed text-ink-2">
              {t.rich("copyNow", richTags)}
            </p>
            <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-line-2 bg-bg px-3.5 py-3">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">
                {link.url}
              </code>
              <button
                type="button"
                aria-label={t("copyLabel")}
                className="tap-press shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-on-brand"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.url);
                  toast.success(t("copiedToast"));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? tCommon("copied") : tCommon("copy")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setLink(null)}
              className="tap-press w-full rounded-full border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink"
            >
              {t("done")}
            </button>
          </div>
        )}
      </div>

      {live.length > 0 && (
        <>
          <div className="mb-2.5 ml-0.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("pendingTitle")}
          </div>
          <ul className="flex flex-col gap-2">
            {live.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-2 rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {t("from", { email: invitation.createdByEmail })}
                  </span>
                  <span className="block text-xs font-medium text-muted">
                    {t("expires", { date: formatDate(invitation.expiresAt, locale) })}
                  </span>
                </span>
                <button
                  aria-label={t("revokeLabel", { email: invitation.createdByEmail })}
                  className="tap-press flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-danger-tint text-danger"
                  onClick={() => {
                    if (
                      window.confirm(t("revokeConfirm"))
                    ) {
                      revoke.mutate(invitation.id);
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

      {spent.length > 0 && (
        <>
          <div className="mb-2.5 ml-0.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("spentTitle")}
          </div>
          <ul className="flex flex-col gap-2">
            {spent.map((invitation) => (
              <li
                key={invitation.id}
                className="rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
              >
                <span className="block truncate text-[15px] font-semibold text-ink">
                  {titulo(invitation, t)}
                </span>
                <span className="block text-xs font-medium text-muted">
                  {t("spentMeta", {
                    email: invitation.createdByEmail,
                    date: formatDate(invitation.createdAt, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function titulo(invitation: InvitationDTO, t: (key: string, values?: Record<string, string>) => string): string {
  switch (invitation.state) {
    case "redeemed":
      return t("usedBy", { email: invitation.redeemedByEmail ?? "" });
    case "revoked":
      return t("revoked");
    case "expired":
      return t("expired");
    case "pending":
      return t("unused");
  }
}

// The month name and the clock follow the interface's language, not the
// installation's: a date written in Spanish under an English sentence reads as
// a bug, and it is the one thing `toLocaleString` will do for free.
function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
