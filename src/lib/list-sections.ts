// Pure list derivations for the list screen: no React, no IO.
// Sorting lives INSIDE deriveSections so callers memoize the whole result
// (the old sortForDisplay allocated arrays on every render, outside the memo).

import type { CategoryDTO, ItemDTO, StoreDTO } from "@/types";

export type ListMode = { kind: "store"; storeId: string | null } | { kind: "all" };

export type ListSection = { category: CategoryDTO | null; items: ItemDTO[] };

export type DerivedSections = {
  sections: ListSection[];
  total: number;
  done: number;
  pct: number;
};

/** Per-store tab order (unchanged from today): unchecked first, then creation order. */
function compareStoreMode(a: ItemDTO, b: ItemDTO): number {
  if (a.checked !== b.checked) return a.checked ? 1 : -1;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * "All" order inside a section: unchecked first → store.order asc with the
 * inbox last (order = Infinity: store items are what you are going to buy;
 * the inbox is couch work) → createdAt asc. Compare orders with <, never by
 * subtraction: Infinity - Infinity is NaN and would corrupt the sort.
 */
function makeCompareAllMode(stores: StoreDTO[]): (a: ItemDTO, b: ItemDTO) => number {
  const orderByStore = new Map(stores.map((s) => [s.id, s.order]));
  const orderOf = (item: ItemDTO): number =>
    item.storeId === null ? Infinity : orderByStore.get(item.storeId) ?? Infinity;
  return (a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    const ao = orderOf(a);
    const bo = orderOf(b);
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  };
}

/**
 * Category sections for the active tab. Items whose categoryId is null or
 * dangling (category deleted) fall into the trailing uncategorized section
 * (category: null), which is only present when non-empty.
 */
export function deriveSections(
  items: ItemDTO[],
  categories: CategoryDTO[],
  stores: StoreDTO[],
  mode: ListMode,
): DerivedSections {
  const scoped = mode.kind === "all" ? items : items.filter((item) => item.storeId === mode.storeId);
  const compare = mode.kind === "all" ? makeCompareAllMode(stores) : compareStoreMode;

  const sections: ListSection[] = categories
    .map((category): ListSection => ({
      category,
      items: scoped.filter((item) => item.categoryId === category.id).sort(compare),
    }))
    .filter((section) => section.items.length > 0);

  const uncategorized = scoped
    .filter((item) => !item.categoryId || !categories.some((c) => c.id === item.categoryId))
    .sort(compare);
  if (uncategorized.length > 0) sections.push({ category: null, items: uncategorized });

  const total = scoped.length;
  const done = scoped.reduce((n, item) => n + (item.checked ? 1 : 0), 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return { sections, total, done, pct };
}

/**
 * D5: pending (unchecked) count per tab; key null = inbox. Independent of the
 * active mode — deriveSections in "store" mode filters to one store and cannot
 * produce every tab's counter, so this is a separate derivation.
 */
export function derivePendingByStore(items: ItemDTO[]): Map<string | null, number> {
  const pending = new Map<string | null, number>();
  for (const item of items) {
    if (item.checked) continue;
    pending.set(item.storeId, (pending.get(item.storeId) ?? 0) + 1);
  }
  return pending;
}

/**
 * Flat inbox ordering (unchecked first → createdAt): the third consumer of the
 * old sortForDisplay (list-screen passes it to InboxPanel) — identical order.
 */
export function sortForInbox(items: ItemDTO[]): ItemDTO[] {
  return [...items].sort(compareStoreMode);
}
