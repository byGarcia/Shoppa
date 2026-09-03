import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/settings/page-header";
import { VoiceTokenManager } from "@/components/settings/voice-token-manager";
import { appOrigin } from "@/lib/env";

// The shape of the guide, not its words: how many blocks and how many lines
// each has. The words live in messages/*.json under `settings.shortcut`.
const BLOCKS = [
  { key: "step1", lines: 8 },
  { key: "step2", lines: 4 },
  { key: "step3", lines: 7 },
  { key: "note", lines: 2 },
] as const;

/**
 * The origin to print in the guide, taken from the request that is reading it.
 *
 * These URLs get copied by hand into an iOS Shortcut, so the one that has to be
 * right is the one this browser just used — an instance reachable both at a LAN
 * address and at a public name must give each visitor the one that works from
 * where they are. So the HOST comes from the request.
 *
 * The SCHEME does not: `Host` says nothing about it, and a request that reached
 * a container through a reverse proxy arrives as plain HTTP however the browser
 * asked for it. `APP_ORIGIN` is this application's single authority on whether
 * it is served over TLS — it is what decides cookie security and HSTS — so it
 * decides here too. With no `Host` header at all, `APP_ORIGIN` answers both.
 */
async function instanceOrigin(): Promise<string> {
  const host = (await headers()).get("host");
  const configured = appOrigin();
  if (!host) return configured.origin;
  return `${configured.protocol}//${host}`;
}

export default async function ShortcutPage() {
  const t = await getTranslations("settings.shortcut");
  const origin = await instanceOrigin();

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader title={t("title")} />

      <VoiceTokenManager />

      <div className="mb-2.5 ml-0.5 mt-6 text-[11px] font-bold uppercase tracking-wide text-muted">
        {t("heading")}
      </div>
      <div className="flex flex-col gap-2.5">
        {BLOCKS.map((block) => (
          <section
            key={block.key}
            className="rounded-[14px] border border-line bg-surface p-4 shadow-[var(--e1)]"
          >
            <h2 className="text-[15px] font-bold text-ink">{t(`${block.key}Title`)}</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] font-medium leading-relaxed text-ink-2">
              {Array.from({ length: block.lines }, (_, i) => (
                <li key={i}>{t(`${block.key}Line${i + 1}`, { origin })}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
