"use client";

import { useState } from "react";
import type { CategoryDTO, ItemDTO, StoreDTO } from "@/types";
import type { UpdateItemInput } from "@/hooks/use-items";
import { useTranslations } from "next-intl";

import { categoryVisual } from "@/lib/category-visuals";
import { useCategoryName } from "@/hooks/use-category-name";

type Props = {
  item: ItemDTO;
  stores: StoreDTO[];
  categories: CategoryDTO[];
  onSave: (input: UpdateItemInput) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

const COMMON_UNITS = ["ud", "kg", "g", "L", "ml", "paq", "lata", "bote"];

export function ItemEditSheet({ item, stores, categories, onSave, onDelete, onClose }: Props) {
  const t = useTranslations("list.edit");
  const tCommon = useTranslations("common");
  const categoryName = useCategoryName();
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? "");
  const [storeId, setStoreId] = useState(item.storeId ?? "");
  const [quantity, setQuantity] = useState(item.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");

  // Show the item's current unit as a chip even if it isn't a common one.
  const units = unit && !COMMON_UNITS.includes(unit) ? [unit, ...COMMON_UNITS] : COMMON_UNITS;

  function save(): void {
    const parsedQuantity = quantity.trim() === "" ? null : Number(quantity.replace(",", "."));
    onSave({
      id: item.id,
      name: name.trim() || item.name,
      categoryId: categoryId || null,
      storeId: storeId || null,
      quantity:
        parsedQuantity !== null && Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : null,
      unit: unit.trim() || null,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        aria-label={tCommon("close")}
        className="absolute inset-0"
        style={{ background: "rgba(20,12,4,.5)", animation: "fadeIn .25s ease" }}
        onClick={onClose}
      />
      <div
        className="relative max-h-[88dvh] overflow-y-auto rounded-t-[28px] bg-surface px-5 pb-6 pt-2 safe-bottom shadow-[var(--e-sheet)]"
        style={{ animation: "sheetUp .38s cubic-bezier(.22,1,.36,1)" }}
      >
        <div className="mx-auto mb-4 mt-2 h-[5px] w-11 rounded-full bg-line-2" />

        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[19px] font-semibold text-ink">{t("title")}</h2>
          <button
            className="tap-press rounded-[10px] bg-danger-tint px-3 py-1.5 text-[13px] font-semibold text-danger"
            onClick={() => {
              onDelete(item.id);
              onClose();
            }}
          >
            {t("delete")}
          </button>
        </div>

        <label className="mb-1.5 ml-0.5 block text-xs font-semibold text-muted">{t("name")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3.5 w-full rounded-[13px] border border-line bg-bg px-3.5 py-3 text-[15px] font-semibold text-ink outline-none"
        />

        <label className="mb-1.5 ml-0.5 block text-xs font-semibold text-muted">{t("quantity")}</label>
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          inputMode="decimal"
          placeholder="—"
          className="mb-3.5 w-full rounded-[13px] border border-line bg-bg px-3.5 py-3 font-mono text-[15px] font-semibold text-ink outline-none"
        />

        <label className="mb-2 ml-0.5 block text-xs font-semibold text-muted">{t("unit")}</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {units.map((u) => {
            const sel = u === unit;
            return (
              <button
                key={u}
                onClick={() => setUnit(sel ? "" : u)}
                className="tap-press rounded-[11px] border px-3.5 py-2 text-[13px] font-bold"
                style={{
                  borderColor: sel ? "var(--brand)" : "var(--line)",
                  background: sel ? "var(--brand)" : "var(--surface)",
                  color: sel ? "var(--on-brand)" : "var(--ink-2)",
                }}
              >
                {u}
              </button>
            );
          })}
        </div>

        <label className="mb-2 ml-0.5 block text-xs font-semibold text-muted">
          {t("category")} <span className="font-medium text-line-2">{t("categoryHint")}</span>
        </label>
        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((c) => {
            const sel = c.id === categoryId;
            const vis = categoryVisual(c);
            return (
              <button
                key={c.id}
                onClick={() => setCategoryId(sel ? "" : c.id)}
                className="tap-press flex items-center gap-1.5 rounded-[11px] border px-3 py-2 text-[13px] font-semibold"
                style={{
                  borderColor: sel ? vis.color : "var(--line)",
                  background: sel ? vis.color : "var(--surface)",
                  color: sel ? "#fff" : "var(--ink-2)",
                }}
              >
                <span>{vis.emoji}</span>
                {categoryName(c)}
              </button>
            );
          })}
        </div>

        {stores.length > 0 && (
          <>
            <label className="mb-2 ml-0.5 block text-xs font-semibold text-muted">{t("store")}</label>
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                onClick={() => setStoreId("")}
                className="tap-press rounded-[11px] border px-3 py-2 text-[13px] font-semibold"
                style={{
                  borderColor: storeId === "" ? "var(--brand)" : "var(--line)",
                  background: storeId === "" ? "var(--brand)" : "var(--surface)",
                  color: storeId === "" ? "var(--on-brand)" : "var(--ink-2)",
                }}
              >
                {t("unassigned")}
              </button>
              {stores.map((s) => {
                const sel = s.id === storeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStoreId(s.id)}
                    className="tap-press rounded-[11px] border px-3 py-2 text-[13px] font-semibold"
                    style={{
                      borderColor: sel ? "var(--brand)" : "var(--line)",
                      background: sel ? "var(--brand)" : "var(--surface)",
                      color: sel ? "var(--on-brand)" : "var(--ink-2)",
                    }}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button
          onClick={save}
          className="tap-press w-full rounded-[15px] bg-brand py-4 text-[15px] font-bold text-on-brand"
          style={{ boxShadow: "0 8px 20px -8px var(--brand)" }}
        >
          {tCommon("save")}
        </button>
      </div>
    </div>
  );
}
