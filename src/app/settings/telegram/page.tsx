"use client";

import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/settings/page-header";
import { useTestTelegram } from "@/hooks/use-prices";

// The shape of the guide, not its words. See settings.telegram in messages/.
const BLOCKS = [
  { key: "step1", lines: 3 },
  { key: "step2", lines: 4 },
  { key: "step3", lines: 4 },
  { key: "step4", lines: 4 },
] as const;

export default function TelegramPage() {
  const t = useTranslations("settings.telegram");
  const test = useTestTelegram();

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <button
        onClick={() => test.mutate()}
        disabled={test.isPending}
        className="tap-press flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-brand text-[15px] font-bold text-on-brand disabled:opacity-40"
      >
        {test.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {t("send")}
      </button>
      <p className="mt-2 px-1 text-center text-[11px] font-medium leading-relaxed text-muted">
        {t("sendHint")}
      </p>

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
                <li key={i}>{t(`${block.key}Line${i + 1}`)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
