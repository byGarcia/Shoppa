"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/hooks/use-theme";
import { PasskeyCard } from "@/components/ajustes/passkey-card";
import { InviteCard } from "@/components/ajustes/invite-card";
import { LanguageSwitch } from "@/components/ajustes/language-switch";

// Route, emoji and tint are wiring; the two lines of copy come from the catalog
// under the card's own name.
const CARDS = [
  { href: "/ajustes/supers", emoji: "🏪", key: "stores", tint: "#3fa372" },
  { href: "/ajustes/categorias", emoji: "🏷️", key: "categories", tint: "#8b6fd6" },
  { href: "/ajustes/diccionario", emoji: "📖", key: "dictionary", tint: "#c98a3b" },
  { href: "/ajustes/atajo", emoji: "🎙️", key: "shortcut", tint: "#5b8fd6" },
  { href: "/ajustes/telegram", emoji: "📉", key: "telegram", tint: "#4a9ecb" },
] as const;

export default function AjustesPage() {
  const t = useTranslations("settings");
  const tLinks = useTranslations("settings.links");
  const tCommon = useTranslations("common");
  const { dark, toggle } = useTheme();

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <header className="flex items-center gap-3 py-3">
        <Link
          href="/"
          aria-label={tCommon("back")}
          className="tap-press flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-[var(--e1)]"
        >
          <ChevronLeft size={20} />
        </Link>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("title")}</h1>
      </header>

      <div className="space-y-2.5">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="tap-press flex items-center gap-3.5 rounded-[18px] border border-line bg-surface px-4 py-4 shadow-[var(--e1)]"
            style={{ animation: "rise .35s ease" }}
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-xl"
              style={{ background: `color-mix(in srgb, ${c.tint} 16%, transparent)` }}
            >
              {c.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold text-ink">{tLinks(`${c.key}Title`)}</span>
              <span className="mt-0.5 block text-xs font-medium text-muted">
                {tLinks(`${c.key}Subtitle`)}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" />
          </Link>
        ))}

        <PasskeyCard />

        <InviteCard />

        {/* Appearance / theme */}
        <div className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface px-4 py-4 shadow-[var(--e1)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-chip text-xl">
            {dark ? "🌙" : "☀️"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-ink">{t("appearance")}</span>
            <span className="mt-0.5 block text-xs font-medium text-muted">
              {dark ? t("darkMode") : t("lightMode")}
            </span>
          </span>
          <button
            role="switch"
            aria-checked={dark}
            aria-label={t("themeToggleLabel")}
            onClick={toggle}
            className="relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-200"
            style={{ background: dark ? "var(--brand)" : "var(--line-2)" }}
          >
            <span
              className="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-[left] duration-200"
              style={{ left: dark ? "25px" : "3px", transitionTimingFunction: "cubic-bezier(.22,1,.36,1)" }}
            />
          </button>
        </div>

        <LanguageSwitch />

        <p className="px-2 pt-3 text-center text-[11px] font-medium text-muted">{t("footer")}</p>
      </div>
    </main>
  );
}
