"use client";

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ItemDTO } from "@/types";

type Props = {
  item: ItemDTO;
  onToggle: (item: ItemDTO) => void;
  onEdit: (item: ItemDTO) => void;
  /** "Todo" view: store tag rendered between the quantity and the pencil. */
  storeBadge?: ReactNode;
  /**
   * Resolved store name ("Por asignar" for inbox items) for the name button's
   * aria-label. Set together with storeBadge; without it the label is today's.
   */
  storeLabel?: string;
};

export function ItemRow({ item, onToggle, onEdit, storeBadge, storeLabel }: Props) {
  const t = useTranslations("list");
  const [pop, setPop] = useState(false);
  const checked = item.checked;

  function toggle() {
    if (!checked) {
      setPop(true);
      setTimeout(() => setPop(false), 300);
    }
    onToggle(item);
  }

  return (
    <li
      className="flex items-center gap-3 rounded-[15px] px-3.5 py-3 transition-all duration-200"
      style={{
        background: checked ? "var(--surface-2)" : "var(--surface)",
        opacity: checked ? 0.7 : 1,
        boxShadow: checked ? "none" : "var(--e1)",
      }}
    >
      <button
        onClick={toggle}
        aria-label={t("checkLabel", { name: item.name })}
        aria-pressed={checked}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-on-brand"
        style={{
          background: checked ? "var(--brand)" : "transparent",
          border: checked ? "2px solid var(--brand)" : "2px solid var(--line-2)",
          boxShadow: checked ? "0 4px 10px -3px var(--brand)" : "none",
          animation: pop ? "pop .3s ease" : "none",
        }}
      >
        {checked ? "✓" : ""}
      </button>

      <button
        className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold"
        onClick={() => onEdit(item)}
        aria-label={
          storeLabel
            ? t("editLabelWithStore", { name: item.name, store: storeLabel })
            : t("editLabel", { name: item.name })
        }
        style={{
          textDecoration: checked ? "line-through" : "none",
          color: checked ? "var(--muted)" : "var(--ink)",
        }}
      >
        {item.name}
      </button>

      {item.quantity != null && (
        <span className="shrink-0 font-mono text-xs text-muted">
          {item.quantity}
          {item.unit ? ` ${item.unit}` : ""}
        </span>
      )}

      {storeBadge}

      <button
        onClick={() => onEdit(item)}
        aria-label={t("editLabel", { name: item.name })}
        className="tap-press flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-muted"
      >
        <Pencil size={15} />
      </button>
    </li>
  );
}
