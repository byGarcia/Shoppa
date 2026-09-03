"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { StoreDTO } from "@/types";

type Props = {
  placeholder: string;
  onAdd: (name: string) => void;
  pending: boolean;
  /**
   * "All" view: destination selector (stores in their given order plus a
   * trailing "Unassigned" whose value "" maps to storeId null). Rendered as a
   * 12px visual chip with the real 16px <select> overlaid transparent — the
   * unlayered 16px rule in globals.css beats Tailwind utilities, and shrinking
   * it would bring back iOS zoom-on-focus.
   */
  destination?: {
    stores: StoreDTO[];
    value: string | null;
    onChange: (value: string | null) => void;
  };
};

export function AddItemInput({ placeholder, onAdd, pending, destination }: Props) {
  const t = useTranslations("list");
  const [name, setName] = useState("");
  const destLabel = destination
    ? destination.stores.find((s) => s.id === destination.value)?.name ?? t("unassigned")
    : null;

  return (
    <form
      aria-busy={pending}
      className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[var(--e1)]"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setName("");
      }}
    >
      <span className="text-lg font-bold text-brand" aria-hidden>
        ＋
      </span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="done"
        aria-label={t("addItemLabel")}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
      />
      {destination && (
        <span className="relative shrink-0 rounded-[10px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-offset-2">
          <span
            aria-hidden
            className="flex max-w-[110px] items-center gap-1 rounded-[10px] bg-chip px-2 py-1 text-[12px] font-semibold text-ink-2"
          >
            <span className="truncate">{destLabel}</span>
            <span className="text-[9px]">▾</span>
          </span>
          <select
            aria-label={t("storeSelectLabel")}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={destination.value ?? ""}
            onChange={(e) => destination.onChange(e.target.value || null)}
          >
            {destination.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">{t("unassigned")}</option>
          </select>
        </span>
      )}
      <span
        className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
        aria-hidden
      >
        ↵
      </span>
    </form>
  );
}
