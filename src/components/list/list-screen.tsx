"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { StoreTabs } from "@/components/list/store-tabs";
import { AddItemInput } from "@/components/list/add-item-input";
import { CategorySection } from "@/components/list/category-section";
import { ListSkeleton } from "@/components/list/list-skeleton";
import { ItemEditSheet } from "@/components/list/item-edit-sheet";
import { InboxPanel } from "@/components/list/inbox-panel";
import { useStores } from "@/hooks/use-stores";
import { useCategories } from "@/hooks/use-categories";
import { useItems, useAddItem, useUpdateItem, useDeleteItem, useClearChecked } from "@/hooks/use-items";
import { useActiveTab, useAddDestination } from "@/hooks/use-active-tab";
import { deriveSections, derivePendingByStore, sortForInbox, type ListMode } from "@/lib/list-sections";
import type { ItemDTO } from "@/types";

export function ListScreen() {
  const t = useTranslations("list");
  const { data: stores = [], isSuccess: storesReady } = useStores();
  const { data: categories = [] } = useCategories();
  const { data: items = [], isLoading } = useItems();
  const addItem = useAddItem();
  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();
  const clearChecked = useClearChecked();

  // Last-used tab, hydrated from localStorage only once stores are known.
  const [active, setActive] = useActiveTab(stores, storesReady);
  // Remembered destination for adds from the "Todo" view.
  const [addDest, setAddDest] = useAddDestination(stores, storesReady);
  const [editing, setEditing] = useState<ItemDTO | null>(null);

  const isAll = active === "all";
  const isInbox = active === "inbox";
  const activeStoreId = isAll || isInbox ? null : active;
  const activeStore = stores.find((s) => s.id === active);
  const activeName = isInbox ? t("unassigned") : activeStore?.name ?? t("thisList");

  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s] as const)), [stores]);

  // D5: tab badges. Own memo, independent of the active mode — deriveSections
  // in "store" mode filters to one store and cannot produce every counter.
  const pendingByStore = useMemo(() => derivePendingByStore(items), [items]);

  // Inbox keeps its flat panel; same order the old sortForDisplay produced.
  const inboxItems = useMemo(() => sortForInbox(items.filter((item) => item.storeId === null)), [items]);

  const mode: ListMode = useMemo(
    () => (isAll ? { kind: "all" } : { kind: "store", storeId: activeStoreId }),
    [isAll, activeStoreId],
  );
  const { sections, total, done, pct } = useMemo(
    () => deriveSections(items, categories, stores, mode),
    [items, categories, stores, mode],
  );

  function handleAdd(name: string) {
    const storeId = isAll ? addDest : activeStoreId;
    addItem.mutate(
      { name, storeId },
      isAll
        ? {
            // The only silent failure this feature has is a stale
            // remembered destination with the new row off-viewport — confirm
            // where it landed. Store tabs skip this (destination == tab).
            onSuccess: ({ reused }) => {
              const destName = (storeId ? storesById.get(storeId)?.name : undefined) ?? t("unassigned");
              toast.success(
                reused ? t("alreadyIn", { where: destName }) : t("addedTo", { where: destName }),
              );
            },
          }
        : undefined,
    );
  }

  function handleClearChecked() {
    if (isAll) {
      // The global clear includes the inbox (Siri "quitar" leftovers live
      // there as recoverable checked items) — always confirm, naming it.
      if (!window.confirm(t("clearConfirm", { count: done }))) return;
      clearChecked.mutate({ all: true });
      return;
    }
    clearChecked.mutate({ storeId: activeStoreId });
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <header className="flex items-start justify-between py-3">
        <div>
          <h1 className="font-display text-[27px] font-semibold leading-none tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-1 text-xs font-medium text-muted">
            {t("subtitle", { count: stores.length })}
          </p>
        </div>
        {/* justify-between splits title vs actions: the two icons travel together. */}
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/precios"
            aria-label={t("pricesLabel")}
            className="tap-press flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-line bg-surface text-ink-2 shadow-[var(--e1)]"
          >
            <TrendingDown size={20} />
          </Link>
          <Link
            href="/ajustes"
            aria-label={t("settingsLabel")}
            className="tap-press flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-line bg-surface text-ink-2 shadow-[var(--e1)]"
          >
            <SlidersHorizontal size={20} />
          </Link>
        </div>
      </header>

      <StoreTabs stores={stores} active={active} pendingByStore={pendingByStore} onSelect={setActive} />

      {!isInbox && (
        <>
          <div className="mt-3">
            <AddItemInput
              placeholder={isAll ? t("addPlaceholderAll") : t("addPlaceholderStore", { store: activeName })}
              pending={addItem.isPending}
              onAdd={handleAdd}
              destination={isAll ? { stores, value: addDest, onChange: setAddDest } : undefined}
            />
          </div>

          {total > 0 && (
            <div className="mt-3.5" aria-label={t("progress", { done, total })}>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold">
                <span className="text-muted">{t("progress", { done, total })}</span>
                <span className="text-brand-strong">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, var(--brand-strong), var(--brand))",
                    transitionTimingFunction: "cubic-bezier(.22,1,.36,1)",
                  }}
                />
              </div>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {isLoading && total === 0 && <ListSkeleton />}

            {sections.map(({ category, items: sectionItems }) => (
              <CategorySection
                key={category?.id ?? "uncategorized"}
                category={category}
                items={sectionItems}
                showStoreBadges={isAll}
                storesById={storesById}
                onToggle={(it) => updateItem.mutate({ id: it.id, checked: !it.checked })}
                onEdit={setEditing}
              />
            ))}

            {total === 0 && !isLoading && (
              <div className="flex flex-col items-center gap-2 px-5 py-14 text-center" style={{ animation: "rise .4s ease" }}>
                <div className="text-[56px] leading-none opacity-90">🛒</div>
                <div className="text-[17px] font-bold text-ink">
                  {stores.length === 0
                    ? t("noStoresTitle")
                    : isAll
                      ? t("emptyTitle")
                      : t("emptyStoreTitle", { store: activeName })}
                </div>
                <p className="max-w-[230px] text-[13px] leading-relaxed text-muted">
                  {stores.length === 0
                    ? t("noStoresBody")
                    : isAll
                      ? t("emptyBodyAll")
                      : t("emptyBodyStore")}
                </p>
              </div>
            )}
          </div>

          {done > 0 && (
            <div className="sticky bottom-0 -mx-[22px] mt-3 bg-gradient-to-t from-bg via-bg to-transparent px-[22px] pb-1 pt-3">
              <button
                onClick={handleClearChecked}
                className="tap-press flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-3.5 text-sm font-semibold text-ink-2 shadow-[var(--e1)]"
              >
                {t("clear")} <span className="font-medium text-muted">· {done}</span>
              </button>
            </div>
          )}
        </>
      )}

      {isInbox && (
        <>
          <p className="mt-3 px-0.5 text-xs font-medium text-muted">{t("inboxHint")}</p>
          <InboxPanel
            items={inboxItems}
            stores={stores}
            categories={categories}
            isLoading={isLoading}
            onAssign={(input) => updateItem.mutate(input)}
            onEdit={setEditing}
          />
        </>
      )}

      {editing && (
        <ItemEditSheet
          item={editing}
          stores={stores}
          categories={categories}
          onSave={(input) => updateItem.mutate(input)}
          onDelete={(id) => deleteItem.mutate(id)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
