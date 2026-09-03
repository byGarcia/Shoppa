"use client";

import { useTranslations } from "next-intl";

import type { StoreDTO } from "@/types";
import { storeColor } from "@/lib/category-visuals";

/**
 * Small per-row store tag for the "All" view. Two variants:
 * a store chip (bg-chip + color dot) and a dashed "Unassigned" tag for
 * inbox items (same dashed language as the inbox tab). Both use text-ink-2,
 * never text-muted: --muted fails AA contrast at 11px on both backgrounds.
 * The dot is aria-hidden redundancy; the text carries the meaning.
 */
export function StoreBadge({ store }: { store: StoreDTO | null }) {
  const t = useTranslations("list");

  if (!store) {
    return (
      <span className="shrink-0 rounded-[8px] border border-dashed border-line-2 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
        {t("unassigned")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 max-w-[96px] shrink items-center gap-1 rounded-[8px] bg-chip px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: storeColor(store) }} />
      <span className="truncate">{store.name}</span>
    </span>
  );
}
