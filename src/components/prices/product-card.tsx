"use client";

import { ExternalLink, Loader2, Pause, Play, RefreshCw, Target, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { TrackedProductDTO } from "@/types";
import { formatMoney, percentChange, relativeDay, type RelativeDay } from "@/lib/price-format";

type Props = {
  product: TrackedProductDTO;
  checking: boolean;
  onCheck: () => void;
  onToggleActive: () => void;
  onRebase: () => void;
  onDelete: () => void;
};

export function ProductCard({
  product,
  checking,
  onCheck,
  onToggleActive,
  onRebase,
  onDelete,
}: Props) {
  const t = useTranslations("prices");
  const locale = useLocale();
  const current = product.currentPrice;
  const change = current === null ? 0 : percentChange(product.basePrice, current);
  const isDown = current !== null && current < product.basePrice;
  // 3 consecutive failures is also the threshold that sends the Telegram
  // warning, so the card and the message agree on what "broken" means.
  const isBroken = product.failCount >= 3;

  return (
    <article
      className="rounded-[18px] border border-line bg-surface p-4 shadow-[var(--e1)]"
      style={{ opacity: product.isActive ? 1 : 0.6 }}
    >
      <div className="flex items-start gap-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-[12px] border border-line object-contain"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-chip text-xl">
            🏷️
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            <span className="truncate">{product.domain}</span>
            {!product.isActive && <span className="shrink-0">{t("paused")}</span>}
          </div>
          <h2 className="mt-0.5 line-clamp-2 text-[15px] font-bold leading-snug text-ink">
            {product.title}
          </h2>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className="text-[19px] font-bold tabular-nums"
              style={{ color: isDown ? "var(--brand-strong)" : "var(--ink)" }}
            >
              {current === null ? "—" : formatMoney(current, product.currency, locale)}
            </span>
            <span className="text-[12px] font-medium text-muted">
              {t("reference", { price: formatMoney(product.basePrice, product.currency, locale) })}
            </span>
            {current !== null && change !== 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{
                  background: isDown
                    ? "color-mix(in srgb, var(--brand-strong) 16%, transparent)"
                    : "var(--chip)",
                  color: isDown ? "var(--brand-strong)" : "var(--muted)",
                }}
              >
                {change > 0 ? "+" : "−"}
                {Math.abs(change)} %
              </span>
            )}
          </div>

          <p className="mt-1 text-[11px] font-medium text-muted">
            {isBroken ? (
              <span className="text-ink-2">
                {t("unreadable", { reason: product.lastError ?? "" })}
              </span>
            ) : (
              <>
                {t("checked", { when: whenLabel(relativeDay(product.lastCheckedAt), t, locale) })}
                {product.lowestPrice !== null &&
                  t("minimum", {
                    price: formatMoney(product.lowestPrice, product.currency, locale),
                  })}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <IconButton label={t("checkNow")} onClick={onCheck} disabled={checking}>
          {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </IconButton>
        <IconButton
          label={t("rebaseLabel")}
          onClick={onRebase}
          disabled={product.currentPrice === null}
        >
          <Target size={16} />
        </IconButton>
        <IconButton
          label={product.isActive ? t("pause") : t("resume")}
          onClick={onToggleActive}
        >
          {product.isActive ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("openInStore")}
          className="tap-press flex h-9 w-9 items-center justify-center rounded-[11px] bg-chip text-ink-2"
        >
          <ExternalLink size={16} />
        </a>
        <div className="flex-1" />
        <IconButton label={t("untrack")} onClick={onDelete} danger>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </article>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="tap-press flex h-9 w-9 items-center justify-center rounded-[11px] bg-chip disabled:opacity-40"
      style={{ color: danger ? "var(--danger)" : "var(--ink-2)" }}
    >
      {children}
    </button>
  );
}

/**
 * The "when" that goes inside `prices.checked`. Everything but a real date is a
 * catalog key; a month or more old is written by Intl in the reader's language.
 */
function whenLabel(
  when: RelativeDay,
  t: (key: string, values?: Record<string, number>) => string,
  locale: string,
): string {
  if (when.kind === "date") {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(when.date);
  }
  if (when.kind === "daysAgo") return t("when.daysAgo", { days: when.days });
  return t(`when.${when.kind}`);
}
