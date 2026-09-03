"use client";

import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ajustes/page-header";
import { useHints, useUpdateHint, useDeleteHint } from "@/hooks/use-hints";
import { useCategories } from "@/hooks/use-categories";
import { useCategoryName } from "@/hooks/use-category-name";
import { useStores } from "@/hooks/use-stores";

export default function DictionaryPage() {
  const t = useTranslations("settings.dictionary");
  const categoryName = useCategoryName();
  const { data: hints = [] } = useHints();
  const { data: categories = [] } = useCategories();
  const { data: stores = [] } = useStores();
  const updateHint = useUpdateHint();
  const deleteHint = useDeleteHint();
  const [query, setQuery] = useState("");

  const filtered = hints.filter((hint) => hint.normalizedName.includes(query.trim().toLowerCase()));

  const SELECT_CLASS =
    "min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 text-sm font-medium text-ink outline-none";

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]">
        <Search size={17} className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
        />
      </div>

      <p className="mt-2.5 px-0.5 text-xs font-medium text-muted">
        {t("count", { shown: filtered.length, total: hints.length })}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {filtered.slice(0, 100).map((hint) => (
          <li
            key={hint.id}
            className="rounded-[13px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                {hint.normalizedName}
              </span>
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={
                  hint.origin === "LEARNED"
                    ? { background: "var(--brand-tint)", color: "var(--brand-strong)" }
                    : { background: "var(--chip)", color: "var(--muted)" }
                }
              >
                {hint.origin === "LEARNED" ? t("learned") : t("factory")}
              </span>
              <button
                aria-label={t("deleteLabel", { name: hint.normalizedName })}
                className="tap-press flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg bg-danger-tint text-danger"
                onClick={() => deleteHint.mutate(hint.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <select
                value={hint.categoryId ?? ""}
                onChange={(e) => updateHint.mutate({ id: hint.id, categoryId: e.target.value || null })}
                aria-label={t("categoryLabel", { name: hint.normalizedName })}
                className={SELECT_CLASS}
              >
                <option value="">{t("noCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {categoryName(c)}
                  </option>
                ))}
              </select>
              <select
                value={hint.storeHintId ?? ""}
                onChange={(e) => updateHint.mutate({ id: hint.id, storeHintId: e.target.value || null })}
                aria-label={t("storeLabel", { name: hint.normalizedName })}
                className={SELECT_CLASS}
              >
                <option value="">{t("noStore")}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
        {filtered.length > 100 && (
          <li className="py-2 text-center text-xs font-medium text-muted">
            {t("truncated")}
          </li>
        )}
        {filtered.length === 0 && (
          <li className="rounded-[13px] border border-line bg-surface px-4 py-6 text-center text-sm text-muted shadow-[var(--e1)]">
            {hints.length === 0 ? t("empty") : t("noMatches")}
          </li>
        )}
      </ul>
    </main>
  );
}
