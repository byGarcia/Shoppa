"use client";

import { useTranslations } from "next-intl";

import { ItemRow } from "@/components/list/item-row";
import { StoreBadge } from "@/components/list/store-badge";
import { categoryVisual } from "@/lib/category-visuals";
import { useCategoryName } from "@/hooks/use-category-name";
import type { CategoryDTO, ItemDTO, StoreDTO } from "@/types";

type Props = {
  category: CategoryDTO | null; // null = the uncategorized section
  items: ItemDTO[];
  onToggle: (item: ItemDTO) => void;
  onEdit: (item: ItemDTO) => void;
  /** The "all stores" view: render a per-row store tag. */
  showStoreBadges?: boolean;
  storesById?: Map<string, StoreDTO>;
};

export function CategorySection({ category, items, onToggle, onEdit, showStoreBadges, storesById }: Props) {
  const t = useTranslations("list");
  const categoryName = useCategoryName();
  const vis = categoryVisual(category);
  const label = category ? categoryName(category) : t("noCategory");
  const done = items.filter((i) => i.checked).length;

  return (
    <section style={{ animation: "rise .4s ease" }}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-[9px] text-[15px]"
          style={{ background: vis.chipBg }}
        >
          {vis.emoji}
        </span>
        <span className="text-[13px] font-bold text-ink">{label}</span>
        <span className="rounded-[9px] bg-chip px-2 py-0.5 text-[11px] font-semibold text-muted">
          {done}/{items.length}
        </span>
        <span className="flex-1" />
        <span className="h-[3px] w-[22px] rounded-sm opacity-50" style={{ background: vis.color }} />
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          // Dangling storeId (transient race) degrades to the inbox variant.
          const store = item.storeId ? storesById?.get(item.storeId) ?? null : null;
          return (
            <ItemRow
              key={item.id}
              item={item}
              onToggle={onToggle}
              onEdit={onEdit}
              storeBadge={showStoreBadges ? <StoreBadge store={store} /> : undefined}
              storeLabel={showStoreBadges ? store?.name ?? t("unassigned") : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}
