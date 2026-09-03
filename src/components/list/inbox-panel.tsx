"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { CategoryDTO, ItemDTO, StoreDTO } from "@/types";
import type { UpdateItemInput } from "@/hooks/use-items";
import { categoryVisual, storeColor } from "@/lib/category-visuals";
import { useCategoryName } from "@/hooks/use-category-name";

type Props = {
  items: ItemDTO[]; // inbox items (storeId === null), unchecked first
  stores: StoreDTO[];
  categories: CategoryDTO[];
  isLoading: boolean;
  onAssign: (input: UpdateItemInput) => void;
  onEdit: (item: ItemDTO) => void;
};

export function InboxPanel({ items, stores, categories, isLoading, onAssign, onEdit }: Props) {
  const t = useTranslations("list.inbox");
  const tList = useTranslations("list");
  const categoryName = useCategoryName();
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const pending = items.filter((item) => !item.checked);

  if (items.length === 0) {
    // No empty-state flash before the first fetch resolves.
    if (isLoading) return null;
    return (
      <div className="mt-6 flex flex-col items-center gap-2 px-5 py-14 text-center" style={{ animation: "rise .4s ease" }}>
        <div className="text-[52px] leading-none">✅</div>
        <div className="text-base font-bold text-ink">{t("emptyTitle")}</div>
        <p className="max-w-[220px] text-[13px] leading-relaxed text-muted">{t("emptyBody")}</p>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      {/* Bulk: assign every pending item to one super */}
      {pending.length > 1 && stores.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]">
          <div className="mb-2.5 text-[11px] font-semibold text-muted">{t("assignAll")}</div>
          <div className="cw flex gap-2 overflow-x-auto">
            {stores.map((store) => (
              <button
                key={store.id}
                onClick={() => {
                  for (const item of pending) onAssign({ id: item.id, storeId: store.id });
                }}
                className="tap-press flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-bg px-3 py-2 text-xs font-bold text-ink"
              >
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: storeColor(store) }} />
                {store.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.map((item) => {
        const cat = item.categoryId ? catById.get(item.categoryId) : null;
        const vis = categoryVisual(cat);
        return (
          <div
            key={item.id}
            className="overflow-hidden rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
            style={{ animation: "rise .35s ease" }}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <button
                onClick={() => onEdit(item)}
                aria-label={t("editLabel", { name: item.name })}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[15px]"
                style={{ background: vis.chipBg }}
              >
                {vis.emoji}
              </button>
              <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(item)}>
                <div className="truncate text-[15px] font-semibold text-ink">{item.name}</div>
                <div className="truncate text-[11px] font-medium text-muted">
                  {cat ? categoryName(cat) : tList("noCategory")}
                  {item.quantity != null ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : ""}
                </div>
              </button>
              {item.source === "SIRI" && (
                <span className="text-[15px] opacity-50" aria-label={t("dictated")}>
                  🎙️
                </span>
              )}
            </div>

            <div className="cw flex gap-2 overflow-x-auto">
              {stores.map((store) => {
                const suggested = store.id === item.suggestedStoreId;
                return (
                  <button
                    key={store.id}
                    onClick={() => onAssign({ id: item.id, storeId: store.id })}
                    aria-label={t("assignLabel", { name: item.name, store: store.name })}
                    className="tap-press flex shrink-0 items-center gap-1.5 rounded-[11px] border px-2.5 py-[7px] text-xs font-bold"
                    style={{
                      borderColor: suggested ? "var(--brand)" : "var(--line)",
                      background: suggested ? "var(--brand-tint)" : "var(--bg)",
                      color: suggested ? "var(--brand-strong)" : "var(--ink-2)",
                    }}
                  >
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: storeColor(store) }} />
                    {store.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="px-2 pt-1 text-center text-[11px] text-muted">{t("hint")}</p>
    </div>
  );
}
