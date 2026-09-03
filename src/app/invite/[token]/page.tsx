import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { authMode, isSecureOrigin } from "@/lib/env";
import { inspectInvitation, invitationRefusalMessage } from "@/server/invitations";

import { InviteForm } from "./invite-form";

// Same reason as /setup: AUTH_MODE and APP_ORIGIN are read per request, and
// this screen also looks up the state of the invitation. Prerendering it would
// freeze all three on the machine that built the image — which is nobody's —
// and would show the form for an invitation that has already been spent.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const invitation = await inspectInvitation(token);

  if (!invitation.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-[30px] text-center safe-top safe-bottom">
        <div
          className="flex h-[76px] w-[76px] items-center justify-center rounded-[24px] bg-chip text-[38px]"
          style={{ boxShadow: "var(--e2)" }}
        >
          🧺
        </div>
        <div className="font-display text-[28px] font-semibold leading-none tracking-tight text-ink">
          {t("invalidTitle")}
        </div>
        <p className="max-w-[300px] text-[15px] font-medium leading-relaxed text-ink-2">
          {await invitationRefusalMessage(invitation.reason)}
        </p>
        <Link
          href="/login"
          className="tap-press mt-2 rounded-full border border-line bg-surface px-5 py-2.5 text-xs font-bold text-ink shadow-[var(--e1)]"
        >
          {t("goToLogin")}
        </Link>
      </main>
    );
  }

  const mode = authMode();
  return (
    <InviteForm
      token={token}
      // AUTH_MODE is the only thing the server decides here. Whether the
      // browser will let a passkey be created is the browser's own call, made
      // on the client with window.isSecureContext: APP_ORIGIN is wrong about
      // http://localhost, which is a secure context where passkeys work, and a
      // screen that says "you need HTTPS" there is saying something false.
      passkeysAllowedByMode={mode !== "password"}
      appOriginIsHttps={isSecureOrigin()}
      passwordEnabled={mode !== "passkey"}
    />
  );
}
