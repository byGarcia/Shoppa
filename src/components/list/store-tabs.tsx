"use client";

import { useTranslations } from "next-intl";

import type { StoreDTO } from "@/types";
import { storeColor } from "@/lib/category-visuals";

type Props = {
  stores: StoreDTO[];
  active: string; // "all" | "inbox" | store id
  /** D5: pending (unchecked) count per tab; key null = inbox. */
  pendingByStore: Map<string | null, number>;
  onSelect: (key: string) => void;
};

/** Neutral pending-count badge (stores + "All"); hidden at zero like the inbox one. */
function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="rounded-[9px] bg-chip px-1.5 py-px text-[11px] font-bold text-ink-2">
      {count}
    </span>
  );
}

export function StoreTabs({ stores, active, pendingByStore, onSelect }: Props) {
  const t = useTranslations("list");
  let totalPending = 0;
  for (const count of pendingByStore.values()) totalPending += count;
  const inboxCount = pendingByStore.get(null) ?? 0;

  return (
    <nav className="cw -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label={t("storesLabel")}>
      {/* D1: "All" first. No color dot (the dot marks store identity); same
          active/inactive treatment as a store tab, not the inbox's dashed one. */}
      <button
        onClick={() => onSelect("all")}
        aria-pressed={active === "all"}
        className="tap-press flex shrink-0 items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-bold"
        style={{
          background: active === "all" ? "var(--brand)" : "var(--surface)",
          color: active === "all" ? "var(--on-brand)" : "var(--ink-2)",
          boxShadow: active === "all" ? "0 8px 18px -8px var(--brand)" : "var(--e1)",
        }}
      >
        {t("allTab")}
        <CountBadge count={totalPending} />
      </button>

      {stores.map((store) => {
        const isActive = active === store.id;
        return (
          <button
            key={store.id}
            onClick={() => onSelect(store.id)}
            aria-pressed={isActive}
            className="tap-press flex shrink-0 items-center gap-1.5 rounded-[14px] px-4 py-2.5 text-[13px] font-bold"
            style={{
              background: isActive ? "var(--brand)" : "var(--surface)",
              color: isActive ? "var(--on-brand)" : "var(--ink-2)",
              boxShadow: isActive ? "0 8px 18px -8px var(--brand)" : "var(--e1)",
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: storeColor(store) }} />
            {store.name}
            <CountBadge count={pendingByStore.get(store.id) ?? 0} />
          </button>
        );
      })}

      <button
        onClick={() => onSelect("inbox")}
        aria-pressed={active === "inbox"}
        className="tap-press flex shrink-0 items-center gap-1.5 rounded-[14px] border border-dashed px-3.5 py-2.5 text-[13px] font-bold"
        style={{
          borderColor: active === "inbox" ? "var(--brand)" : "var(--line-2)",
          background: active === "inbox" ? "var(--brand-tint)" : "transparent",
          color: active === "inbox" ? "var(--brand-strong)" : "var(--ink-2)",
        }}
      >
        {t("unassignedTab")}
        {inboxCount > 0 && (
          <span
            className="rounded-[9px] px-1.5 py-px text-[11px] font-bold text-white"
            style={{ background: "var(--warn)" }}
          >
            {inboxCount}
          </span>
        )}
      </button>
    </nav>
  );
}
