"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";

export type ManagedEntity = {
  id: string;
  name: string;
  icon: string | null;
  order: number;
  color?: string | null;
};

type Props = {
  title: string;
  addLabel: string;
  entities: ManagedEntity[];
  withColor?: boolean;
  onCreate: (body: { name: string; icon?: string | null; color?: string | null }) => void;
  onUpdate: (body: { id: string; name?: string; icon?: string | null; color?: string | null; order?: number }) => void;
  onDelete: (id: string) => void;
  deleteConfirmText: (name: string) => string;
};

export function EntityManager({
  title,
  addLabel,
  entities,
  withColor,
  onCreate,
  onUpdate,
  onDelete,
  deleteConfirmText,
}: Props) {
  const t = useTranslations("common");
  const tManager = useTranslations("entityManager");
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [newColor, setNewColor] = useState("#3fa372");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");

  const sorted = [...entities].sort((a, b) => a.order - b.order);

  function move(index: number, dir: -1 | 1): void {
    const a = sorted[index];
    const b = sorted[index + dir];
    if (!a || !b) return;
    // Swap order values with two PUTs; the list refetches after each settles.
    onUpdate({ id: a.id, order: b.order });
    onUpdate({ id: b.id, order: a.order });
  }

  function submitNew(): void {
    if (!newName.trim()) return;
    onCreate({
      name: newName.trim(),
      icon: newIcon.trim() || null,
      ...(withColor ? { color: newColor } : {}),
    });
    setNewName("");
    setNewIcon("");
    setAdding(false);
  }

  return (
    <section>
      <div className="mb-3 ml-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</div>

      <ul className="flex flex-col gap-2">
        {sorted.map((entity, i) => (
          <li
            key={entity.id}
            className="flex items-center gap-3 rounded-[15px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
          >
            {editingId === entity.id ? (
              <>
                <input
                  value={editIcon}
                  onChange={(e) => setEditIcon(e.target.value)}
                  aria-label={t("icon")}
                  placeholder="·"
                  className="w-11 rounded-lg border border-line bg-bg px-1 py-2 text-center text-ink outline-none"
                />
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editName.trim()) {
                      onUpdate({ id: entity.id, name: editName.trim(), icon: editIcon.trim() || null });
                      setEditingId(null);
                    }
                  }}
                  aria-label={t("name")}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border-[1.5px] border-brand bg-bg px-2.5 py-2 text-[15px] font-semibold text-ink outline-none"
                />
                <button
                  aria-label={t("save")}
                  className="tap-press flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-brand text-on-brand"
                  onClick={() => {
                    if (!editName.trim()) return;
                    onUpdate({ id: entity.id, name: editName.trim(), icon: editIcon.trim() || null });
                    setEditingId(null);
                  }}
                >
                  <Check size={16} />
                </button>
                <button
                  aria-label={t("cancel")}
                  className="tap-press flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-chip text-ink-2"
                  onClick={() => setEditingId(null)}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <>
                {entity.icon ? (
                  <span
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-base"
                    style={
                      entity.color
                        ? { background: `color-mix(in srgb, ${entity.color} 18%, transparent)` }
                        : { background: "var(--chip)" }
                    }
                  >
                    {entity.icon}
                  </span>
                ) : (
                  <span
                    className="h-6 w-6 shrink-0 rounded-lg"
                    style={{
                      background: entity.color ?? "var(--line-2)",
                      boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)",
                    }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{entity.name}</span>
                {withColor && entity.color && (
                  <span
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ background: entity.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" }}
                  />
                )}
                <button
                  aria-label={t("moveUp")}
                  disabled={i === 0}
                  className="tap-press p-1.5 text-muted disabled:opacity-30"
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label={t("moveDown")}
                  disabled={i === sorted.length - 1}
                  className="tap-press p-1.5 text-muted disabled:opacity-30"
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  aria-label={t("edit")}
                  className="tap-press flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-chip text-ink-2"
                  onClick={() => {
                    setEditingId(entity.id);
                    setEditName(entity.name);
                    setEditIcon(entity.icon ?? "");
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label={t("delete")}
                  className="tap-press flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-danger-tint text-danger"
                  onClick={() => {
                    if (window.confirm(deleteConfirmText(entity.name))) onDelete(entity.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </li>
        ))}

        {sorted.length === 0 && !adding && (
          <li className="rounded-[15px] border border-line bg-surface px-4 py-6 text-center text-sm text-muted shadow-[var(--e1)]">
            {tManager("empty")}
          </li>
        )}
      </ul>

      {adding ? (
        <form
          className="mt-2 flex items-center gap-2 rounded-[15px] border border-line bg-surface px-3.5 py-3 shadow-[var(--e1)]"
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
        >
          <input
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            placeholder="🛒"
            aria-label={t("icon")}
            className="w-11 rounded-lg border border-line bg-bg px-1 py-2 text-center text-ink outline-none"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("name")}
            aria-label={t("name")}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border-[1.5px] border-brand bg-bg px-2.5 py-2 text-[15px] font-semibold text-ink outline-none"
          />
          {withColor && (
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              aria-label={t("color")}
              className="h-9 w-9 shrink-0 rounded-lg border border-line bg-bg p-1"
            />
          )}
          <button
            type="submit"
            aria-label={t("save")}
            className="tap-press flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-brand text-on-brand"
          >
            <Check size={18} />
          </button>
          <button
            type="button"
            aria-label={t("cancel")}
            className="tap-press flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-chip text-ink-2"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setNewIcon("");
            }}
          >
            <X size={18} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="tap-press mt-2 flex w-full items-center justify-center gap-2 rounded-[15px] border-[1.5px] border-dashed border-line-2 py-3.5 text-sm font-bold text-brand-strong"
        >
          <Plus size={18} /> {addLabel}
        </button>
      )}
    </section>
  );
}
